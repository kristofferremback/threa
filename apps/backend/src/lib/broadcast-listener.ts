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
    const payload = event.payload as { streamId?: string; [key: string]: unknown }

    if (payload.streamId) {
      this.io.to(`stream:${payload.streamId}`).emit(event.eventType, payload)
    } else {
      this.io.emit(event.eventType, payload)
    }
  }
}
