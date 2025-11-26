// ============================================================================
// Shared Frontend Types
// ============================================================================

export type OpenMode = "replace" | "side" | "newTab"

// Message types
export type MessageType = "message" | "system"

export interface SystemMessageMetadata {
  event: "member_joined" | "member_added" | "member_removed"
  userId: string
  userName?: string
  userEmail?: string
  addedByUserId?: string
  addedByName?: string
  addedByEmail?: string
}

export interface MessageMention {
  type: "user" | "channel" | "crosspost"
  id: string
  label: string
  slug?: string
}

export interface LinkedChannel {
  id: string
  slug: string
  name: string
  isPrimary: boolean
}

export interface Message {
  id: string
  userId?: string
  email: string
  message: string
  timestamp: string
  channelId: string
  replyCount?: number
  conversationId?: string | null
  replyToMessageId?: string | null
  isEdited?: boolean
  updatedAt?: string
  messageType?: MessageType
  metadata?: SystemMessageMetadata
  mentions?: MessageMention[]
  linkedChannels?: LinkedChannel[]
}

export interface ThreadData {
  rootMessageId: string
  conversationId: string | null
  messages: Message[]
  ancestors: Message[]
}

// Channel types
export interface Channel {
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

// Workspace types
export interface Workspace {
  id: string
  name: string
  slug: string
  plan_tier: string
}

// Bootstrap data
export interface BootstrapData {
  workspace: Workspace
  user_role: string
  channels: Channel[]
  conversations: any[]
  users: any[]
}

// Pane/Tab types for layout
export interface Tab {
  id: string
  title: string
  type: "channel" | "thread"
  data?: {
    channelSlug?: string
    threadId?: string
  }
}

export interface Pane {
  id: string
  tabs: Tab[]
  activeTabId: string
}

// Helper to determine open mode from mouse event
export function getOpenMode(e: React.MouseEvent): OpenMode {
  // Cmd/Ctrl + Click = new browser tab
  if (e.metaKey || e.ctrlKey) return "newTab"
  // Alt/Option + Click = open to side
  if (e.altKey) return "side"
  // Regular click = replace current
  return "replace"
}
