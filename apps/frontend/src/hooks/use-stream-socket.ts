import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useSocket } from "@/contexts"
import { db } from "@/db"
import { streamKeys } from "./use-streams"
import type { StreamEvent } from "@threa/types"

interface MessageEventPayload {
  workspaceId: string
  streamId: string
  event: StreamEvent
}

interface MessageDeletedPayload {
  workspaceId: string
  streamId: string
  messageId: string
}

interface ReactionPayload {
  workspaceId: string
  streamId: string
  messageId: string
  emoji: string
  userId: string
}

interface StreamBootstrap {
  events: StreamEvent[]
  latestSequence: string
}

/**
 * Hook to handle real-time message/reaction events for a specific stream.
 * Joins the stream room and listens for events, updating React Query cache and IndexedDB.
 *
 * Pattern: Subscribe-then-bootstrap
 * 1. Join stream room (subscribe)
 * 2. useEvents fetches bootstrap data
 * 3. This hook receives real-time updates
 */
export function useStreamSocket(workspaceId: string, streamId: string, options?: { enabled?: boolean }) {
  const shouldSubscribe = options?.enabled ?? true
  const queryClient = useQueryClient()
  const socket = useSocket()

  useEffect(() => {
    if (!socket || !workspaceId || !streamId || !shouldSubscribe) return

    const room = `ws:${workspaceId}:stream:${streamId}`

    // Subscribe FIRST (before any fetches happen)
    socket.emit("join", room)

    const handleMessageCreated = async (payload: MessageEventPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        // Dedupe by event ID (might be our own optimistic event)
        if (bootstrap.events.some((e) => e.id === payload.event.id)) return old
        return {
          ...bootstrap,
          events: [...bootstrap.events, payload.event],
          latestSequence: payload.event.sequence,
        }
      })

      await db.events.put({ ...payload.event, _cachedAt: Date.now() })
    }

    const handleMessageEdited = async (payload: MessageEventPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        return {
          ...bootstrap,
          events: [...bootstrap.events, payload.event],
        }
      })

      await db.events.put({ ...payload.event, _cachedAt: Date.now() })
    }

    const handleMessageDeleted = async (payload: MessageDeletedPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        return {
          ...bootstrap,
          events: bootstrap.events.map((e) => {
            if (e.eventType !== "message_created") return e
            const eventPayload = e.payload as { messageId: string }
            if (eventPayload.messageId !== payload.messageId) return e
            return { ...e, payload: { ...eventPayload, deletedAt: new Date().toISOString() } }
          }),
        }
      })
    }

    const handleReactionAdded = async (payload: ReactionPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        return {
          ...bootstrap,
          events: bootstrap.events.map((e) => {
            if (e.eventType !== "message_created") return e
            const eventPayload = e.payload as { messageId: string; reactions?: Record<string, string[]> }
            if (eventPayload.messageId !== payload.messageId) return e
            const reactions = { ...(eventPayload.reactions ?? {}) }
            reactions[payload.emoji] = [...(reactions[payload.emoji] || []), payload.userId]
            return { ...e, payload: { ...eventPayload, reactions } }
          }),
        }
      })
    }

    const handleReactionRemoved = async (payload: ReactionPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        return {
          ...bootstrap,
          events: bootstrap.events.map((e) => {
            if (e.eventType !== "message_created") return e
            const eventPayload = e.payload as { messageId: string; reactions?: Record<string, string[]> }
            if (eventPayload.messageId !== payload.messageId) return e
            const reactions = { ...(eventPayload.reactions ?? {}) }
            if (reactions[payload.emoji]) {
              reactions[payload.emoji] = reactions[payload.emoji].filter((id) => id !== payload.userId)
              if (reactions[payload.emoji].length === 0) {
                delete reactions[payload.emoji]
              }
            }
            return { ...e, payload: { ...eventPayload, reactions } }
          }),
        }
      })
    }

    socket.on("message:created", handleMessageCreated)
    socket.on("message:edited", handleMessageEdited)
    socket.on("message:deleted", handleMessageDeleted)
    socket.on("reaction:added", handleReactionAdded)
    socket.on("reaction:removed", handleReactionRemoved)

    return () => {
      socket.emit("leave", room)
      socket.off("message:created", handleMessageCreated)
      socket.off("message:edited", handleMessageEdited)
      socket.off("message:deleted", handleMessageDeleted)
      socket.off("reaction:added", handleReactionAdded)
      socket.off("reaction:removed", handleReactionRemoved)
    }
  }, [socket, workspaceId, streamId, shouldSubscribe, queryClient])
}
