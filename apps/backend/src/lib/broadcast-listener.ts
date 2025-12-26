import { Pool } from "pg"
import { Server } from "socket.io"
import { OutboxListener, OutboxListenerConfig } from "./outbox-listener"
import {
  isStreamScopedEvent,
  isOutboxEventType,
  isOneOfOutboxEventType,
  isAuthorScopedEvent,
  type StreamCreatedOutboxPayload,
  type CommandDispatchedOutboxPayload,
  type CommandCompletedOutboxPayload,
  type CommandFailedOutboxPayload,
} from "../repositories/outbox-repository"
import { logger } from "./logger"

/**
 * Creates a broadcast listener that emits outbox events to Socket.io rooms.
 *
 * Stream-scoped events (messages, reactions) are broadcast to stream rooms: `ws:${workspaceId}:stream:${streamId}`
 * Workspace-scoped events (stream metadata, attachments) are broadcast to workspace rooms: `ws:${workspaceId}`
 * Author-scoped events (commands) are broadcast only to sockets belonging to the author.
 *
 * Special case: stream:created events for threads go to the parent stream room (so watchers see thread indicators),
 * while non-thread stream:created events go to the workspace room (so all clients see new channels/scratchpads).
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

      // Author-scoped events: only emit to the author's sockets
      //
      // PERFORMANCE NOTE: This iterates all sockets in the stream room (O(n) where n = connected users).
      // Acceptable for streams with <100 concurrent users. For larger streams, consider adding user-specific
      // rooms (e.g., `ws:${workspaceId}:user:${userId}`) and emitting directly to those instead of filtering.
      // Threshold to consider: ~50-100 concurrent users per stream with frequent author-scoped events.
      if (isAuthorScopedEvent(event)) {
        const payload = event.payload as
          | CommandDispatchedOutboxPayload
          | CommandCompletedOutboxPayload
          | CommandFailedOutboxPayload
        const { streamId, authorId } = payload
        const room = `ws:${workspaceId}:stream:${streamId}`

        // Find all sockets in the stream room and filter by author
        const sockets = await io.in(room).fetchSockets()
        let emitted = 0
        for (const socket of sockets) {
          if (socket.data.userId === authorId) {
            socket.emit(event.eventType, event.payload)
            emitted++
          }
        }
        logger.debug(
          { eventType: event.eventType, authorId, room, socketsInRoom: sockets.length, emitted },
          "Broadcast author-scoped event"
        )
        return
      }

      // Special handling for stream:created - route threads to parent stream room
      if (isOutboxEventType(event, "stream:created")) {
        const payload = event.payload as StreamCreatedOutboxPayload
        if (payload.stream.parentMessageId) {
          io.to(`ws:${workspaceId}:stream:${payload.streamId}`).emit(event.eventType, event.payload)
        } else {
          io.to(`ws:${workspaceId}`).emit(event.eventType, event.payload)
        }
        return
      }

      // Conversation events broadcast to stream + optionally parent stream for discoverability
      if (isOneOfOutboxEventType(event, ["conversation:created", "conversation:updated"])) {
        const payload = event.payload as { streamId: string; parentStreamId?: string }
        io.to(`ws:${workspaceId}:stream:${payload.streamId}`).emit(event.eventType, event.payload)
        if (payload.parentStreamId) {
          io.to(`ws:${workspaceId}:stream:${payload.parentStreamId}`).emit(event.eventType, event.payload)
        }
        return
      }

      if (isStreamScopedEvent(event)) {
        const { streamId } = event.payload
        io.to(`ws:${workspaceId}:stream:${streamId}`).emit(event.eventType, event.payload)
      } else {
        io.to(`ws:${workspaceId}`).emit(event.eventType, event.payload)
      }
    },
  })
}
