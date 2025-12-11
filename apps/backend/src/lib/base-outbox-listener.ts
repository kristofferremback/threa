import { Pool, PoolClient } from "pg"
import { withTransaction } from "../db"
import {
  OutboxRepository,
  OutboxListenerRepository,
  OUTBOX_CHANNEL,
  OutboxEvent,
} from "../repositories"
import { DebounceWithMaxWait } from "./debounce"
import { logger } from "./logger"

export interface OutboxListenerConfig {
  listenerId: string
  batchSize?: number
  maxRetries?: number
  baseBackoffMs?: number
  debounceMs?: number
  maxWaitMs?: number
  fallbackPollMs?: number
}

const DEFAULT_CONFIG = {
  batchSize: 100,
  maxRetries: 5,
  baseBackoffMs: 1000,
  debounceMs: 50,
  maxWaitMs: 200,
  fallbackPollMs: 500,
}

export abstract class BaseOutboxListener {
  protected pool: Pool
  protected listenerId: string
  protected batchSize: number
  protected maxRetries: number
  protected baseBackoffMs: number
  protected debounceMs: number
  protected maxWaitMs: number
  protected fallbackPollMs: number

  private running: boolean = false
  private listenClient: PoolClient | null = null
  private debouncer: DebounceWithMaxWait | null = null
  private fallbackTimer: Timer | null = null

  constructor(pool: Pool, config: OutboxListenerConfig) {
    this.pool = pool
    this.listenerId = config.listenerId
    this.batchSize = config.batchSize ?? DEFAULT_CONFIG.batchSize
    this.maxRetries = config.maxRetries ?? DEFAULT_CONFIG.maxRetries
    this.baseBackoffMs = config.baseBackoffMs ?? DEFAULT_CONFIG.baseBackoffMs
    this.debounceMs = config.debounceMs ?? DEFAULT_CONFIG.debounceMs
    this.maxWaitMs = config.maxWaitMs ?? DEFAULT_CONFIG.maxWaitMs
    this.fallbackPollMs = config.fallbackPollMs ?? DEFAULT_CONFIG.fallbackPollMs
  }

  /**
   * Handle a single event. Implementations should throw on failure.
   */
  protected abstract handleEvent(event: OutboxEvent): Promise<void>

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    // Ensure listener exists in the database
    await withTransaction(this.pool, async (client) => {
      await OutboxListenerRepository.ensureListener(client, this.listenerId)
    })

    this.debouncer = new DebounceWithMaxWait(
      () => this.processEvents(),
      this.debounceMs,
      this.maxWaitMs,
      (err) =>
        logger.error(
          { err, listenerId: this.listenerId },
          "OutboxListener debouncer error",
        ),
    )

    await this.setupListener()
    this.startFallbackPoll()

    logger.info(
      {
        listenerId: this.listenerId,
        debounceMs: this.debounceMs,
        maxWaitMs: this.maxWaitMs,
        fallbackPollMs: this.fallbackPollMs,
      },
      "OutboxListener started",
    )
  }

  async stop(): Promise<void> {
    this.running = false

    if (this.debouncer) {
      this.debouncer.cancel()
      this.debouncer = null
    }

    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }

    if (this.listenClient) {
      try {
        await this.listenClient.query(`UNLISTEN ${OUTBOX_CHANNEL}`)
        this.listenClient.release()
      } catch {
        // Ignore errors during cleanup
      }
      this.listenClient = null
    }

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
        logger.error(
          { err, listenerId: this.listenerId },
          "LISTEN client error, reconnecting...",
        )
        this.reconnectListener()
      })

      await this.listenClient.query(`LISTEN ${OUTBOX_CHANNEL}`)
      logger.debug({ listenerId: this.listenerId }, "LISTEN connection established")
    } catch (err) {
      logger.error(
        { err, listenerId: this.listenerId },
        "Failed to setup LISTEN connection",
      )
      this.scheduleReconnect()
    }
  }

  private reconnectListener(): void {
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

  private startFallbackPoll(): void {
    if (!this.running) return

    this.fallbackTimer = setTimeout(async () => {
      try {
        await this.processEvents()
      } catch (err) {
        logger.error(
          { err, listenerId: this.listenerId },
          "OutboxListener fallback poll error",
        )
      }
      this.startFallbackPoll()
    }, this.fallbackPollMs)
  }

  private async processEvents(): Promise<void> {
    if (!this.running) return

    await withTransaction(this.pool, async (client) => {
      // Check if we're in retry backoff
      const isReady = await OutboxListenerRepository.isReadyToProcess(
        client,
        this.listenerId,
      )
      if (!isReady) {
        return
      }

      // Claim exclusive lock on our cursor row
      const state = await OutboxListenerRepository.claimListener(
        client,
        this.listenerId,
      )
      if (!state) {
        logger.warn(
          { listenerId: this.listenerId },
          "Listener not found in database",
        )
        return
      }

      // Fetch events after our cursor (no lock needed)
      const events = await OutboxRepository.fetchAfterId(
        client,
        state.lastProcessedId,
        this.batchSize,
      )

      if (events.length === 0) return

      // Process each event
      let lastProcessedId = state.lastProcessedId
      for (const event of events) {
        try {
          await this.handleEvent(event)
          lastProcessedId = event.id
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          logger.error(
            {
              err,
              listenerId: this.listenerId,
              eventId: event.id.toString(),
              eventType: event.eventType,
            },
            "Error processing outbox event",
          )

          // Update cursor to last successfully processed event
          if (lastProcessedId > state.lastProcessedId) {
            await OutboxListenerRepository.updateCursor(
              client,
              this.listenerId,
              lastProcessedId,
            )
          }

          // Try to schedule retry
          const retryAfter = await OutboxListenerRepository.recordError(
            client,
            this.listenerId,
            errorMessage,
            this.maxRetries,
            this.baseBackoffMs,
          )

          if (retryAfter === null) {
            // Max retries exceeded - move to dead letter
            logger.error(
              {
                listenerId: this.listenerId,
                eventId: event.id.toString(),
                eventType: event.eventType,
              },
              "Max retries exceeded, moving to dead letter",
            )
            await OutboxListenerRepository.moveToDeadLetter(
              client,
              this.listenerId,
              event.id,
              errorMessage,
            )
            // Update cursor past this event so we don't retry it
            await OutboxListenerRepository.updateCursor(
              client,
              this.listenerId,
              event.id,
            )
          }

          // Stop processing this batch - will retry or continue with next event
          return
        }
      }

      // All events processed successfully - update cursor
      await OutboxListenerRepository.updateCursor(
        client,
        this.listenerId,
        lastProcessedId,
      )

      logger.debug(
        { listenerId: this.listenerId, count: events.length },
        "Processed outbox events",
      )
    })
  }
}
