import { Pool } from "pg"
import { Server } from "socket.io"
import { OutboxListener, OutboxListenerConfig } from "./outbox-listener"
import {
  isStreamScopedEvent,
  isOutboxEventType,
  type StreamCreatedOutboxPayload,
  type ConversationCreatedOutboxPayload,
  type ConversationUpdatedOutboxPayload,
} from "../repositories/outbox-repository"

/**
 * Creates a broadcast listener that emits outbox events to Socket.io rooms.
 *
 * Stream-scoped events (messages, reactions) are broadcast to stream rooms: `ws:${workspaceId}:stream:${streamId}`
 * Workspace-scoped events (stream metadata, attachments) are broadcast to workspace rooms: `ws:${workspaceId}`
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

      // Special handling for stream:created - route threads to parent stream room
      if (isOutboxEventType(event, "stream:created")) {
        const payload = event.payload as StreamCreatedOutboxPayload
        if (payload.stream.parentMessageId) {
          // Thread - broadcast to parent stream room
          io.to(`ws:${workspaceId}:stream:${payload.streamId}`).emit(event.eventType, event.payload)
        } else {
          // Non-thread - broadcast to workspace room
          io.to(`ws:${workspaceId}`).emit(event.eventType, event.payload)
        }
        return
      }

      // Special handling for conversation events - also broadcast to parent channel for discoverability
      if (isOutboxEventType(event, "conversation:created")) {
        const payload = event.payload as ConversationCreatedOutboxPayload
        io.to(`ws:${workspaceId}:stream:${payload.streamId}`).emit(event.eventType, event.payload)
        if (payload.parentStreamId) {
          // Thread conversation - also broadcast to parent channel so it appears there too
          io.to(`ws:${workspaceId}:stream:${payload.parentStreamId}`).emit(event.eventType, event.payload)
        }
        return
      }

      if (isOutboxEventType(event, "conversation:updated")) {
        const payload = event.payload as ConversationUpdatedOutboxPayload
        io.to(`ws:${workspaceId}:stream:${payload.streamId}`).emit(event.eventType, event.payload)
        if (payload.parentStreamId) {
          // Thread conversation - also broadcast to parent channel so it updates there too
          io.to(`ws:${workspaceId}:stream:${payload.parentStreamId}`).emit(event.eventType, event.payload)
        }
        return
      }

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
