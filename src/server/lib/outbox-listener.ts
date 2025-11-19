import { Pool } from "pg"
import { getNotifyClient } from "./db"
import { logger } from "./logger"
import { pool } from "./db"
import { createRedisClient, connectRedisClient, type RedisClient } from "./redis"

const DEBOUNCE_MS = 50 // Debounce window for grouping multiple events

export class OutboxListener {
  private isListening = false
  private notifyClient: Awaited<ReturnType<typeof getNotifyClient>> | null = null
  private redisClient: RedisClient | null = null
  private debounceTimer: NodeJS.Timeout | null = null

  constructor(private pool: Pool) {}

  async start(): Promise<void> {
    if (this.isListening) {
      logger.warn("Outbox listener already started")
      return
    }

    try {
      this.notifyClient = await getNotifyClient()

      // Connect to Redis for publishing
      this.redisClient = createRedisClient({
        onError: (err) => {
          logger.error({ err }, "Redis client error in outbox listener")
        },
      })

      await connectRedisClient(this.redisClient, "Outbox listener")

      // Subscribe to NOTIFY first
      await this.notifyClient.query("LISTEN outbox_event")
      logger.info("Listening for outbox events")

      // Set up NOTIFY handler with debouncing
      this.notifyClient.on("notification", (msg) => {
        if (msg.channel === "outbox_event") {
          this.handleNotification()
        }
      })

      this.notifyClient.on("error", (err) => {
        logger.error({ err }, "Notification client error")
      })

      // On init: immediately check and process pending events
      await this.processOutboxBatch()

      this.isListening = true
      logger.info("Outbox listener started")
    } catch (error) {
      logger.error({ err: error }, "Failed to start outbox listener")
      throw error
    }
  }

  private handleNotification(): void {
    // Debounce: clear existing timer and set a new one
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.processOutboxBatch().catch((error) => {
        logger.error({ err: error }, "Error processing outbox batch")
      })
    }, DEBOUNCE_MS)
  }

  /**
   * Process a batch of outbox events
   * Reads unprocessed events from the outbox table, publishes them, and acks them
   */
  private async processOutboxBatch(): Promise<void> {
    try {
      const result = await this.pool.query<{ id: string; event_type: string; payload: any }>(
        "SELECT id, event_type, payload FROM outbox WHERE processed_at IS NULL ORDER BY created_at LIMIT 100",
      )

      if (result.rows.length === 0) {
        return
      }

      logger.debug({ count: result.rows.length }, "Processing outbox batch")

      for (const row of result.rows) {
        try {
          // Publish to Redis
          if (this.redisClient) {
            await this.redisClient.publish(`event:${row.event_type}`, JSON.stringify(row.payload))
            logger.debug({ event_type: row.event_type, id: row.id }, "Published event to Redis")
          }

          // Ack: mark as processed
          await this.pool.query("UPDATE outbox SET processed_at = NOW() WHERE id = $1", [row.id])
        } catch (error) {
          logger.error({ err: error, event_id: row.id }, "Error processing outbox event")
          // Update retry count on failure
          await this.pool.query("UPDATE outbox SET retry_count = retry_count + 1, last_error = $1 WHERE id = $2", [
            error instanceof Error ? error.message : String(error),
            row.id,
          ])
        }
      }

      logger.debug({ count: result.rows.length }, "Completed processing outbox batch")
    } catch (error) {
      logger.error({ err: error }, "Error processing outbox batch")
    }
  }

  async stop(): Promise<void> {
    if (!this.isListening) return

    try {
      // Clear debounce timer
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
        this.debounceTimer = null
      }

      if (this.notifyClient) {
        await this.notifyClient.query("UNLISTEN outbox_event")
        await this.notifyClient.end()
        this.notifyClient = null
      }
      if (this.redisClient) {
        await this.redisClient.quit()
        this.redisClient = null
      }
      this.isListening = false
      logger.info("Outbox listener stopped")
    } catch (error) {
      logger.error({ err: error }, "Error stopping outbox listener")
    }
  }
}

// Singleton instance for backward compatibility
let instance: OutboxListener | null = null

export const startOutboxListener = async (): Promise<void> => {
  if (!instance) {
    instance = new OutboxListener(pool)
  }
  await instance.start()
}

export const stopOutboxListener = async (): Promise<void> => {
  if (instance) {
    await instance.stop()
  }
}
