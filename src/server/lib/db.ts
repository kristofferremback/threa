import { Pool, Client } from "pg"
import { DATABASE_URL } from "../config"
import { logger } from "./logger"

// Connection pool for general queries
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// Dedicated client for LISTEN/NOTIFY (must be separate from pool)
let notifyClient: Client | null = null

export const getNotifyClient = async (): Promise<Client> => {
  if (!notifyClient) {
    notifyClient = new Client({
      connectionString: DATABASE_URL,
    })
    await notifyClient.connect()
    logger.info("Notification client connected")
  }
  return notifyClient
}

// Graceful shutdown
export const closeConnections = async () => {
  await pool.end()
  if (notifyClient) {
    await notifyClient.end()
  }
  logger.info("Database connections closed")
}

// Handle pool errors
pool.on("error", (err) => {
  logger.error({ err }, "Unexpected database pool error")
})
