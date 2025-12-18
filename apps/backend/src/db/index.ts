import { Pool, PoolClient, PoolConfig } from "pg"
import { sql } from "squid/pg"
import { logger } from "../lib/logger"

export { sql }

export function createDatabasePool(connectionString: string, config?: Partial<PoolConfig>): Pool {
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ...config,
  })

  pool.on("error", (err) => {
    logger.error({ err }, "Unexpected database pool error")
  })

  return pool
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
