import { createClient } from "redis"
import { REDIS_URL } from "../config"
import { logger } from "./logger"

export type RedisClient = ReturnType<typeof createClient>

/**
 * Parse Redis URL and extract connection details
 */
export const parseRedisUrl = () => {
  const redisUrl = new URL(REDIS_URL)
  const port = redisUrl.port ? parseInt(redisUrl.port, 10) : 6379
  return {
    host: redisUrl.hostname || "localhost",
    port,
    url: REDIS_URL,
  }
}

/**
 * Create a Redis client with consistent configuration
 */
export const createRedisClient = (options?: {
  reconnectStrategy?: (retries: number) => number | Error
  onError?: (err: Error) => void
}): ReturnType<typeof createClient> => {
  const { host, port, url } = parseRedisUrl()
  
  logger.debug({ redis_url: url, host, port }, "Creating Redis client")
  
  const client = createClient({
    socket: {
      host,
      port,
      reconnectStrategy: options?.reconnectStrategy || ((retries) => {
        if (retries > 10) {
          logger.error("Redis reconnection failed after 10 retries")
          return new Error("Redis reconnection failed")
        }
        return Math.min(retries * 100, 3000)
      }),
    },
    disableClientInfo: true,
  })

  if (options?.onError) {
    client.on("error", options.onError)
  } else {
    client.on("error", (err) => {
      logger.error({ err }, "Redis client error")
    })
  }

  return client
}

/**
 * Connect to Redis and return connected client
 */
export const connectRedisClient = async (
  client: RedisClient,
  context: string = "Redis"
): Promise<void> => {
  try {
    await client.connect()
    await client.ping()
    logger.info({ context }, "Redis client connected")
  } catch (error) {
    logger.error({ err: error, context }, "Failed to connect Redis client")
    throw error
  }
}

/**
 * Create Redis pub/sub clients for Socket.IO adapter
 */
export const createSocketIORedisClients = async (): Promise<{
  pubClient: RedisClient
  subClient: RedisClient
}> => {
  const handleError = (err: Error) => {
    logger.error({ err }, "Redis error in Socket.IO clients")
  }

  const pubClient = createRedisClient({ onError: handleError })
  const subClient = pubClient.duplicate() as RedisClient
  subClient.on("error", handleError)

  await Promise.all([
    connectRedisClient(pubClient, "Socket.IO pub client"),
    connectRedisClient(subClient, "Socket.IO sub client"),
  ])

  return { pubClient, subClient }
}

