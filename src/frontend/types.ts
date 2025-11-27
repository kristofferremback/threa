// ============================================================================
// Shared Frontend Types - Stream Model
// ============================================================================

export type OpenMode = "replace" | "side" | "newTab"

// ==========================================================================
// Stream Types
// ==========================================================================

export type StreamType = "channel" | "thread" | "dm" | "incident"
export type StreamVisibility = "public" | "private" | "inherit"
export type StreamStatus = "active" | "archived" | "resolved"
export type NotifyLevel = "all" | "mentions" | "muted" | "default"
export type MemberRole = "owner" | "admin" | "member"

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
  // Computed/joined fields
  isMember: boolean
  unreadCount: number
  lastReadAt: string | null
  notifyLevel: NotifyLevel
  pinnedAt: string | null
}

export interface StreamMember {
  streamId: string
  userId: string
  email: string
  name: string
  role: MemberRole
  notifyLevel: NotifyLevel
  lastReadEventId: string | null
  lastReadAt: string
  joinedAt: string
}

// ==========================================================================
// Event Types
// ==========================================================================

export type EventType = "message" | "shared" | "member_joined" | "member_left" | "thread_started" | "stream_created" | "poll" | "file"

export interface Mention {
  type: "user" | "channel" | "crosspost"
  id: string
  label: string
  slug?: string
}

export interface StreamEvent {
  id: string
  streamId: string
  eventType: EventType
  actorId: string
  actorEmail: string
  actorName?: string
  // For message events
  content?: string
  mentions?: Mention[]
  // For shared events
  originalEventId?: string
  shareContext?: string
  originalEvent?: StreamEvent
  // For system events (member_joined, thread_started, etc.)
  payload?: Record<string, unknown>
  // Computed
  replyCount?: number
  isEdited?: boolean
  createdAt: string
  editedAt?: string
}

// For backwards compatibility during migration
export interface Message {
  id: string
  userId?: string
  email: string
  name?: string
  message: string
  timestamp: string
  channelId: string
  replyCount?: number
  conversationId?: string | null
  replyToMessageId?: string | null
  isEdited?: boolean
  updatedAt?: string
  messageType?: "message" | "system"
  metadata?: SystemMessageMetadata
  mentions?: Mention[]
  linkedChannels?: LinkedChannel[]
}

export interface SystemMessageMetadata {
  event: "member_joined" | "member_added" | "member_removed" | "member_left" | "stream_created" | "thread_started"
  userId: string
  userName?: string
  userEmail?: string
  name?: string // For stream_created
  description?: string // For stream_created
  addedByUserId?: string
  addedByName?: string
  addedByEmail?: string
}

export interface LinkedChannel {
  id: string
  slug: string
  name: string
  isPrimary: boolean
}

// ==========================================================================
// Workspace Types
// ==========================================================================

export interface Workspace {
  id: string
  name: string
  slug: string
  planTier: string
  // Legacy alias for backwards compatibility
  plan_tier?: string
}

export interface WorkspaceUser {
  id: string
  name: string
  email: string
  role: "admin" | "member" | "guest"
}

// ==========================================================================
// Bootstrap Data
// ==========================================================================

export interface BootstrapData {
  workspace: Workspace
  userRole: "admin" | "member" | "guest"
  streams: Stream[]
  users: WorkspaceUser[]
}

// Legacy bootstrap format (for migration)
export interface LegacyBootstrapData {
  workspace: {
    id: string
    name: string
    slug: string
    plan_tier: string
  }
  user_role: string
  channels: LegacyChannel[]
  conversations: any[]
  users: any[]
}

export interface LegacyChannel {
  id: string
  name: string
  slug: string
  description: string | null
  topic: string | null
  visibility: "public" | "private" | "direct"
  is_member: boolean
  unread_count: number
  last_read_at: string | null
  notify_level: string
}

// ==========================================================================
// Pane/Tab Types
// ==========================================================================

export interface Tab {
  id: string
  title: string
  type: "stream" | "activity"
  data?: {
    streamId?: string
    streamSlug?: string
    highlightEventId?: string
    // Legacy fields for backwards compatibility
    channelSlug?: string
    threadId?: string
    highlightMessageId?: string
  }
}

// Type alias for backwards compatibility
export type MessageMention = Mention

// Legacy Channel type - maps to Stream for migration
export type Channel = Stream

export interface Pane {
  id: string
  tabs: Tab[]
  activeTabId: string
}

// ==========================================================================
// Thread Data
// ==========================================================================

export interface ThreadData {
  stream: Stream
  parentStream: Stream | null
  rootEvent: StreamEvent | null
  events: StreamEvent[]
  ancestors: StreamEvent[]
}

// ==========================================================================
// Notifications
// ==========================================================================

export interface Notification {
  id: string
  type: "mention" | "reply" | "channel_join" | "crosspost"
  streamId: string
  streamName?: string
  streamSlug?: string
  eventId?: string
  actorId: string
  actorName?: string
  actorEmail?: string
  preview?: string
  readAt: string | null
  createdAt: string
}

// ==========================================================================
// Helpers
// ==========================================================================

export function getOpenMode(e: React.MouseEvent): OpenMode {
  // Cmd/Ctrl + Click = new browser tab
  if (e.metaKey || e.ctrlKey) return "newTab"
  // Alt/Option + Click = open to side
  if (e.altKey) return "side"
  // Regular click = replace current
  return "replace"
}

// Get display name (prefer name, fallback to email prefix)
// If name looks like an email, use the prefix instead
export function getDisplayName(name?: string | null, email?: string): string {
  // If name exists and doesn't look like an email, use it
  if (name && !name.includes("@")) return name
  // Otherwise extract from email
  if (email) return email.split("@")[0]
  if (name) return name.split("@")[0]
  return "Unknown"
}

// Convert StreamEvent to legacy Message format (for gradual migration)
export function eventToMessage(event: StreamEvent, streamId: string): Message {
  return {
    id: event.id,
    userId: event.actorId,
    email: event.actorEmail,
    name: event.actorName,
    message: event.content || "",
    timestamp: event.createdAt,
    channelId: streamId,
    replyCount: event.replyCount,
    isEdited: event.isEdited,
    updatedAt: event.editedAt,
    messageType: event.eventType === "message" ? "message" : "system",
    mentions: event.mentions,
  }
}

// Convert Stream to legacy Channel format (for gradual migration)
export function streamToChannel(stream: Stream): LegacyChannel {
  return {
    id: stream.id,
    name: stream.name || "",
    slug: stream.slug || "",
    description: stream.description,
    topic: stream.topic,
    visibility: stream.visibility === "private" ? "private" : "public",
    is_member: stream.isMember,
    unread_count: stream.unreadCount,
    last_read_at: stream.lastReadAt,
    notify_level: stream.notifyLevel,
  }
}

// Check if a stream is a thread
export function isThread(stream: Stream): boolean {
  return stream.streamType === "thread"
}

// Check if a stream is a channel (root-level)
export function isChannel(stream: Stream): boolean {
  return stream.streamType === "channel"
}

// Check if a stream is promotable (thread that can become channel/incident)
export function isPromotable(stream: Stream): boolean {
  return stream.streamType === "thread"
}

// Get display name for a stream
export function getStreamDisplayName(stream: Stream): string {
  if (stream.name) return stream.name
  if (stream.streamType === "thread") return "Thread"
  if (stream.streamType === "dm") return "Direct Message"
  return "Unnamed"
}
