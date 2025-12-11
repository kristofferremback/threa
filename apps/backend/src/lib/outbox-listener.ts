import { Pool, PoolClient } from "pg"
import { Server } from "socket.io"
import { withTransaction } from "../db"
import { OutboxRepository, OUTBOX_CHANNEL } from "../repositories"
import { DebounceWithMaxWait } from "./debounce"
import { logger } from "./logger"

interface OutboxListenerOptions {
  batchSize?: number
  debounceMs?: number
  maxWaitMs?: number
  fallbackPollMs?: number
}

export class OutboxListener {
  private pool: Pool
  private io: Server
  private batchSize: number
  private debounceMs: number
  private maxWaitMs: number
  private fallbackPollMs: number

  private running: boolean = false
  private listenClient: PoolClient | null = null
  private debouncer: DebounceWithMaxWait | null = null
  private fallbackTimer: Timer | null = null

  constructor(pool: Pool, io: Server, options: OutboxListenerOptions = {}) {
    this.pool = pool
    this.io = io
    this.batchSize = options.batchSize ?? 100
    this.debounceMs = options.debounceMs ?? 50
    this.maxWaitMs = options.maxWaitMs ?? 200
    this.fallbackPollMs = options.fallbackPollMs ?? 500
  }

  async start() {
    if (this.running) return
    this.running = true

    this.debouncer = new DebounceWithMaxWait(
      () => this.processEvents(),
      this.debounceMs,
      this.maxWaitMs,
      (err) => logger.error({ err }, "OutboxListener debouncer error"),
    )

    await this.setupListener()
    this.startFallbackPoll()

    logger.info(
      {
        debounceMs: this.debounceMs,
        maxWaitMs: this.maxWaitMs,
        fallbackPollMs: this.fallbackPollMs,
      },
      "OutboxListener started",
    )
  }

  async stop() {
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

    logger.info("OutboxListener stopped")
  }

  private async setupListener() {
    try {
      this.listenClient = await this.pool.connect()

      this.listenClient.on("notification", () => {
        if (this.debouncer) {
          this.debouncer.trigger()
        }
      })

      this.listenClient.on("error", (err) => {
        logger.error({ err }, "LISTEN client error, reconnecting...")
        this.reconnectListener()
      })

      await this.listenClient.query(`LISTEN ${OUTBOX_CHANNEL}`)
      logger.debug("LISTEN connection established")
    } catch (err) {
      logger.error({ err }, "Failed to setup LISTEN connection")
      this.scheduleReconnect()
    }
  }

  private reconnectListener() {
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

  private scheduleReconnect() {
    if (!this.running) return

    setTimeout(() => {
      if (this.running) {
        this.setupListener()
      }
    }, 1000)
  }

  private startFallbackPoll() {
    if (!this.running) return

    this.fallbackTimer = setTimeout(async () => {
      try {
        await this.processEvents()
      } catch (err) {
        logger.error({ err }, "OutboxListener fallback poll error")
      }
      this.startFallbackPoll()
    }, this.fallbackPollMs)
  }

  private async processEvents() {
    if (!this.running) return

    await withTransaction(this.pool, async (client) => {
      const events = await OutboxRepository.fetchUnprocessed(client, this.batchSize)

      if (events.length === 0) return

      for (const event of events) {
        this.broadcast(event.eventType, event.payload)
      }

      await OutboxRepository.markProcessed(
        client,
        events.map((e) => e.id),
      )

      logger.debug({ count: events.length }, "Processed outbox events")
    })
  }

  private broadcast(eventType: string, payload: unknown) {
    const data = payload as { streamId?: string; [key: string]: unknown }

    if (data.streamId) {
      this.io.to(`stream:${data.streamId}`).emit(eventType, data)
    } else {
      this.io.emit(eventType, data)
    }
  }
}
