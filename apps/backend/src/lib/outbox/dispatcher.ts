import { Pool, PoolClient } from "pg"
import { OUTBOX_CHANNEL } from "./repository"
import { logger } from "../logger"

/**
 * Interface for outbox event handlers.
 * Handlers are opaque to the dispatcher - it just calls handle() on notifications.
 */
export interface OutboxHandler {
  readonly listenerId: string
  handle(): void
}

export interface OutboxDispatcherConfig {
  /**
   * Pool for LISTEN connections (held indefinitely).
   * Should be a dedicated pool to avoid starving transactional work.
   */
  listenPool: Pool
  /**
   * Interval for fallback polling in milliseconds.
   * Ensures events are processed even if NOTIFY is missed.
   */
  fallbackPollMs?: number
  /**
   * Interval for keepalive queries in milliseconds.
   * Detects stale LISTEN connections.
   */
  keepaliveMs?: number
}

const DEFAULT_CONFIG = {
  fallbackPollMs: 2000,
  keepaliveMs: 30000,
}

/**
 * Dispatches outbox notifications to registered handlers.
 *
 * This is a simple fan-out mechanism:
 * - Single LISTEN connection per worker process
 * - On NOTIFY → calls handle() on all registered handlers
 * - Fallback polling ensures delivery even if NOTIFY is missed
 *
 * The dispatcher is intentionally "dumb" - it doesn't know about:
 * - Cursors
 * - Event types
 * - What handlers do with events
 * - Debouncing (handlers manage their own)
 *
 * Each handler is responsible for:
 * - Claiming its cursor lock
 * - Fetching and processing events
 * - Debouncing rapid notifications if needed
 *
 * @example
 * ```ts
 * const dispatcher = new OutboxDispatcher({ listenPool: pools.listen })
 *
 * dispatcher.register(new NamingHandler(pools.main, jobQueue))
 * dispatcher.register(new BroadcastHandler(pools.main, io))
 *
 * await dispatcher.start()
 * ```
 */
export class OutboxDispatcher {
  private listenPool: Pool
  private fallbackPollMs: number
  private keepaliveMs: number

  private handlers: OutboxHandler[] = []
  private running: boolean = false
  private startPromise: Promise<void> | null = null
  private listenClient: PoolClient | null = null
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: OutboxDispatcherConfig) {
    this.listenPool = config.listenPool
    this.fallbackPollMs = config.fallbackPollMs ?? DEFAULT_CONFIG.fallbackPollMs
    this.keepaliveMs = config.keepaliveMs ?? DEFAULT_CONFIG.keepaliveMs
  }

  /**
   * Registers a handler to receive notifications.
   * Must be called before start().
   */
  register(handler: OutboxHandler): void {
    if (this.running) {
      throw new Error("Cannot register handlers after dispatcher has started")
    }
    this.handlers.push(handler)
    logger.debug({ listenerId: handler.listenerId }, "Registered outbox handler")
  }

  async start(): Promise<void> {
    if (this.running) return

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
    if (this.handlers.length === 0) {
      logger.warn("OutboxDispatcher starting with no handlers registered")
    }

    try {
      await this.setupListener()
      this.startFallbackPoll()
      this.running = true

      logger.info(
        {
          handlerCount: this.handlers.length,
          handlers: this.handlers.map((h) => h.listenerId),
          fallbackPollMs: this.fallbackPollMs,
        },
        "OutboxDispatcher started"
      )
    } catch (err) {
      this.cleanup()
      throw err
    }
  }

  async stop(): Promise<void> {
    this.running = false

    if (this.listenClient) {
      try {
        await this.listenClient.query(`UNLISTEN ${OUTBOX_CHANNEL}`)
      } catch {
        // Ignore - cleanup will release the client anyway
      }
    }

    this.cleanup()
    logger.info("OutboxDispatcher stopped")
  }

  private cleanup(): void {
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

  private async setupListener(): Promise<void> {
    try {
      this.listenClient = await this.listenPool.connect()

      this.listenClient.on("notification", () => {
        this.notifyHandlers()
      })

      this.listenClient.on("error", (err: Error) => {
        // Ignore errors during shutdown
        if (!this.running) return
        logger.error({ err }, "LISTEN client error, reconnecting...")
        this.reconnectListener()
      })

      await this.listenClient.query(`LISTEN ${OUTBOX_CHANNEL}`)
      this.startKeepalive()
      logger.debug("LISTEN connection established")
    } catch (err) {
      logger.error({ err }, "Failed to setup LISTEN connection")
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
        // Error will trigger the client's error handler
        logger.debug({ err }, "Keepalive query failed")
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
   */
  private startFallbackPoll(): void {
    this.fallbackTimer = setTimeout(() => {
      if (!this.running) return

      this.notifyHandlers()

      if (this.running) {
        this.startFallbackPoll()
      }
    }, this.fallbackPollMs)
  }

  /**
   * Notify all registered handlers.
   * Handlers are called fire-and-forget - errors are their responsibility.
   */
  private notifyHandlers(): void {
    for (const handler of this.handlers) {
      try {
        handler.handle()
      } catch (err) {
        // Log but continue - one handler failing shouldn't stop others
        logger.error({ err, listenerId: handler.listenerId }, "Handler.handle() threw synchronously")
      }
    }
  }
}
