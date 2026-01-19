import { Pool, PoolClient, PoolConfig, QueryConfig, QueryResult, QueryResultRow } from "pg"
import { sql } from "squid/pg"
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
 */
const DEFAULT_POOL_CONFIG: Partial<PoolConfig> = {
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
}

export function createDatabasePool(connectionString: string, config?: Partial<PoolConfig>): Pool {
  const pool = new Pool({
    connectionString,
    ...DEFAULT_POOL_CONFIG,
    ...config,
  })

  pool.on("error", (err: Error & { code?: string }) => {
    // 57P05 = admin_shutdown/idle-session timeout - expected during shutdown
    if (err.code === "57P05") {
      logger.debug({ err }, "Database connection terminated (expected during shutdown)")
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
  const main = createDatabasePool(connectionString, { max: 30 })

  // Listen pool for long-held NOTIFY/LISTEN connections
  // Size: 9 listeners + headroom for reconnection overlap
  const listen = createDatabasePool(connectionString, {
    max: 12,
    // LISTEN connections are held indefinitely - longer idle timeout
    idleTimeoutMillis: 60000,
  })

  return { main, listen }
}

export async function withTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await callback(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export async function withClient<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await callback(client)
  } finally {
    client.release()
  }
}
