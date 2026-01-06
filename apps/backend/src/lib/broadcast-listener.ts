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
  type StreamReadOutboxPayload,
  type StreamsReadAllOutboxPayload,
  type UserPreferencesUpdatedOutboxPayload,
} from "../repositories/outbox-repository"
import type { UserSocketRegistry } from "./user-socket-registry"
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
  userSocketRegistry: UserSocketRegistry,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">
): OutboxListener {
  return new OutboxListener(pool, {
    ...config,
    listenerId: "broadcast",
    handler: async (event) => {
      const { workspaceId } = event.payload

      // Author-scoped events: only emit to the author's sockets
      if (isAuthorScopedEvent(event)) {
        const payload = event.payload as
          | CommandDispatchedOutboxPayload
          | CommandCompletedOutboxPayload
          | CommandFailedOutboxPayload
          | StreamReadOutboxPayload
          | StreamsReadAllOutboxPayload
          | UserPreferencesUpdatedOutboxPayload
        const { authorId } = payload

        // O(1) lookup via in-memory registry instead of filtering all sockets in room
        const sockets = userSocketRegistry.getSockets(authorId)
        for (const socket of sockets) {
          socket.emit(event.eventType, event.payload)
        }
        logger.debug({ eventType: event.eventType, authorId, emitted: sockets.length }, "Broadcast author-scoped event")
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
