import { Pool } from "pg"
import { Server } from "socket.io"
import { OutboxListener, OutboxListenerConfig } from "./outbox-listener"
import type { OutboxEventType } from "../repositories/outbox-repository"

// Events that are broadcast to the workspace room (all clients in workspace)
// These are stream metadata events and workspace-scoped events
const WORKSPACE_LEVEL_EVENTS: OutboxEventType[] = [
  "stream:created",
  "stream:updated",
  "stream:archived",
  "attachment:uploaded", // No streamId at upload time
]

/**
 * Creates a broadcast listener that emits outbox events to Socket.io rooms.
 *
 * Stream metadata events (create/update/archive) are broadcast to workspace rooms: `ws:${workspaceId}`
 * Message/reaction events are broadcast to stream rooms: `ws:${workspaceId}:stream:${streamId}`
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

      if (WORKSPACE_LEVEL_EVENTS.includes(event.eventType)) {
        // Stream metadata and workspace-scoped events go to workspace room
        io.to(`ws:${workspaceId}`).emit(event.eventType, event.payload)
      } else {
        // Message/reaction events go to stream room (only clients in that stream)
        const streamId = "streamId" in event.payload ? event.payload.streamId : null
        if (streamId) {
          io.to(`ws:${workspaceId}:stream:${streamId}`).emit(event.eventType, event.payload)
        }
      }
    },
  })
}
