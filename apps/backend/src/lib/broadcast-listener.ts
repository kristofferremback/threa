import { Pool } from "pg"
import { Server } from "socket.io"
import { OutboxEvent } from "../repositories"
import { BaseOutboxListener, OutboxListenerConfig } from "./base-outbox-listener"

export class BroadcastListener extends BaseOutboxListener {
  private io: Server

  constructor(
    pool: Pool,
    io: Server,
    config?: Omit<OutboxListenerConfig, "listenerId">,
  ) {
    super(pool, { ...config, listenerId: "broadcast" })
    this.io = io
  }

  protected async handleEvent(event: OutboxEvent): Promise<void> {
    // All outbox payloads have streamId - broadcast to that stream's room
    const { streamId } = event.payload
    this.io.to(`stream:${streamId}`).emit(event.eventType, event.payload)
  }
}
