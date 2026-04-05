import { db, sequenceToNum } from "@/db"
import {
  StreamTypes,
  type StreamEvent,
  type Stream,
  type StreamBootstrap,
  type LastMessagePreview,
  type LinkPreviewSummary,
  type WorkspaceBootstrap,
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
  const bootstrapEventIds = new Set(bootstrap.events.map((event) => event.id))
  const bootstrapWindowFloor =
    bootstrap.events.length > 0
      ? bootstrap.events.reduce((min, event) => {
          const sequence = BigInt(event.sequence)
          return sequence < min ? sequence : min
        }, BigInt(bootstrap.events[0].sequence))
      : null
  // Use the actual max event sequence as the ceiling, NOT latestSequence.
  // latestSequence can be higher than the max returned event when new events
  // are created between the server's event query and sequence query. Using
  // latestSequence as the ceiling would delete valid socket events that
  // arrived in that gap (subscribe-then-fetch race, INV-53).
  const bootstrapWindowCeiling =
    bootstrap.events.length > 0
      ? bootstrap.events.reduce((max, event) => {
          const sequence = BigInt(event.sequence)
          return sequence > max ? sequence : max
        }, BigInt(bootstrap.events[0].sequence))
      : BigInt(bootstrap.latestSequence)

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

    // Prune stale cached events inside the fetched bootstrap window.
    // This keeps older paged history (< floor) and newer socket races
    // (> max bootstrap event sequence) while removing ghost events that
    // no longer exist in the server snapshot.
    if (bootstrapWindowFloor !== null) {
      const staleWindowEvents = await db.events
        .where("streamId")
        .equals(streamId)
        .filter((event) => {
          if (bootstrapEventIds.has(event.id)) return false
          if (event._status === "pending" || event._status === "failed") return false
          const sequence = BigInt(event.sequence)
          return sequence >= bootstrapWindowFloor && sequence <= bootstrapWindowCeiling
        })
        .toArray()

      for (const staleEvent of staleWindowEvents) {
        await db.events.delete(staleEvent.id)
      }
    }

    await db.events.bulkPut(
      bootstrap.events.map((e) => ({ ...e, workspaceId, _sequenceNum: sequenceToNum(e.sequence), _cachedAt: now }))
    )
    // Merge stream metadata without destroying fields that only exist on the
    // workspace bootstrap's StreamWithPreview (e.g. lastMessagePreview, which
    // is the sidebar's activity sort key). Use update() for existing records
    // and fall back to put() if the stream doesn't exist in IDB yet.
    const fullStreamData = {
      ...bootstrap.stream,
      pinned: bootstrap.membership?.pinned,
      notificationLevel: bootstrap.membership?.notificationLevel,
      lastReadEventId: bootstrap.membership?.lastReadEventId,
      _cachedAt: now,
    }
    // For DMs, the stream bootstrap endpoint does not resolve viewer-specific
    // display names (that's done at workspace level by resolveDmDisplayNames).
    // Exclude displayName from the update so the resolved name in IDB survives.
    const isDmWithNullName = bootstrap.stream.type === StreamTypes.DM && bootstrap.stream.displayName == null
    if (isDmWithNullName) {
      const { displayName: _, ...withoutDisplayName } = fullStreamData
      const updated = await db.streams.update(bootstrap.stream.id, withoutDisplayName)
      if (updated === 0) {
        await db.streams.put(fullStreamData)
      }
    } else {
      const updated = await db.streams.update(bootstrap.stream.id, fullStreamData)
      if (updated === 0) {
        await db.streams.put(fullStreamData)
      }
    }
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
  // Use compound index to narrow to message_created events for this stream,
  // then filter by messageId in the payload (not indexed but over a small set).
  const events = await db.events
    .where("[streamId+eventType]")
    .equals([streamId, "message_created"])
    .filter((e) => (e.payload as { messageId?: string })?.messageId === messageId)
    .toArray()

  if (events.length === 0) return
  const event = events[0]
  const updatedPayload = updater(event.payload as Record<string, unknown>)
  await db.events.update(event.id, { payload: updatedPayload, _cachedAt: Date.now() })
}

/**
 * Optimistically update a parent message's replyCount and threadId in IDB.
 *
 * Called after draft thread submission so the reply count appears instantly
 * when the user navigates back via breadcrumb. The socket handler for
 * message:updated may miss this event because the panel navigated away
 * from the parent stream (handlers were cleaned up on unmount).
 */
export async function optimisticReplyCountUpdate(
  parentStreamId: string,
  parentMessageId: string,
  threadId: string
): Promise<void> {
  await updateMessageEvent(parentStreamId, parentMessageId, (p) => ({
    ...p,
    threadId,
    replyCount: ((p.replyCount as number) ?? 0) + 1,
  }))
}

/**
 * Swap the threadId on a parent message without touching replyCount.
 *
 * Used when promoting a draft thread: the initial optimistic update set the
 * threadId to the draft panel ID (and incremented replyCount by 1) so the UI
 * surfaced the pending reply immediately. Once the real thread stream is
 * created, we swap the threadId to the server-assigned one so navigation
 * targets the real thread.
 */
export async function setParentThreadId(
  parentStreamId: string,
  parentMessageId: string,
  threadId: string
): Promise<void> {
  await updateMessageEvent(parentStreamId, parentMessageId, (p) => ({
    ...p,
    threadId,
  }))
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

      // Add the real event BEFORE deleting the optimistic one so that
      // Dexie live-query observers never see a frame with neither event.
      await db.events.put({ ...newEvent, workspaceId, _sequenceNum: sequenceToNum(newEvent.sequence), _cachedAt: now })

      // Now remove the optimistic event
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
    })

    // Update sidebar preview in both TanStack cache and IDB so the sort order
    // and preview text survive cold starts (offline-first).
    const newPreview: LastMessagePreview = {
      authorId: newEvent.actorId ?? "",
      authorType: newEvent.actorType ?? "user",
      content: newPayload.contentJson as string,
      createdAt: newEvent.createdAt,
    }

    await db.streams.update(streamId, {
      lastMessagePreview: newPreview,
      _cachedAt: Date.now(),
    })

    queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
      if (!old) return old
      return {
        ...old,
        streams: old.streams.map((stream) => {
          if (stream.id !== streamId) return stream
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
    await db.events.put({
      ...payload.event,
      workspaceId,
      _sequenceNum: sequenceToNum(payload.event.sequence),
      _cachedAt: now,
    })
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
