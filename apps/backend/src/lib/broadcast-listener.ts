import { Pool } from "pg"
import { Server } from "socket.io"
import { OutboxListener, OutboxListenerConfig } from "./outbox-listener"
import { isStreamScopedEvent } from "../repositories/outbox-repository"

/**
 * Creates a broadcast listener that emits outbox events to Socket.io rooms.
 *
 * Stream-scoped events (messages, reactions) are broadcast to stream rooms: `ws:${workspaceId}:stream:${streamId}`
 * Workspace-scoped events (stream metadata, attachments) are broadcast to workspace rooms: `ws:${workspaceId}`
 */
export function createBroadcastListener(
  pool: Pool,
  io: Server,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">
): OutboxListener {
  return new OutboxListener(pool, {
    ...config,
    listenerId: "broadcast",
    handler: async (event) => {
      const { workspaceId } = event.payload

      if (isStreamScopedEvent(event)) {
        // Stream-scoped events go to stream room (only clients in that stream)
        const { streamId } = event.payload
        io.to(`ws:${workspaceId}:stream:${streamId}`).emit(event.eventType, event.payload)
      } else {
        // Workspace-scoped events go to workspace room (all clients in workspace)
        io.to(`ws:${workspaceId}`).emit(event.eventType, event.payload)
      }
    },
  })
}
