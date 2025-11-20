import { Pool, type PoolConfig } from "pg"
import { DATABASE_URL } from "../config"
import { logger } from "./logger"

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
