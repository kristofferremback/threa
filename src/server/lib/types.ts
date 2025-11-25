export interface JWTPayload {
  userId: string
  email: string
  exp: number
}

export interface Session {
  accessToken: string
  refreshToken: string
  userId: string
  email: string
}

export interface WSData {
  userId: string
  email: string
}

// Database Types

export type NotificationLevel = "default" | "all" | "mentions" | "muted"

export interface User {
  id: string
  email: string
  name: string
  workos_user_id: string | null
  timezone: string | null
  locale: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
  archived_at: Date | null
}

export interface Workspace {
  id: string
  name: string
  slug: string
  workos_organization_id: string | null
  stripe_customer_id: string | null
  plan_tier: "free" | "pro" | "enterprise"
  billing_status: string
  seat_limit: number | null
  ai_budget_limit: number | null
  created_at: Date
}

export interface WorkspaceMember {
  workspace_id: string
  user_id: string
  role: "admin" | "member" | "guest"
  status: "active" | "invited" | "suspended"
  invited_at: Date | null
  joined_at: Date | null
  removed_at: Date | null
}

export interface Channel {
  id: string
  workspace_id: string
  name: string
  slug: string
  description: string | null
  topic: string | null
  visibility: "public" | "private" | "direct"
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

export interface ChannelMember {
  channel_id: string
  user_id: string
  added_by_user_id: string | null
  added_at: Date
  removed_at: Date | null
  updated_at: Date
  notify_level: NotificationLevel
  last_read_message_id: string | null
  last_read_at: Date
}

export interface Conversation {
  id: string
  workspace_id: string
  root_message_id: string
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

export interface ConversationMember {
  conversation_id: string
  user_id: string
  added_by_user_id: string | null
  added_at: Date
  removed_at: Date | null
  updated_at: Date
  notify_level: NotificationLevel
  last_read_message_id: string | null
  last_read_at: Date
}

export interface Message {
  id: string
  workspace_id: string
  channel_id: string
  author_id: string
  content: string
  conversation_id: string | null
  reply_to_message_id: string | null
  created_at: Date
  updated_at: Date | null
  deleted_at: Date | null
}
export interface MessagePreview {
  id: string
  content_preview: string
  conversation_id: string | null
  reply_to_message_id: string | null
  author_id: string
  created_at: Date
}

export interface OutboxEvent {
  id: string
  event_type: string
  payload: any
  created_at: Date
  processed_at: Date | null
  retry_count: number
  last_error: string | null
}
