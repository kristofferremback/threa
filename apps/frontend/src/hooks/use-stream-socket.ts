import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useSocket, useSocketReconnectCount } from "@/contexts"
import { db } from "@/db"
import { joinRoomFireAndForget } from "@/lib/socket-room"
import { streamKeys } from "./use-streams"
import { workspaceKeys } from "./use-workspaces"
import type { StreamEvent, Stream, WorkspaceBootstrap, LastMessagePreview } from "@threa/types"

interface MessageEventPayload {
  workspaceId: string
  streamId: string
  event: StreamEvent
}

interface MessageDeletedPayload {
  workspaceId: string
  streamId: string
  messageId: string
  deletedAt: string
}

interface ReactionPayload {
  workspaceId: string
  streamId: string
  messageId: string
  emoji: string
  memberId: string
}

interface StreamCreatedPayload {
  workspaceId: string
  streamId: string
  stream: Stream
}

interface MessageUpdatedPayload {
  workspaceId: string
  streamId: string
  messageId: string
  updateType: "reply_count" | "content"
  replyCount?: number
  contentMarkdown?: string
}

interface CommandDispatchedPayload {
  workspaceId: string
  streamId: string
  event: StreamEvent
  authorId: string
}

interface CommandCompletedPayload {
  workspaceId: string
  streamId: string
  authorId: string
  event: StreamEvent
}

interface CommandFailedPayload {
  workspaceId: string
  streamId: string
  authorId: string
  event: StreamEvent
}

interface AgentSessionEventPayload {
  workspaceId: string
  streamId: string
  event: StreamEvent
}

interface StreamBootstrap {
  events: StreamEvent[]
  latestSequence: string
}

/**
 * Hook to handle real-time message/reaction events for a specific stream.
 * Joins the stream room and listens for events, updating React Query cache and IndexedDB.
 *
 * Bootstrap hooks also use join ack via joinRoomWithAck before fetching.
 * This hook keeps the room subscription active for realtime updates.
 */
export function useStreamSocket(workspaceId: string, streamId: string, options?: { enabled?: boolean }) {
  const shouldSubscribe = options?.enabled ?? true
  const queryClient = useQueryClient()
  const socket = useSocket()
  const reconnectCount = useSocketReconnectCount()

  useEffect(() => {
    if (!socket || !workspaceId || !streamId || !shouldSubscribe) return

    const room = `ws:${workspaceId}:stream:${streamId}`
    const abortController = new AbortController()

    // Subscribe FIRST (before any fetches happen)
    joinRoomFireAndForget(socket, room, abortController.signal, "StreamSocket")

    // Ensure bootstrap data is fresh after (re-)subscribing to the room.
    // Skips first mount (no cached data yet — bootstrap queryFn handles that).
    const existingState = queryClient.getQueryState(streamKeys.bootstrap(workspaceId, streamId))
    if (existingState?.status === "success") {
      queryClient.invalidateQueries({
        queryKey: streamKeys.bootstrap(workspaceId, streamId),
      })
    }

    const handleMessageCreated = async (payload: MessageEventPayload) => {
      if (payload.streamId !== streamId) return

      const newEvent = payload.event
      const newPayload = newEvent.payload as { contentJson: unknown; contentMarkdown: string }

      // Update stream bootstrap cache
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap

        // Dedupe by event ID (might be our own optimistic event)
        if (bootstrap.events.some((e) => e.id === newEvent.id)) return old

        // Find matching optimistic event (temp_ prefix, same content and actor)
        // Remove only the first match so sending identical messages quickly still works
        const matchingOptimisticIdx = bootstrap.events.findIndex((e) => {
          if (!e.id.startsWith("temp_")) return false
          const existingPayload = e.payload as { contentMarkdown: string }
          return e.actorId === newEvent.actorId && existingPayload.contentMarkdown === newPayload.contentMarkdown
        })

        let events = bootstrap.events
        if (matchingOptimisticIdx !== -1) {
          // Atomically remove optimistic event while adding real event
          events = [
            ...bootstrap.events.slice(0, matchingOptimisticIdx),
            ...bootstrap.events.slice(matchingOptimisticIdx + 1),
          ]
        }

        return {
          ...bootstrap,
          events: [...events, newEvent],
          latestSequence: newEvent.sequence,
        }
      })

      // Update workspace bootstrap cache's stream preview for sidebar
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        return {
          ...old,
          streams: old.streams.map((stream) => {
            if (stream.id !== streamId) return stream
            const newPreview: LastMessagePreview = {
              authorId: newEvent.actorId ?? "",
              authorType: newEvent.actorType ?? "member",
              content: newPayload.contentJson as string, // ProseMirror JSONContent stored as string
              createdAt: newEvent.createdAt,
            }
            return { ...stream, lastMessagePreview: newPreview }
          }),
        }
      })

      await db.events.put({ ...payload.event, _cachedAt: Date.now() })
    }

    // Reads the updated message_created event from the query cache and persists it to IndexedDB.
    // Must be called after the cache mutation so the persisted snapshot reflects the latest state.
    const persistUpdatedMessageEvent = async (messageId: string) => {
      const bootstrap = queryClient.getQueryData(streamKeys.bootstrap(workspaceId, streamId)) as
        | StreamBootstrap
        | undefined
      const updatedEvent = bootstrap?.events.find((e) => {
        if (e.eventType !== "message_created") return false
        return (e.payload as { messageId: string }).messageId === messageId
      })
      if (updatedEvent) {
        await db.events.put({ ...updatedEvent, _cachedAt: Date.now() })
      }
    }

    const handleMessageEdited = async (payload: MessageEventPayload) => {
      if (payload.streamId !== streamId) return

      const editEvent = payload.event
      const editPayload = editEvent.payload as { messageId: string; contentJson: unknown; contentMarkdown: string }

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        return {
          ...bootstrap,
          events: bootstrap.events.map((e) => {
            if (e.eventType !== "message_created") return e
            const eventPayload = e.payload as { messageId: string }
            if (eventPayload.messageId !== editPayload.messageId) return e
            return {
              ...e,
              payload: {
                ...eventPayload,
                contentJson: editPayload.contentJson,
                contentMarkdown: editPayload.contentMarkdown,
                editedAt: editEvent.createdAt,
              },
            }
          }),
        }
      })

      await persistUpdatedMessageEvent(editPayload.messageId)
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
            return { ...e, payload: { ...eventPayload, deletedAt: payload.deletedAt } }
          }),
        }
      })

      await persistUpdatedMessageEvent(payload.messageId)
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
            reactions[payload.emoji] = [...(reactions[payload.emoji] || []), payload.memberId]
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
              reactions[payload.emoji] = reactions[payload.emoji].filter((id) => id !== payload.memberId)
              if (reactions[payload.emoji].length === 0) {
                delete reactions[payload.emoji]
              }
            }
            return { ...e, payload: { ...eventPayload, reactions } }
          }),
        }
      })
    }

    // Handle thread creation - update parent message with threadId reference
    const handleStreamCreated = (payload: StreamCreatedPayload) => {
      // Only handle if it's a thread in THIS stream
      if (payload.streamId !== streamId) return
      const stream = payload.stream
      if (!stream.parentMessageId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        return {
          ...bootstrap,
          events: bootstrap.events.map((e) => {
            if (e.eventType !== "message_created") return e
            const eventPayload = e.payload as { messageId: string; threadId?: string }
            if (eventPayload.messageId !== stream.parentMessageId) return e
            // Add threadId to the message payload
            return { ...e, payload: { ...eventPayload, threadId: stream.id } }
          }),
        }
      })
    }

    // Handle message updates (reply count changes, content edits)
    const handleMessageUpdated = (payload: MessageUpdatedPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        return {
          ...bootstrap,
          events: bootstrap.events.map((e) => {
            if (e.eventType !== "message_created") return e
            const eventPayload = e.payload as { messageId: string; replyCount?: number; contentMarkdown?: string }
            if (eventPayload.messageId !== payload.messageId) return e

            // Only update the field specified by updateType
            if (payload.updateType === "reply_count" && payload.replyCount !== undefined) {
              return { ...e, payload: { ...eventPayload, replyCount: payload.replyCount } }
            }
            if (payload.updateType === "content" && payload.contentMarkdown !== undefined) {
              return { ...e, payload: { ...eventPayload, contentMarkdown: payload.contentMarkdown } }
            }
            return e
          }),
        }
      })
    }

    // Handle command events (author-only, already filtered by server)
    const handleCommandDispatched = async (payload: CommandDispatchedPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        // Dedupe by event ID
        if (bootstrap.events.some((e) => e.id === payload.event.id)) return old
        return {
          ...bootstrap,
          events: [...bootstrap.events, payload.event],
          latestSequence: payload.event.sequence,
        }
      })

      await db.events.put({ ...payload.event, _cachedAt: Date.now() })
    }

    const handleCommandCompleted = async (payload: CommandCompletedPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        // Dedupe by event ID
        if (bootstrap.events.some((e) => e.id === payload.event.id)) return old
        return {
          ...bootstrap,
          events: [...bootstrap.events, payload.event],
          latestSequence: payload.event.sequence,
        }
      })

      await db.events.put({ ...payload.event, _cachedAt: Date.now() })
    }

    const handleCommandFailed = async (payload: CommandFailedPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        // Dedupe by event ID
        if (bootstrap.events.some((e) => e.id === payload.event.id)) return old
        return {
          ...bootstrap,
          events: [...bootstrap.events, payload.event],
          latestSequence: payload.event.sequence,
        }
      })

      await db.events.put({ ...payload.event, _cachedAt: Date.now() })
    }

    // Handle member_joined events (stream-scoped, visible to all stream viewers)
    const handleMemberJoined = async (payload: AgentSessionEventPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        if (bootstrap.events.some((e) => e.id === payload.event.id)) return old
        return {
          ...bootstrap,
          events: [...bootstrap.events, payload.event],
          latestSequence: payload.event.sequence,
        }
      })

      await db.events.put({ ...payload.event, _cachedAt: Date.now() })
    }

    // Handle agent session events (stream-scoped, visible to all members)
    const handleAgentSessionEvent = async (payload: AgentSessionEventPayload) => {
      if (payload.streamId !== streamId) return

      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as StreamBootstrap
        if (bootstrap.events.some((e) => e.id === payload.event.id)) return old
        return {
          ...bootstrap,
          events: [...bootstrap.events, payload.event],
          latestSequence: payload.event.sequence,
        }
      })

      await db.events.put({ ...payload.event, _cachedAt: Date.now() })
    }

    socket.on("message:created", handleMessageCreated)
    socket.on("message:edited", handleMessageEdited)
    socket.on("message:deleted", handleMessageDeleted)
    socket.on("reaction:added", handleReactionAdded)
    socket.on("reaction:removed", handleReactionRemoved)
    socket.on("stream:created", handleStreamCreated)
    socket.on("message:updated", handleMessageUpdated)
    socket.on("stream:member_joined", handleMemberJoined)
    socket.on("command:dispatched", handleCommandDispatched)
    socket.on("command:completed", handleCommandCompleted)
    socket.on("command:failed", handleCommandFailed)
    socket.on("agent_session:started", handleAgentSessionEvent)
    socket.on("agent_session:completed", handleAgentSessionEvent)
    socket.on("agent_session:failed", handleAgentSessionEvent)
    socket.on("agent_session:deleted", handleAgentSessionEvent)

    return () => {
      abortController.abort()
      // Do NOT leave the room here. Socket.io rooms are not reference-counted:
      // a single leave undoes ALL joins. useSocketEvents also joins this room
      // for stream:activity delivery — leaving here would break sidebar updates.
      // Room lifecycle is managed by useSocketEvents (member streams) and
      // cleaned up on socket disconnect.
      socket.off("message:created", handleMessageCreated)
      socket.off("message:edited", handleMessageEdited)
      socket.off("message:deleted", handleMessageDeleted)
      socket.off("reaction:added", handleReactionAdded)
      socket.off("reaction:removed", handleReactionRemoved)
      socket.off("stream:created", handleStreamCreated)
      socket.off("message:updated", handleMessageUpdated)
      socket.off("stream:member_joined", handleMemberJoined)
      socket.off("command:dispatched", handleCommandDispatched)
      socket.off("command:completed", handleCommandCompleted)
      socket.off("command:failed", handleCommandFailed)
      socket.off("agent_session:started", handleAgentSessionEvent)
      socket.off("agent_session:completed", handleAgentSessionEvent)
      socket.off("agent_session:failed", handleAgentSessionEvent)
      socket.off("agent_session:deleted", handleAgentSessionEvent)
    }
  }, [socket, workspaceId, streamId, shouldSubscribe, queryClient, reconnectCount])
}
