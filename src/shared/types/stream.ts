/**
 * Stream Domain Types
 *
 * Canonical type definitions for streams, shared between frontend and backend.
 * The repository layer returns these types directly (not raw database rows).
 */

export type StreamType = "channel" | "thread" | "dm" | "incident" | "thinking_space"
export type StreamVisibility = "public" | "private" | "inherit"
export type StreamStatus = "active" | "archived" | "resolved"
export type NotifyLevel = "all" | "mentions" | "muted" | "default"

/**
 * Base stream entity representing database fields.
 * This is what the repository returns for simple lookups.
 */
export interface Stream {
  id: string
  workspaceId: string
  streamType: StreamType
  name: string | null
  slug: string | null
  description: string | null
  topic: string | null
  parentStreamId: string | null
  branchedFromEventId: string | null
  visibility: StreamVisibility
  status: StreamStatus
  promotedAt: Date | null
  promotedBy: string | null
  personaId: string | null
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}

/**
 * User-specific membership context for a stream.
 * This data comes from the stream_members table.
 */
export interface StreamMembershipContext {
  isMember: boolean
  lastReadAt: Date | null
  notifyLevel: NotifyLevel
  pinnedAt: Date | null
}

/**
 * Stream with user-specific membership context.
 * Used when fetching streams for a specific user (bootstrap, discoverable).
 */
export interface StreamWithMembership extends Stream, StreamMembershipContext {
  memberCount?: number
}

/**
 * Stream with unread count (computed separately due to expense).
 * This is the final shape returned to the frontend.
 */
export interface StreamWithUnreadCount extends StreamWithMembership {
  unreadCount: number
}
