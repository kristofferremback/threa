import { Pool } from "pg"
import { Server } from "socket.io"
import { OutboxListener, OutboxListenerConfig } from "./outbox-listener"

/**
 * Creates a broadcast listener that emits outbox events to Socket.io rooms.
 *
 * Events are broadcast to workspace-scoped stream rooms: `ws:${workspaceId}:stream:${streamId}`
 */
export function createBroadcastListener(
  pool: Pool,
  io: Server,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">,
): OutboxListener {
  return new OutboxListener(pool, {
    ...config,
    listenerId: "broadcast",
    handler: async (event) => {
      const { workspaceId, streamId } = event.payload
      io.to(`ws:${workspaceId}:stream:${streamId}`).emit(event.eventType, event.payload)
    },
  })
}
