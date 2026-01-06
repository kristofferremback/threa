import { Pool, PoolClient } from "pg"
import { withTransaction } from "../db"
import { OutboxListenerRepository, OUTBOX_CHANNEL, OutboxEvent, withClaim } from "../repositories"
import { DebounceWithMaxWait } from "./debounce"
import { logger } from "./logger"

export interface OutboxListenerConfig {
  listenerId: string
  handler: (event: OutboxEvent) => Promise<void>
  batchSize?: number
  maxRetries?: number
  baseBackoffMs?: number
  debounceMs?: number
  maxWaitMs?: number
  fallbackPollMs?: number
  keepaliveMs?: number
}

const DEFAULT_CONFIG = {
  batchSize: 100,
  maxRetries: 5,
  baseBackoffMs: 1000,
  debounceMs: 50,
  maxWaitMs: 200,
  fallbackPollMs: 500,
  keepaliveMs: 30000,
}

/**
 * Processes outbox events with NOTIFY/LISTEN for real-time delivery.
 *
 * @example
 * ```ts
 * const listener = new OutboxListener(pool, {
 *   listenerId: "broadcast",
 *   handler: async (event) => {
 *     io.to(`stream:${event.payload.streamId}`).emit(event.eventType, event.payload)
 *   },
 * })
 * await listener.start()
 * ```
 */
export class OutboxListener {
  private pool: Pool
  private listenerId: string
  private handler: (event: OutboxEvent) => Promise<void>
  private batchSize: number
  private maxRetries: number
  private baseBackoffMs: number
  private debounceMs: number
  private maxWaitMs: number
  private fallbackPollMs: number
  private keepaliveMs: number

  private running: boolean = false
  private startPromise: Promise<void> | null = null
  private listenClient: PoolClient | null = null
  private debouncer: DebounceWithMaxWait | null = null
  private fallbackTimer: Timer | null = null
  private keepaliveTimer: Timer | null = null

  constructor(pool: Pool, config: OutboxListenerConfig) {
    this.pool = pool
    this.listenerId = config.listenerId
    this.handler = config.handler
    this.batchSize = config.batchSize ?? DEFAULT_CONFIG.batchSize
    this.maxRetries = config.maxRetries ?? DEFAULT_CONFIG.maxRetries
    this.baseBackoffMs = config.baseBackoffMs ?? DEFAULT_CONFIG.baseBackoffMs
    this.debounceMs = config.debounceMs ?? DEFAULT_CONFIG.debounceMs
    this.maxWaitMs = config.maxWaitMs ?? DEFAULT_CONFIG.maxWaitMs
    this.fallbackPollMs = config.fallbackPollMs ?? DEFAULT_CONFIG.fallbackPollMs
    this.keepaliveMs = config.keepaliveMs ?? DEFAULT_CONFIG.keepaliveMs
  }

  async start(): Promise<void> {
    if (this.running) return

    // If start is already in progress, wait for it and return early.
    // If a concurrent start fails, so would probably this one too.
    if (this.startPromise) {
      return this.startPromise
    }

    this.startPromise = this.doStart()

    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async doStart(): Promise<void> {
    // Ensure listener exists in the database
    await withTransaction(this.pool, async (client) => {
      await OutboxListenerRepository.ensureListener(client, this.listenerId)
    })

    try {
      this.debouncer = new DebounceWithMaxWait(
        () => this.processEvents(),
        this.debounceMs,
        this.maxWaitMs,
        (err) => logger.error({ err, listenerId: this.listenerId }, "OutboxListener debouncer error")
      )

      await this.setupListener()

      this.startFallbackPoll()

      this.running = true

      logger.info(
        {
          listenerId: this.listenerId,
          debounceMs: this.debounceMs,
          maxWaitMs: this.maxWaitMs,
          fallbackPollMs: this.fallbackPollMs,
        },
        "OutboxListener started"
      )
    } catch (err) {
      this.cleanup()
      throw err
    }
  }

  private cleanup(): void {
    if (this.debouncer) {
      this.debouncer.cancel()
      this.debouncer = null
    }

    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }

    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }

    if (this.listenClient) {
      try {
        this.listenClient.release()
      } catch {
        // Ignore errors during cleanup
      }
      this.listenClient = null
    }
  }

  async stop(): Promise<void> {
    this.running = false

    // UNLISTEN before releasing for graceful shutdown
    if (this.listenClient) {
      try {
        await this.listenClient.query(`UNLISTEN ${OUTBOX_CHANNEL}`)
      } catch {
        // Ignore - cleanup will release the client anyway
      }
    }

    this.cleanup()
    logger.info({ listenerId: this.listenerId }, "OutboxListener stopped")
  }

  private async setupListener(): Promise<void> {
    try {
      this.listenClient = await this.pool.connect()

      this.listenClient.on("notification", () => {
        if (this.debouncer) {
          this.debouncer.trigger()
        }
      })

      this.listenClient.on("error", (err) => {
        logger.error({ err, listenerId: this.listenerId }, "LISTEN client error, reconnecting...")
        this.reconnectListener()
      })

      await this.listenClient.query(`LISTEN ${OUTBOX_CHANNEL}`)
      this.startKeepalive()
      logger.debug({ listenerId: this.listenerId }, "LISTEN connection established")
    } catch (err) {
      logger.error({ err, listenerId: this.listenerId }, "Failed to setup LISTEN connection")
      this.scheduleReconnect()
    }
  }

  private startKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
    }

    this.keepaliveTimer = setInterval(async () => {
      if (!this.listenClient || !this.running) return

      try {
        await this.listenClient.query("SELECT 1")
      } catch (err) {
        // Error will trigger the client's error handler which calls reconnectListener
        logger.debug({ err, listenerId: this.listenerId }, "Keepalive query failed")
      }
    }, this.keepaliveMs)
  }

  private reconnectListener(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }

    if (this.listenClient) {
      try {
        this.listenClient.release()
      } catch {
        // Ignore
      }
      this.listenClient = null
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (!this.running) return

    setTimeout(() => {
      if (this.running) {
        this.setupListener()
      }
    }, 1000)
  }

  /**
   * Fallback polling ensures events are processed even if NOTIFY is missed.
   * This also handles retry_after timing - the polling interval will eventually
   * pick up events once the backoff period has elapsed.
   */
  private startFallbackPoll(): void {
    this.fallbackTimer = setTimeout(async () => {
      if (!this.running) return

      try {
        await this.processEvents()
      } catch (err) {
        logger.error({ err, listenerId: this.listenerId }, "OutboxListener fallback poll error")
      }
      this.startFallbackPoll()
    }, this.fallbackPollMs)
  }

  private async processEvents(): Promise<void> {
    if (!this.running) return

    await withClaim(
      this.pool,
      this.listenerId,
      async (ctx) => {
        while (true) {
          const events = await ctx.fetchEvents(this.batchSize)
          if (events.length === 0) break

          for (const event of events) {
            await this.handler(event)
          }

          // Update cursor after processing the batch
          const lastEvent = events[events.length - 1]
          await ctx.updateCursor(lastEvent.id)

          logger.debug({ listenerId: this.listenerId, count: events.length }, "Processed outbox events")
        }
      },
      { maxRetries: this.maxRetries, baseBackoffMs: this.baseBackoffMs }
    )
  }
}
