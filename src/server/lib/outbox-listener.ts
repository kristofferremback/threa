import { Pool } from "pg"
import { logger } from "./logger"
import { createRedisClient, connectRedisClient, type RedisClient } from "./redis"
import { DebounceWithMaxWait } from "./debounce"
import { NotifyClient } from "./notify-client"

const DEBOUNCE_MS = 50 // Debounce window for grouping multiple events
const MAX_WAIT_MS = 200 // Maximum wait time before processing even if messages keep coming
const POLL_INTERVAL_MS = 1000 // Fallback polling interval (1 second)

export class OutboxListener {
  private isListening = false
  private notifyClient: NotifyClient | null = null
  private redisClient: RedisClient | null = null
  private debouncedNotificationProcessor: DebounceWithMaxWait
  private pollInterval: NodeJS.Timeout | null = null

  constructor(private pool: Pool) {
    this.debouncedNotificationProcessor = new DebounceWithMaxWait(
      () => this.processOutboxBatch(),
      DEBOUNCE_MS,
      MAX_WAIT_MS,
      (error) => {
        logger.error({ err: error }, "Error processing outbox batch")
      },
    )
  }

  async start(): Promise<void> {
    if (this.isListening) {
      logger.warn("Outbox listener already started")
      return
    }

    try {
      // Create and connect notification client
      this.notifyClient = new NotifyClient()
      await this.notifyClient.connect()

      // Connect to Redis for publishing
      this.redisClient = createRedisClient({
        onError: (err) => {
          logger.error({ err }, "Redis client error in outbox listener")
        },
      })

      await connectRedisClient(this.redisClient, "Outbox listener")

      // Set up NOTIFY handler with debouncing
      this.notifyClient.onNotification((msg) => {
        if (msg.channel === "outbox_event") {
          this.debouncedNotificationProcessor.trigger()
        }
      })

      this.notifyClient.onError((err) => {
        logger.error({ err }, "Notification client error")
      })

      // Subscribe to NOTIFY channel
      await this.notifyClient.listen("outbox_event")

      // Start fallback polling (every 1s)
      this.pollInterval = setInterval(() => {
        this.processOutboxBatch().catch((error) => {
          logger.error({ err: error }, "Error in polling outbox batch")
        })
      }, POLL_INTERVAL_MS)

      // On init: immediately check and process pending events
      await this.processOutboxBatch()

      this.isListening = true
      logger.info("Outbox listener started (NOTIFY + polling)")
    } catch (error) {
      logger.error({ err: error }, "Failed to start outbox listener")
      throw error
    }
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
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.isListening) return

    try {
      // Clear debounce timers
      this.debouncedNotificationProcessor.cancel()

      // Clear polling interval
      if (this.pollInterval) {
        clearInterval(this.pollInterval)
        this.pollInterval = null
      }

      if (this.notifyClient) {
        await this.notifyClient.unlisten("outbox_event")
        await this.notifyClient.close()
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
