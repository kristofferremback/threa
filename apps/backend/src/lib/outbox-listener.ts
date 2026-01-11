import { Pool, PoolClient } from "pg"
import type { Server } from "socket.io"
import {
  OutboxListenerRepository,
  OUTBOX_CHANNEL,
  OutboxEvent,
  claimAndFetchEvents,
  claimAndProcessEvents,
  CLAIM_STATUS,
  PROCESS_STATUS,
  type PureHandler,
} from "../repositories"
import { withTransaction } from "../db"
import { DebounceWithMaxWait } from "./debounce"
import { logger } from "./logger"
import type { JobQueueManager } from "./job-queue"
import type { UserSocketRegistry } from "./user-socket-registry"

export interface OutboxListenerConfig {
  /**
   * Unique identifier for this listener (used for cursor tracking).
   */
  listenerId: string
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

  /**
   * Simple handler mode: handler runs outside the claim transaction.
   *
   * IMPORTANT: If handler fails, event is skipped (cursor already advanced).
   * For critical processing that needs guaranteed delivery, use pureHandler instead.
   *
   * Mutually exclusive with pureHandler.
   */
  handler?: (event: OutboxEvent) => Promise<void>

  /**
   * Pure handler mode: handler returns effects executed transactionally.
   *
   * Durable effects (pg-boss jobs) are committed atomically with the cursor,
   * guaranteeing at-least-once delivery. Ephemeral effects (Socket.io) run after commit.
   *
   * Requires jobQueue. Mutually exclusive with handler.
   */
  pureHandler?: PureHandler

  /**
   * Job queue manager for executing durable job effects.
   * Required when using pureHandler.
   */
  jobQueue?: JobQueueManager

  /**
   * Socket.io server for executing emit effects in pure handler mode.
   */
  io?: Server

  /**
   * User socket registry for emitToUser effects in pure handler mode.
   */
  userSocketRegistry?: UserSocketRegistry
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
 * Supports two processing modes:
 *
 * **Simple handler mode** (handler): For ephemeral work like Socket.io emits.
 * Events are claimed optimistically and handler runs outside the transaction.
 * If handler fails, event is skipped.
 *
 * **Pure handler mode** (pureHandler + jobQueue): For durable work like pg-boss dispatch.
 * Handler returns effects which are executed transactionally. Durable effects (pg-boss jobs)
 * are committed atomically with the cursor update, guaranteeing at-least-once delivery.
 *
 * @example Simple handler (ephemeral)
 * ```ts
 * const listener = new OutboxListener({
 *   listenerId: "broadcast",
 *   listenPool: pools.listen,
 *   queryPool: pools.main,
 *   handler: async (event) => {
 *     io.to(`stream:${event.payload.streamId}`).emit(event.eventType, event.payload)
 *   },
 * })
 * ```
 *
 * @example Pure handler (durable)
 * ```ts
 * const listener = new OutboxListener({
 *   listenerId: "companion",
 *   listenPool: pools.listen,
 *   queryPool: pools.main,
 *   jobQueue,
 *   pureHandler: async (event, client) => {
 *     if (event.eventType !== "message:created") return []
 *     const stream = await StreamRepository.findById(client, event.payload.streamId)
 *     if (!stream || stream.companionMode !== "on") return []
 *     return [job(JobQueues.PERSONA_AGENT, { ... })]
 *   },
 * })
 * ```
 */
export class OutboxListener {
  private listenPool: Pool
  private queryPool: Pool
  private listenerId: string
  private batchSize: number
  private debounceMs: number
  private maxWaitMs: number
  private fallbackPollMs: number
  private keepaliveMs: number

  // Handler mode fields (mutually exclusive)
  private handler: ((event: OutboxEvent) => Promise<void>) | null = null
  private pureHandler: PureHandler | null = null
  private jobQueue: JobQueueManager | null = null
  private io: Server | null = null
  private userSocketRegistry: UserSocketRegistry | null = null

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
    this.batchSize = config.batchSize ?? DEFAULT_CONFIG.batchSize
    this.debounceMs = config.debounceMs ?? DEFAULT_CONFIG.debounceMs
    this.maxWaitMs = config.maxWaitMs ?? DEFAULT_CONFIG.maxWaitMs
    this.fallbackPollMs = config.fallbackPollMs ?? DEFAULT_CONFIG.fallbackPollMs
    this.keepaliveMs = config.keepaliveMs ?? DEFAULT_CONFIG.keepaliveMs

    // Validate and set handler mode
    if (config.handler && config.pureHandler) {
      throw new Error("OutboxListener: cannot specify both handler and pureHandler")
    }

    if (config.pureHandler && !config.jobQueue) {
      throw new Error("OutboxListener: pureHandler requires jobQueue")
    }

    if (config.handler) {
      this.handler = config.handler
    } else if (config.pureHandler) {
      this.pureHandler = config.pureHandler
      this.jobQueue = config.jobQueue!
      this.io = config.io ?? null
      this.userSocketRegistry = config.userSocketRegistry ?? null
    } else {
      throw new Error("OutboxListener requires either handler or pureHandler")
    }
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
   * Process events in batches.
   *
   * Behavior depends on handler mode:
   * - Simple handler: optimistic claim, handler runs outside transaction
   * - Pure handler: transactional claim, durable effects in transaction, ephemeral after
   */
  private async processEvents(): Promise<void> {
    if (!this.running) return

    if (this.pureHandler && this.jobQueue) {
      await this.processEventsWithPureHandler()
    } else if (this.handler) {
      await this.processEventsWithSimpleHandler()
    }
  }

  /**
   * Simple handler mode: optimistic claim, handler runs outside transaction.
   * If handler fails, event is skipped (acceptable for ephemeral work).
   */
  private async processEventsWithSimpleHandler(): Promise<void> {
    while (true) {
      if (!this.running) return

      const result = await claimAndFetchEvents(this.queryPool, this.listenerId, this.batchSize)

      if (result.status === CLAIM_STATUS.NOT_READY) {
        return
      }

      if (result.status === CLAIM_STATUS.NO_EVENTS) {
        return
      }

      const { events } = result
      for (const event of events) {
        try {
          await this.handler!(event)
        } catch (err) {
          logger.error(
            {
              err,
              listenerId: this.listenerId,
              eventId: event.id.toString(),
              eventType: event.eventType,
            },
            "Handler error (event skipped)"
          )
        }
      }

      logger.debug({ listenerId: this.listenerId, count: events.length }, "Processed outbox events")

      if (events.length < this.batchSize) {
        return
      }
    }
  }

  /**
   * Pure handler mode: transactional effect execution with guaranteed delivery.
   *
   * Flow:
   * 1. Transaction: claim events, run handler (returns effects), execute pg-boss jobs, commit
   * 2. After commit: execute ephemeral effects (Socket.io)
   *
   * If crash before commit: events will be reprocessed (at-least-once guarantee)
   * If crash after commit: pg-boss jobs are durable, ephemeral effects may be lost (acceptable)
   */
  private async processEventsWithPureHandler(): Promise<void> {
    while (true) {
      if (!this.running) return

      const result = await claimAndProcessEvents(
        this.queryPool,
        this.jobQueue!,
        this.listenerId,
        this.batchSize,
        this.pureHandler!
      )

      if (result.status === PROCESS_STATUS.NOT_READY) {
        return
      }

      if (result.status === PROCESS_STATUS.NO_EVENTS) {
        return
      }

      // Execute ephemeral effects after transaction commit
      for (const effect of result.ephemeralEffects) {
        try {
          if (effect.type === "emit" && this.io) {
            this.io.to(effect.room).emit(effect.event, effect.data)
          } else if (effect.type === "emitToUser" && this.userSocketRegistry) {
            const sockets = this.userSocketRegistry.getSockets(effect.userId)
            for (const socket of sockets) {
              socket.emit(effect.event, effect.data)
            }
          }
        } catch (err) {
          // Log but continue - ephemeral effects are best-effort
          logger.error({ err, listenerId: this.listenerId, effectType: effect.type }, "Ephemeral effect error")
        }
      }

      logger.debug({ listenerId: this.listenerId, count: result.processedCount }, "Processed outbox events")

      if (result.processedCount < this.batchSize) {
        return
      }
    }
  }
}
