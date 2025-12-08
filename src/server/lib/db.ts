import { Pool, type PoolConfig, type PoolClient } from "pg"
import { sql } from "squid/pg"
import { DATABASE_URL } from "../config"
import { logger } from "./logger"

// Re-export squid's sql template tag - a battle-tested library that properly escapes values
// to prevent SQL injection. Returns { text, values } with PostgreSQL placeholders ($1, $2, etc.)
// which is directly compatible with pg.query()
//
// Usage:
//   const result = await pool.query(sql`SELECT * FROM users WHERE email = ${email}`)
//
// For Bun scripts, use Bun's built-in sql directly: import { sql } from "bun"
export { sql }

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

/**
 * Create a database connection pool with consistent configuration
 */
export const createDatabasePool = (config?: Partial<PoolConfig>): Pool => {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ...config,
  })

  pool.on("error", (err) => {
    logger.error({ err }, "Unexpected database pool error")
  })

  logger.debug({ database_url: DATABASE_URL }, "Created database pool")
  return pool
}

/**
 * Connect and validate a database pool
 */
export const connectDatabasePool = async (pool: Pool, context: string = "Database"): Promise<void> => {
  try {
    const client = await pool.connect()
    await client.query("SELECT 1")
    client.release()
    logger.info({ context }, "Database pool connected and validated")
  } catch (error) {
    logger.error({ err: error, context }, "Failed to connect database pool")
    throw error
  }
}
