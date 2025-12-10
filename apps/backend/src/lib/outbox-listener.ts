import { Pool } from "pg"
import { Server } from "socket.io"
import { withTransaction } from "../db"
import { OutboxRepository } from "../repositories"
import { logger } from "./logger"

interface OutboxListenerOptions {
  pollInterval?: number // milliseconds
  batchSize?: number
}

export class OutboxListener {
  private pool: Pool
  private io: Server
  private pollInterval: number
  private batchSize: number
  private running: boolean = false
  private timer: Timer | null = null

  constructor(pool: Pool, io: Server, options: OutboxListenerOptions = {}) {
    this.pool = pool
    this.io = io
    this.pollInterval = options.pollInterval ?? 100
    this.batchSize = options.batchSize ?? 100
  }

  start() {
    if (this.running) return
    this.running = true
    this.poll()
    logger.info({ pollInterval: this.pollInterval }, "OutboxListener started")
  }

  stop() {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    logger.info("OutboxListener stopped")
  }

  private async poll() {
    if (!this.running) return

    try {
      await this.processEvents()
    } catch (err) {
      logger.error({ err }, "OutboxListener error")
    }

    this.timer = setTimeout(() => this.poll(), this.pollInterval)
  }

  private async processEvents() {
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
    // Payload includes streamId for room targeting
    const data = payload as { streamId?: string; [key: string]: unknown }

    if (data.streamId) {
      // Emit to specific stream room
      this.io.to(`stream:${data.streamId}`).emit(eventType, data)
    } else {
      // Fallback: broadcast to all (shouldn't happen with current events)
      this.io.emit(eventType, data)
    }
  }
}
