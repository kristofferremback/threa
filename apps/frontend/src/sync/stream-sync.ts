import { db } from "@/db"
import type {
  StreamEvent,
  Stream,
  StreamBootstrap,
  LastMessagePreview,
  LinkPreviewSummary,
  WorkspaceBootstrap,
} from "@threa/types"
import type { Socket } from "socket.io-client"
import { workspaceKeys } from "@/hooks/use-workspaces"
import type { QueryClient } from "@tanstack/react-query"

// ============================================================================
// Bootstrap application — writes stream bootstrap data to IndexedDB
// ============================================================================

/**
 * Write stream bootstrap data to IndexedDB (merge, not replace).
 *
 * Events are MERGED into IDB via bulkPut. We never delete events here
 * because socket events may have arrived between the bootstrap snapshot
 * and this write (subscribe-then-fetch, INV-53). Deleting would lose them.
 *
 * Stale optimistic events (temp_* no longer in the send queue) are cleaned
 * up since they'll never receive a server confirmation.
 *
 * The read layer (useEvents) handles windowing — it filters IDB events to
 * the bootstrap window + newer, so stale events from previous sessions
 * don't leak into the display.
 */
export async function applyStreamBootstrap(
  workspaceId: string,
  streamId: string,
  bootstrap: StreamBootstrap
): Promise<void> {
  const now = Date.now()
  await db.transaction("rw", [db.events, db.streams, db.pendingMessages], async () => {
    // Clean stale optimistic events — temp_* that are no longer pending
    const tempEvents = await db.events
      .where("streamId")
      .equals(streamId)
      .filter((e) => e.id.startsWith("temp_"))
      .toArray()

    for (const temp of tempEvents) {
      const stillPending = await db.pendingMessages.get(temp.id)
      if (!stillPending) {
        await db.events.delete(temp.id)
      }
    }

    await db.events.bulkPut(bootstrap.events.map((e) => ({ ...e, workspaceId, _cachedAt: now })))
    await db.streams.put({
      ...bootstrap.stream,
      pinned: bootstrap.membership?.pinned,
      notificationLevel: bootstrap.membership?.notificationLevel,
      lastReadEventId: bootstrap.membership?.lastReadEventId,
      _cachedAt: now,
    })
  })
}

// ============================================================================
// Socket event handler payloads
// ============================================================================

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
  userId: string
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

interface CommandEventPayload {
  workspaceId: string
  streamId: string
  event: StreamEvent
  authorId: string
}

interface AgentSessionEventPayload {
  workspaceId: string
  streamId: string
  event: StreamEvent
}

interface LinkPreviewReadyPayload {
  workspaceId: string
  streamId: string
  messageId: string
  previews: LinkPreviewSummary[]
}

// ============================================================================
// Helper: find and update a message_created event in IndexedDB
// ============================================================================

async function updateMessageEvent(
  streamId: string,
  messageId: string,
  updater: (payload: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  // Find the event by scanning for message_created events in this stream
  const events = await db.events
    .where("streamId")
    .equals(streamId)
    .filter((e) => {
      if (e.eventType !== "message_created") return false
      return (e.payload as { messageId?: string })?.messageId === messageId
    })
    .toArray()

  if (events.length === 0) return
  const event = events[0]
  const updatedPayload = updater(event.payload as Record<string, unknown>)
  await db.events.update(event.id, { payload: updatedPayload, _cachedAt: Date.now() })
}

// ============================================================================
// Socket event handlers — write exclusively to IndexedDB
// ============================================================================

/**
 * Register stream-level socket event handlers that write to IndexedDB only.
 * Returns a cleanup function that unregisters all handlers.
 *
 * The workspace bootstrap cache (TanStack Query) is still updated for
 * lastMessagePreview on message:created — this is a transitional coupling
 * that will be removed in Phase 3 when workspace data moves to IDB.
 */
export function registerStreamSocketHandlers(
  socket: Socket,
  workspaceId: string,
  streamId: string,
  queryClient: QueryClient
): () => void {
  const handleMessageCreated = async (payload: MessageEventPayload) => {
    if (payload.streamId !== streamId) return

    const newEvent = payload.event
    const newPayload = newEvent.payload as {
      contentJson: unknown
      contentMarkdown: string
      clientMessageId?: string
    }
    const now = Date.now()

    await db.transaction("rw", [db.events, db.pendingMessages], async () => {
      // Dedupe by event ID
      const existing = await db.events.get(newEvent.id)
      if (existing) return

      // Swap optimistic event for real one
      if (newPayload.clientMessageId) {
        await db.events.delete(newPayload.clientMessageId).catch(() => {})
        await db.pendingMessages.delete(newPayload.clientMessageId).catch(() => {})
      } else {
        // Fallback: content-based match for events sent before clientMessageId was deployed
        const tempEvents = await db.events
          .where("streamId")
          .equals(streamId)
          .filter((e) => {
            if (!e.id.startsWith("temp_")) return false
            const p = e.payload as { contentMarkdown: string }
            return e.actorId === newEvent.actorId && p.contentMarkdown === newPayload.contentMarkdown
          })
          .toArray()
        if (tempEvents.length > 0) {
          await db.events.delete(tempEvents[0].id)
        }
      }

      await db.events.put({ ...newEvent, workspaceId, _cachedAt: now })
    })

    // Transitional: update workspace bootstrap cache's stream preview for sidebar.
    // This will be removed in Phase 3 when workspace data moves to IDB stores.
    queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
      if (!old) return old
      return {
        ...old,
        streams: old.streams.map((stream) => {
          if (stream.id !== streamId) return stream
          const newPreview: LastMessagePreview = {
            authorId: newEvent.actorId ?? "",
            authorType: newEvent.actorType ?? "user",
            content: newPayload.contentJson as string,
            createdAt: newEvent.createdAt,
          }
          return { ...stream, lastMessagePreview: newPreview }
        }),
      }
    })
  }

  const handleMessageEdited = async (payload: MessageEventPayload) => {
    if (payload.streamId !== streamId) return
    const editEvent = payload.event
    const editPayload = editEvent.payload as {
      messageId: string
      contentJson: unknown
      contentMarkdown: string
    }

    await updateMessageEvent(streamId, editPayload.messageId, (p) => ({
      ...p,
      contentJson: editPayload.contentJson,
      contentMarkdown: editPayload.contentMarkdown,
      editedAt: editEvent.createdAt,
    }))
  }

  const handleMessageDeleted = async (payload: MessageDeletedPayload) => {
    if (payload.streamId !== streamId) return
    await updateMessageEvent(streamId, payload.messageId, (p) => ({
      ...p,
      deletedAt: payload.deletedAt,
    }))
  }

  const handleReactionAdded = async (payload: ReactionPayload) => {
    if (payload.streamId !== streamId) return
    await updateMessageEvent(streamId, payload.messageId, (p) => {
      const reactions = { ...((p.reactions as Record<string, string[]>) ?? {}) }
      const existing = reactions[payload.emoji] || []
      if (!existing.includes(payload.userId)) {
        reactions[payload.emoji] = [...existing, payload.userId]
      }
      return { ...p, reactions }
    })
  }

  const handleReactionRemoved = async (payload: ReactionPayload) => {
    if (payload.streamId !== streamId) return
    await updateMessageEvent(streamId, payload.messageId, (p) => {
      const reactions = { ...((p.reactions as Record<string, string[]>) ?? {}) }
      if (reactions[payload.emoji]) {
        reactions[payload.emoji] = reactions[payload.emoji].filter((id) => id !== payload.userId)
        if (reactions[payload.emoji].length === 0) {
          delete reactions[payload.emoji]
        }
      }
      return { ...p, reactions }
    })
  }

  const handleStreamCreated = async (payload: StreamCreatedPayload) => {
    if (payload.streamId !== streamId) return
    const stream = payload.stream
    if (!stream.parentMessageId) return

    await updateMessageEvent(streamId, stream.parentMessageId, (p) => ({
      ...p,
      threadId: stream.id,
    }))
  }

  const handleMessageUpdated = async (payload: MessageUpdatedPayload) => {
    if (payload.streamId !== streamId) return
    await updateMessageEvent(streamId, payload.messageId, (p) => {
      if (payload.updateType === "reply_count" && payload.replyCount !== undefined) {
        return { ...p, replyCount: payload.replyCount }
      }
      if (payload.updateType === "content" && payload.contentMarkdown !== undefined) {
        return { ...p, contentMarkdown: payload.contentMarkdown }
      }
      return p
    })
  }

  const handleAppendEvent = async (payload: AgentSessionEventPayload | CommandEventPayload) => {
    if (payload.streamId !== streamId) return
    const now = Date.now()
    // Dedupe by event ID
    const existing = await db.events.get(payload.event.id)
    if (existing) return
    await db.events.put({ ...payload.event, workspaceId, _cachedAt: now })
  }

  const handleLinkPreviewReady = async (payload: LinkPreviewReadyPayload) => {
    if (payload.streamId !== streamId) return
    await updateMessageEvent(streamId, payload.messageId, (p) => ({
      ...p,
      linkPreviews: payload.previews,
    }))
  }

  socket.on("message:created", handleMessageCreated)
  socket.on("message:edited", handleMessageEdited)
  socket.on("message:deleted", handleMessageDeleted)
  socket.on("reaction:added", handleReactionAdded)
  socket.on("reaction:removed", handleReactionRemoved)
  socket.on("stream:created", handleStreamCreated)
  socket.on("message:updated", handleMessageUpdated)
  socket.on("stream:member_joined", handleAppendEvent)
  socket.on("command:dispatched", handleAppendEvent)
  socket.on("command:completed", handleAppendEvent)
  socket.on("command:failed", handleAppendEvent)
  socket.on("agent_session:started", handleAppendEvent)
  socket.on("agent_session:completed", handleAppendEvent)
  socket.on("agent_session:failed", handleAppendEvent)
  socket.on("agent_session:deleted", handleAppendEvent)
  socket.on("link_preview:ready", handleLinkPreviewReady)

  return () => {
    socket.off("message:created", handleMessageCreated)
    socket.off("message:edited", handleMessageEdited)
    socket.off("message:deleted", handleMessageDeleted)
    socket.off("reaction:added", handleReactionAdded)
    socket.off("reaction:removed", handleReactionRemoved)
    socket.off("stream:created", handleStreamCreated)
    socket.off("message:updated", handleMessageUpdated)
    socket.off("stream:member_joined", handleAppendEvent)
    socket.off("command:dispatched", handleAppendEvent)
    socket.off("command:completed", handleAppendEvent)
    socket.off("command:failed", handleAppendEvent)
    socket.off("agent_session:started", handleAppendEvent)
    socket.off("agent_session:completed", handleAppendEvent)
    socket.off("agent_session:failed", handleAppendEvent)
    socket.off("agent_session:deleted", handleAppendEvent)
    socket.off("link_preview:ready", handleLinkPreviewReady)
  }
}
