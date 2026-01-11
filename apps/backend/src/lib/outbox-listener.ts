import { Pool, PoolClient } from "pg"
import {
  OutboxListenerRepository,
  OUTBOX_CHANNEL,
  OutboxEvent,
  claimAndFetchEvents,
  CLAIM_STATUS,
} from "../repositories"
import { withTransaction } from "../db"
import { DebounceWithMaxWait } from "./debounce"
import { logger } from "./logger"

export interface OutboxListenerConfig {
  /**
   * Unique identifier for this listener (used for cursor tracking).
   */
  listenerId: string
  /**
   * Handler called for each event.
   *
   * IMPORTANT: Handlers run OUTSIDE the claim transaction, so they can safely
   * use withClient() for nested DB queries. However, if a handler fails, the
   * event is skipped (cursor already advanced). For critical processing that
   * needs retry semantics, dispatch to pg-boss instead of doing work inline.
   */
  handler: (event: OutboxEvent) => Promise<void>
  /**
   * Pool for LISTEN connections (held indefinitely).
   * Should be a dedicated pool to avoid starving transactional work.
   */
  listenPool: Pool
  /**
   * Pool for transactional work (event fetching, cursor updates).
   * Should be the main application pool.
   */
  queryPool: Pool
  batchSize?: number
  debounceMs?: number
  maxWaitMs?: number
  fallbackPollMs?: number
  keepaliveMs?: number
}

const DEFAULT_CONFIG = {
  batchSize: 100,
  debounceMs: 50,
  maxWaitMs: 200,
  // Fallback poll is a safety net for missed NOTIFY events - 2s is sufficient
  // since real-time delivery uses LISTEN/NOTIFY. Lower values cause connection pressure.
  fallbackPollMs: 2000,
  keepaliveMs: 30000,
}

/**
 * Processes outbox events with NOTIFY/LISTEN for real-time delivery.
 *
 * Uses separate pools for LISTEN connections (held indefinitely) and
 * transactional queries (short-lived) to prevent connection starvation.
 *
 * @example
 * ```ts
 * const listener = new OutboxListener({
 *   listenerId: "broadcast",
 *   listenPool: pools.listen,  // Dedicated pool for LISTEN connections
 *   queryPool: pools.main,     // Main pool for transactional work
 *   handler: async (event) => {
 *     io.to(`stream:${event.payload.streamId}`).emit(event.eventType, event.payload)
 *   },
 * })
 * await listener.start()
 * ```
 */
export class OutboxListener {
  private listenPool: Pool
  private queryPool: Pool
  private listenerId: string
  private handler: (event: OutboxEvent) => Promise<void>
  private batchSize: number
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

  constructor(config: OutboxListenerConfig) {
    this.listenPool = config.listenPool
    this.queryPool = config.queryPool
    this.listenerId = config.listenerId
    this.handler = config.handler
    this.batchSize = config.batchSize ?? DEFAULT_CONFIG.batchSize
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
    await withTransaction(this.queryPool, async (client) => {
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
      this.listenClient = await this.listenPool.connect()

      this.listenClient.on("notification", () => {
        if (this.debouncer) {
          this.debouncer.trigger()
        }
      })

      this.listenClient.on("error", (err: Error) => {
        // Ignore errors during shutdown - pool close triggers connection termination
        if (!this.running) return
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

      // Only schedule next poll if still running - prevents orphaned timers after stop()
      if (this.running) {
        this.startFallbackPoll()
      }
    }, this.fallbackPollMs)
  }

  /**
   * Process events in batches, releasing the connection between batches.
   *
   * This two-phase approach prevents connection pool exhaustion:
   * 1. Short transaction: claim events and advance cursor
   * 2. Process events outside transaction (handlers can safely use withClient)
   *
   * The cursor is advanced BEFORE processing (optimistic). If a handler fails,
   * that event is effectively "skipped" by this listener. Critical processing
   * should dispatch to pg-boss for durability rather than doing work inline.
   */
  private async processEvents(): Promise<void> {
    if (!this.running) return

    // Process batches until no more events
    while (true) {
      if (!this.running) return

      // Phase 1: Claim events (short transaction, releases connection on return)
      const result = await claimAndFetchEvents(this.queryPool, this.listenerId, this.batchSize)

      if (result.status === CLAIM_STATUS.NOT_READY) {
        // In backoff or locked by another processor
        return
      }

      if (result.status === CLAIM_STATUS.NO_EVENTS) {
        // No more events to process
        return
      }

      // Phase 2: Process events (no connection held)
      // Handlers can safely call withClient() without competing with our claim
      const { events } = result
      for (const event of events) {
        try {
          await this.handler(event)
        } catch (err) {
          // Log but continue - cursor already advanced past this event
          // Critical processing should dispatch to pg-boss for durability
          logger.error(
            {
              err,
              listenerId: this.listenerId,
              eventId: event.id.toString(),
              eventType: event.eventType,
            },
            "Handler error (event skipped - use pg-boss for durability)"
          )
        }
      }

      logger.debug({ listenerId: this.listenerId, count: events.length }, "Processed outbox events")

      // Continue to next batch if we got a full batch (more events likely)
      if (events.length < this.batchSize) {
        return
      }
    }
  }
}
