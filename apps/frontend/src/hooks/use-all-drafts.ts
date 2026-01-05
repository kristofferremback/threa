import { useLiveQuery } from "dexie-react-hooks"
import { useCallback, useMemo } from "react"
import { db, type CachedStream } from "@/db"
import { isDraftId } from "./use-draft-scratchpads"

export type DraftType = "scratchpad" | "channel" | "dm" | "thread"

const VALID_DRAFT_TYPES: readonly DraftType[] = ["scratchpad", "channel", "dm", "thread"] as const

function isValidDraftType(type: string): type is DraftType {
  return VALID_DRAFT_TYPES.includes(type as DraftType)
}

export interface UnifiedDraft {
  /** Original draft ID (e.g., "draft_xxx" or "stream:xxx" or "thread:xxx") */
  id: string
  /** Type of stream/draft */
  type: DraftType
  /** Stream ID for navigation (null for threads without cached parent) */
  streamId: string | null
  /** Display name for the draft location */
  displayName: string
  /** Preview of the draft content (truncated) */
  preview: string
  /** Number of attachments */
  attachmentCount: number
  /** Last updated timestamp for sorting */
  updatedAt: number
  /** Navigation href (for use with Link component) */
  href: string | null
}

/**
 * Parse a draft message key to extract stream/thread ID and type.
 * Key formats:
 * - "stream:{streamId}" for messages in streams
 * - "thread:{parentMessageId}" for thread replies
 */
function parseDraftMessageKey(key: string): { type: "stream" | "thread"; id: string } | null {
  if (key.startsWith("stream:")) {
    return { type: "stream", id: key.slice(7) }
  }
  if (key.startsWith("thread:")) {
    return { type: "thread", id: key.slice(7) }
  }
  return null
}

/**
 * Truncate content for preview, preserving word boundaries.
 */
function truncatePreview(content: string, maxLength: number = 80): string {
  const trimmed = content.trim().replace(/\s+/g, " ")
  if (trimmed.length <= maxLength) return trimmed
  const truncated = trimmed.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(" ")
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "…"
}

/**
 * Hook to get all drafts (scratchpads + messages) for a workspace.
 * Returns a unified list sorted by recency.
 */
export function useAllDrafts(workspaceId: string) {
  // Get draft scratchpads
  const draftScratchpads = useLiveQuery(
    () => db.draftScratchpads.where("workspaceId").equals(workspaceId).toArray(),
    [workspaceId],
    []
  )

  // Get draft messages
  const draftMessages = useLiveQuery(
    () => db.draftMessages.where("workspaceId").equals(workspaceId).toArray(),
    [workspaceId],
    []
  )

  // Get cached streams for looking up stream info
  const cachedStreams = useLiveQuery(
    () => db.streams.where("workspaceId").equals(workspaceId).toArray(),
    [workspaceId],
    []
  )

  // Check if we have any thread drafts that need parent message resolution
  const hasThreadDrafts = useMemo(() => (draftMessages ?? []).some((m) => m.id.startsWith("thread:")), [draftMessages])

  // Get cached events for looking up parent messages (for thread drafts)
  // Only query events if we have thread drafts to avoid expensive query for common case
  const cachedEvents = useLiveQuery(
    () => {
      if (!hasThreadDrafts) return []
      const streamIds = (cachedStreams ?? []).map((s) => s.id)
      if (streamIds.length === 0) return []
      return db.events.where("streamId").anyOf(streamIds).toArray()
    },
    [cachedStreams, hasThreadDrafts],
    []
  )

  // Build a map of stream ID -> stream for quick lookup
  const streamMap = useMemo(() => {
    const map = new Map<string, CachedStream>()
    for (const stream of cachedStreams ?? []) {
      map.set(stream.id, stream)
    }
    return map
  }, [cachedStreams])

  // Build a map of messageId -> streamId for looking up parent messages
  // Thread drafts use payload.messageId as key, not event.id
  const messageToStreamMap = useMemo(() => {
    const map = new Map<string, { streamId: string; parentMessageId: string }>()
    for (const event of cachedEvents ?? []) {
      if (event.eventType === "message_created") {
        const payload = event.payload as { messageId?: string }
        if (payload.messageId) {
          map.set(payload.messageId, { streamId: event.streamId, parentMessageId: payload.messageId })
        }
      }
    }
    return map
  }, [cachedEvents])

  // Combine and transform drafts
  const drafts = useMemo((): UnifiedDraft[] => {
    const result: UnifiedDraft[] = []

    // Add draft scratchpads (these are scratchpads that haven't been created on server yet)
    for (const draft of draftScratchpads ?? []) {
      // Check if there's a corresponding draft message with content
      const draftMessageKey = `stream:${draft.id}`
      const draftMessage = (draftMessages ?? []).find((m) => m.id === draftMessageKey)

      // Only include if there's content or attachments
      const hasContent = draftMessage?.content?.trim()
      const hasAttachments = (draftMessage?.attachments?.length ?? 0) > 0

      if (hasContent || hasAttachments) {
        result.push({
          id: draft.id,
          type: "scratchpad",
          streamId: draft.id,
          displayName: draft.displayName || "New scratchpad",
          preview: truncatePreview(draftMessage?.content ?? ""),
          attachmentCount: draftMessage?.attachments?.length ?? 0,
          updatedAt: draftMessage?.updatedAt ?? draft.createdAt,
          href: `/w/${workspaceId}/s/${draft.id}`,
        })
      }
    }

    // Add draft messages for existing streams (channels, DMs, threads)
    for (const draftMessage of draftMessages ?? []) {
      const parsed = parseDraftMessageKey(draftMessage.id)
      if (!parsed) continue

      // Skip if this is for a draft scratchpad (already handled above)
      if (parsed.type === "stream" && isDraftId(parsed.id)) continue

      // Only include if there's content or attachments
      const hasContent = draftMessage.content?.trim()
      const hasAttachments = (draftMessage.attachments?.length ?? 0) > 0
      if (!hasContent && !hasAttachments) continue

      if (parsed.type === "thread") {
        // Thread draft - look up parent message to find stream context
        // parsed.id is the parentMessageId (from thread:{parentMessageId} key)
        const messageInfo = messageToStreamMap.get(parsed.id)
        const parentStream = messageInfo ? streamMap.get(messageInfo.streamId) : null

        let displayName = "Thread reply"
        let href: string | null = null
        if (parentStream) {
          const streamName =
            parentStream.type === "channel"
              ? `#${parentStream.slug || parentStream.displayName || "channel"}`
              : parentStream.displayName || "stream"
          displayName = `Thread in ${streamName}`
          // Thread drafts use ?draft=parentStreamId:parentMessageId to open the draft panel
          href = `/w/${workspaceId}/s/${parentStream.id}?draft=${parentStream.id}:${parsed.id}`
        }

        result.push({
          id: draftMessage.id,
          type: "thread",
          streamId: parentStream?.id ?? null,
          displayName,
          preview: truncatePreview(draftMessage.content),
          attachmentCount: draftMessage.attachments?.length ?? 0,
          updatedAt: draftMessage.updatedAt,
          href,
        })
      } else {
        // Stream draft - look up stream info
        const stream = streamMap.get(parsed.id)

        let displayName: string
        let draftType: DraftType
        if (stream) {
          displayName =
            stream.type === "channel"
              ? `#${stream.slug || stream.displayName || "channel"}`
              : stream.displayName || "Message"
          draftType = isValidDraftType(stream.type) ? stream.type : "channel"
        } else {
          // Stream not in cache - still show the draft with a generic name
          displayName = "Message"
          draftType = "channel" // Default type for icon
        }

        result.push({
          id: draftMessage.id,
          type: draftType,
          streamId: parsed.id,
          displayName,
          preview: truncatePreview(draftMessage.content),
          attachmentCount: draftMessage.attachments?.length ?? 0,
          updatedAt: draftMessage.updatedAt,
          href: `/w/${workspaceId}/s/${parsed.id}`,
        })
      }
    }

    // Sort by recency (most recent first)
    result.sort((a, b) => b.updatedAt - a.updatedAt)

    return result
  }, [draftScratchpads, draftMessages, streamMap, messageToStreamMap])

  // Delete a draft
  const deleteDraft = useCallback(async (draftId: string) => {
    // If it's a draft scratchpad, delete both the scratchpad and any associated message
    if (isDraftId(draftId)) {
      await db.draftScratchpads.delete(draftId)
      await db.draftMessages.delete(`stream:${draftId}`)
    } else {
      // Otherwise just delete the draft message
      await db.draftMessages.delete(draftId)
    }
  }, [])

  return {
    drafts,
    draftCount: drafts.length,
    deleteDraft,
  }
}
