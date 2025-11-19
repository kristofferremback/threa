import { Pool, Client, type PoolConfig } from "pg"
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

/**
 * Create a dedicated client for LISTEN/NOTIFY (must be separate from pool)
 */
export const createNotifyClient = (): Client => {
  const client = new Client({
    connectionString: DATABASE_URL,
  })

  client.on("error", (err) => {
    logger.error({ err }, "Notification client error")
  })

  logger.debug({ database_url: DATABASE_URL }, "Created notification client")
  return client
}

/**
 * Connect a notification client
 */
export const connectNotifyClient = async (client: Client, context: string = "Notification client"): Promise<void> => {
  try {
    await client.connect()
    await client.query("SELECT 1")
    logger.info({ context }, "Notification client connected")
  } catch (error) {
    logger.error({ err: error, context }, "Failed to connect notification client")
    throw error
  }
}

/**
 * Get or create notification client (singleton for backward compatibility)
 */
let notifyClient: Client | null = null

export const getNotifyClient = async (): Promise<Client> => {
  if (!notifyClient) {
    notifyClient = createNotifyClient()
    await connectNotifyClient(notifyClient)
  }
  return notifyClient
}

/**
 * Close database connections
 */
export const closeConnections = async (pool: Pool): Promise<void> => {
  await pool.end()
  if (notifyClient) {
    await notifyClient.end()
    notifyClient = null
  }
  logger.info("Database connections closed")
}

// Singleton pool instance for backward compatibility
export const pool = createDatabasePool()
