import { Pool, PoolClient, PoolConfig, QueryConfig, QueryResult, QueryResultRow } from "pg"
import { sql } from "squid/pg"
import { ulid } from "ulid"
import { logger } from "../lib/logger"

export { sql }

/**
 * Common interface for database query execution.
 * Both Pool and PoolClient satisfy this interface.
 *
 * - Pass Pool for simple queries (auto-acquires and releases connection)
 * - Pass PoolClient when you need a transaction or connection affinity
 *
 * This mirrors Go's pattern where pgx.Pool implements the same Querier
 * interface as pgx.Conn, allowing flexible connection management.
 */
export interface Querier {
  query<R extends QueryResultRow = QueryResultRow>(
    queryTextOrConfig: string | QueryConfig,
    values?: unknown[]
  ): Promise<QueryResult<R>>
}

/**
 * Default pool configuration.
 *
 * IMPORTANT: connectionTimeoutMillis must be long enough to handle thundering herd
 * at startup when 15+ workers simultaneously request connections from an empty pool.
 * With 2000ms timeout, connection establishment fails and creates phantom connections.
 */
const DEFAULT_POOL_CONFIG: Partial<PoolConfig> = {
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // 10 seconds - was 2000ms, too short for startup stampede
}

/**
 * Alive bypass window for connection validation (inspired by HikariCP).
 * If a connection was used within this window, skip validation (assume it's alive).
 *
 * This optimization prevents validating every connection on every borrow while
 * still catching stale connections that PostgreSQL killed (e.g., idle_session_timeout).
 *
 * @see https://github.com/brettwooldridge/HikariCP/issues/1050
 */
const ALIVE_BYPASS_WINDOW_MS = 500

/**
 * Validates a PoolClient before use.
 *
 * @param client The PoolClient to validate
 * @param pool The pool for retry logic
 * @returns Validated client (or new client if stale)
 */
async function validateClient(client: PoolClient, pool: Pool): Promise<PoolClient> {
  // Check if connection needs validation based on last use
  const now = Date.now()
  const lastQueryTime = (client as any)._validatedAt || 0
  const idleTime = now - lastQueryTime

  // Only validate if connection hasn't been validated recently
  if (idleTime > ALIVE_BYPASS_WINDOW_MS) {
    try {
      // Validate with simple query
      await client.query("SELECT 1")
      // Mark validation time
      ;(client as any)._validatedAt = Date.now()
    } catch (err) {
      // Connection is stale - destroy it and retry
      logger.debug({ err, idleMs: idleTime }, "Stale connection detected, destroying and retrying")
      client.release(true) // true = destroy, don't return to pool
      return pool.connect() // Recursive retry will go through validation again
    }
  }

  return client
}

/**
 * Wraps a pool to validate connections before use (HikariCP pattern).
 *
 * Problem: PostgreSQL can kill connections server-side (idle_session_timeout),
 * but pg-pool's client._connected flag stays true. When code tries to use the
 * "connected" client, queries fail with "timeout exceeded" or connection errors.
 *
 * Solution: Validate connections on borrow with an optimization - skip validation
 * if the connection was used recently (< 500ms ago). This catches stale connections
 * without impacting performance for active workloads.
 *
 * @param pool Pool to wrap with validation
 * @returns Pool with transparent connection validation
 */
function wrapPoolWithValidation(pool: Pool): Pool {
  const originalConnect = pool.connect.bind(pool)

  // Override connect() with validation
  pool.connect = function (): Promise<PoolClient> {
    return originalConnect().then((client) => validateClient(client, pool))
  }

  return pool
}

export function createDatabasePool(connectionString: string, config?: Partial<PoolConfig>): Pool {
  const pool = new Pool({
    connectionString,
    ...DEFAULT_POOL_CONFIG,
    ...config,
  })

  pool.on("error", (err: Error & { code?: string }) => {
    // 57P05 = idle-session timeout - PostgreSQL killed an idle connection
    // This is NORMAL behavior with idle_session_timeout configured
    // pg-pool will automatically remove the dead connection from the pool
    if (err.code === "57P05") {
      logger.info(
        {
          code: err.code,
          message: err.message,
        },
        "Connection killed by PostgreSQL idle-session timeout (expected with idle_session_timeout=60s)"
      )
      return
    }

    logger.error({ err, code: err.code }, "Unexpected database pool error")
  })

  return pool
}

/**
 * Database pool configuration for different concerns.
 * Separating pools prevents one category from starving another.
 */
export interface DatabasePools {
  /** Main pool for services, workers, and general queries (30 max) */
  main: Pool
  /** Dedicated pool for LISTEN connections held by outbox listeners (12 max) */
  listen: Pool
}

/**
 * Create separated database pools for different concerns.
 *
 * - main: Used by services, workers, queue system, and HTTP handlers (30 connections)
 * - listen: Dedicated to OutboxListener LISTEN connections (12 connections)
 *
 * This separation ensures that long-held LISTEN connections don't compete
 * with transactional work for pool slots.
 *
 * Pool sizing rationale:
 * - main (30): Handles concurrent HTTP requests, workers, and queue jobs
 * - listen (12): Currently 9 OutboxListeners + 3 headroom for reconnects
 *   If adding more listeners, increase this accordingly.
 */
export function createDatabasePools(connectionString: string): DatabasePools {
  // Main pool for transactional work
  const main = createDatabasePool(connectionString, { max: Number(process.env.DATABASE_POOL_MAX) || 30 })

  // Listen pool for long-held NOTIFY/LISTEN connections
  // Size: 9 listeners + headroom for reconnection overlap
  const listen = createDatabasePool(connectionString, {
    max: 12,
    // LISTEN connections are held indefinitely - longer idle timeout
    idleTimeoutMillis: 60000,
  })

  return { main, listen }
}

/**
 * Check if an error is a recoverable connection error that warrants a retry.
 */
function isRecoverableConnectionError(err: unknown): boolean {
  const error = err as Error & { code?: string }
  // 57P05 = idle-session timeout - connection was killed, can retry with new connection
  // ECONNRESET = connection reset - network issue, can retry
  return error.code === "57P05" || error.code === "ECONNRESET"
}

/**
 * Check if a querier is a PoolClient (already has connection, possibly in transaction).
 * PoolClient has a `release` method that Pool doesn't have.
 */
function isPoolClient(db: Pool | PoolClient): db is PoolClient {
  return "release" in db && typeof db.release === "function"
}

/**
 * Execute callback in a transaction.
 *
 * Supports nested transactions via savepoints:
 * - Pass Pool: starts a new transaction (BEGIN/COMMIT)
 * - Pass PoolClient: uses a savepoint (nested transaction)
 *
 * This allows callers to use withTransaction without knowing if they're
 * already inside a transaction - the right thing happens automatically.
 */
export async function withTransaction<T>(
  db: Pool | PoolClient,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (isPoolClient(db)) {
    // Already have a client - use savepoint for nested transaction
    const savepointName = `sp_${ulid()}`
    await db.query(`SAVEPOINT ${savepointName}`)
    try {
      const result = await callback(db)
      await db.query(`RELEASE SAVEPOINT ${savepointName}`)
      return result
    } catch (error) {
      await db.query(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => {
        // Ignore rollback errors
      })
      throw error
    }
  }

  // Top-level transaction from pool
  let lastError: unknown

  // Retry once on recoverable connection errors
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await db.connect()
    try {
      await client.query("BEGIN")
      const result = await callback(client)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        // Ignore rollback errors (connection might be dead)
      })

      lastError = error

      // Only retry on recoverable connection errors, and only on first attempt
      if (attempt === 0 && isRecoverableConnectionError(error)) {
        logger.debug(
          { err: error, attempt: attempt + 1 },
          "Transaction failed with recoverable connection error, retrying..."
        )
        client.release(true) // Destroy the bad connection
        continue
      }

      throw error
    } finally {
      client.release()
    }
  }

  throw lastError
}

export async function withClient<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  let lastError: unknown

  // Retry once on recoverable connection errors
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await pool.connect()
    try {
      return await callback(client)
    } catch (error) {
      lastError = error

      // Only retry on recoverable connection errors, and only on first attempt
      if (attempt === 0 && isRecoverableConnectionError(error)) {
        logger.debug(
          { err: error, attempt: attempt + 1 },
          "Query failed with recoverable connection error, retrying..."
        )
        client.release(true) // Destroy the bad connection
        continue
      }

      throw error
    } finally {
      client.release()
    }
  }

  throw lastError
}

/**
 * Pre-warm pool by creating initial connections.
 *
 * Prevents "thundering herd" at startup where 15+ workers simultaneously
 * request connections from an empty pool, causing timeouts and phantom connections.
 *
 * @param pool Pool to warm
 * @param count Number of connections to pre-create (default: 10)
 */
export async function warmPool(pool: Pool, count: number = 10): Promise<void> {
  const clients: PoolClient[] = []

  try {
    // Acquire connections one at a time to avoid overwhelming PostgreSQL
    for (let i = 0; i < count; i++) {
      const client = await pool.connect()
      clients.push(client)
    }

    // Validate connections
    await Promise.all(clients.map((client) => client.query("SELECT 1")))
  } finally {
    // Release all connections back to pool
    clients.forEach((client) => client.release())
  }
}
