import { getNotifyClient } from "./db"
import { logger } from "./logger"
import { pool } from "./db"
import { createRedisClient, connectRedisClient, type RedisClient } from "./redis"

let isListening = false
let notifyClient: Awaited<ReturnType<typeof getNotifyClient>> | null = null
let redisClient: RedisClient | null = null

export const startOutboxListener = async () => {
  if (isListening) {
    logger.warn("Outbox listener already started")
    return
  }

  try {
    notifyClient = await getNotifyClient()

    // Connect to Redis for publishing
    redisClient = createRedisClient({
      onError: (err) => {
        logger.error({ err }, "Redis client error in outbox listener")
      },
    })

    await connectRedisClient(redisClient, "Outbox listener")

    // Listen for outbox events
    await notifyClient.query("LISTEN outbox_event")
    logger.info("Listening for outbox events")

    notifyClient.on("notification", async (msg) => {
      if (msg.channel === "outbox_event") {
        try {
          const event = JSON.parse(msg.payload || "{}")
          await processOutboxEvent(event)
        } catch (error) {
          logger.error({ err: error, payload: msg.payload }, "Error processing outbox notification")
        }
      }
    })

    notifyClient.on("error", (err) => {
      logger.error({ err }, "Notification client error")
    })

    await processPendingOutboxEvents()

    isListening = true
    logger.info("Outbox listener started")
  } catch (error) {
    logger.error({ err: error }, "Failed to start outbox listener")
    throw error
  }
}

const processOutboxEvent = async (event: { id: string; event_type: string; payload: any }) => {
  try {
    if (redisClient) {
      await redisClient.publish(`event:${event.event_type}`, JSON.stringify(event.payload))
      logger.debug({ event_type: event.event_type, id: event.id }, "Published event to Redis")
    }

    await pool.query("UPDATE outbox SET processed_at = NOW() WHERE id = $1", [event.id])
  } catch (error) {
    logger.error({ err: error, event_id: event.id }, "Error processing outbox event")
    await pool.query("UPDATE outbox SET retry_count = retry_count + 1, last_error = $1 WHERE id = $2", [
      error instanceof Error ? error.message : String(error),
      event.id,
    ])
  }
}

const processPendingOutboxEvents = async () => {
  try {
    const result = await pool.query<{ id: string; event_type: string; payload: any }>(
      "SELECT id, event_type, payload FROM outbox WHERE processed_at IS NULL ORDER BY created_at LIMIT 100",
    )

    if (result.rows.length > 0) {
      logger.info({ count: result.rows.length }, "Processing pending outbox events")
      for (const row of result.rows) {
        await processOutboxEvent({
          id: row.id,
          event_type: row.event_type,
          payload: row.payload, // JSONB is already parsed by pg
        })
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Error processing pending outbox events")
  }
}

export const stopOutboxListener = async () => {
  if (!isListening) return

  try {
    if (notifyClient) {
      await notifyClient.query("UNLISTEN outbox_event")
      await notifyClient.end()
      notifyClient = null
    }
    if (redisClient) {
      await redisClient.quit()
      redisClient = null
    }
    isListening = false
    logger.info("Outbox listener stopped")
  } catch (error) {
    logger.error({ err: error }, "Error stopping outbox listener")
  }
}
