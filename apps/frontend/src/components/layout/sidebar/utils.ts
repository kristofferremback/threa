import { serializeToMarkdown } from "@threa/prosemirror"
import { AuthorTypes, type JSONContent, type StreamWithPreview } from "@threa/types"
import { stripMarkdown } from "@/lib/markdown"
import { getStreamName } from "@/lib/streams"
import type { SectionKey, SortType, StreamItemData, UrgencyLevel } from "./types"

/** Calculate urgency level for a stream based on unread and mention state */
export function calculateUrgency(
  stream: StreamWithPreview,
  unreadCount: number,
  mentionCount: number,
  isMuted: boolean
): UrgencyLevel {
  if (isMuted) return "quiet"

  if (mentionCount > 0) return "mentions"

  if (stream.lastMessagePreview?.authorType === AuthorTypes.PERSONA && unreadCount > 0) {
    return "ai"
  }

  if (unreadCount > 0) return "activity"

  return "quiet"
}

/** Categorize stream into smart section */
export function categorizeStream(stream: StreamWithPreview, unreadCount: number, urgency: UrgencyLevel): SectionKey {
  // TODO: Add pinned support when backend implements it
  // if (stream.isPinned && unreadCount > 0) return "important"
  // if (stream.isPinned) return "pinned"

  // Important: mentions or AI activity with unread
  if (urgency === "mentions" || (urgency === "ai" && unreadCount > 0)) {
    return "important"
  }

  // Recent: activity in last 7 days
  if (stream.lastMessagePreview) {
    const diff = Date.now() - new Date(stream.lastMessagePreview.createdAt).getTime()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    if (diff < sevenDays) {
      return "recent"
    }
  }

  return "other"
}

/** Truncate content for preview display. Accepts either JSONContent or plain markdown string. */
export function truncateContent(content: JSONContent | string, maxLength: number = 50): string {
  const markdown = typeof content === "string" ? content : serializeToMarkdown(content)
  const stripped = stripMarkdown(markdown).replace(/\n+/g, " ")
  return stripped.length > maxLength ? stripped.slice(0, maxLength) + "..." : stripped
}

/** Get display name for sorting (handles channels, scratchpads, DMs) */
function getStreamSortName(stream: StreamWithPreview): string {
  return (getStreamName(stream) ?? "").toLowerCase()
}

/** Get activity timestamp for sorting (most recent message or creation) */
function getActivityTime(stream: StreamWithPreview): number {
  const timestamp = stream.lastMessagePreview?.createdAt ?? stream.createdAt
  return new Date(timestamp).getTime()
}

/**
 * Sort streams by the specified sort type.
 * @param streams - Array of streams to sort (mutates in place for efficiency)
 * @param sortType - Sorting strategy to use
 * @param getUnreadCount - Function to get unread count for a stream
 */
export function sortStreams(
  streams: StreamItemData[],
  sortType: SortType,
  getUnreadCount: (streamId: string) => number
): StreamItemData[] {
  switch (sortType) {
    case "activity":
      // Most recent activity first
      return streams.sort((a, b) => getActivityTime(b) - getActivityTime(a))

    case "importance":
      // Mentions first, then AI activity, then by unread count
      return streams.sort((a, b) => {
        if (a.urgency === "mentions" && b.urgency !== "mentions") return -1
        if (a.urgency !== "mentions" && b.urgency === "mentions") return 1
        if (a.urgency === "ai" && b.urgency !== "ai") return -1
        if (a.urgency !== "ai" && b.urgency === "ai") return 1
        return getUnreadCount(b.id) - getUnreadCount(a.id)
      })

    case "alphabetic_active_first":
      // Unreads first (sorted alphabetically), then reads (sorted alphabetically)
      return streams.sort((a, b) => {
        const aUnread = getUnreadCount(a.id) > 0
        const bUnread = getUnreadCount(b.id) > 0
        if (aUnread && !bUnread) return -1
        if (!aUnread && bUnread) return 1
        return getStreamSortName(a).localeCompare(getStreamSortName(b))
      })

    default:
      return streams
  }
}
