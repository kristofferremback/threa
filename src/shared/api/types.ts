/**
 * Shared API Types
 *
 * These types are used by both the API clients and the frontend,
 * ensuring consistency across the application.
 */

import type { Stream, StreamEvent, Mention, BootstrapData, Notification } from "../../frontend/types"

// Re-export core types
export type { Stream, StreamEvent, Mention, BootstrapData, Notification }

// ==========================================================================
// API Request Types
// ==========================================================================

export interface PostMessageInput {
  content: string
  mentions?: Mention[]
  // For creating threads
  parentEventId?: string
  parentStreamId?: string
  // Client-generated ID for idempotency (prevents duplicate messages on retry)
  clientMessageId?: string
}

export interface EditMessageInput {
  content: string
  mentions?: Mention[]
}

export interface CreateStreamInput {
  name: string
  description?: string
  visibility?: "public" | "private"
  streamType?: "channel" | "thinking_space"
}

export interface UpdateStreamInput {
  name?: string
  description?: string
  topic?: string
}

// ==========================================================================
// API Response Types
// ==========================================================================

export interface EventsResponse {
  events: StreamEvent[]
  nextCursor?: string
  hasMore: boolean
  lastReadEventId?: string
}

export interface PostMessageResponse {
  event: StreamEvent
  // When posting to a pending thread, the server creates the actual stream
  stream?: Stream
}

export interface StreamResponse {
  stream: Stream
  parentStream?: Stream
  rootEvent?: StreamEvent
  ancestors?: StreamEvent[]
}

export interface NotificationsResponse {
  notifications: Notification[]
  unreadCount: number
}

// ==========================================================================
// Agent Session Types (for thinking events)
// ==========================================================================

export interface AgentSessionStep {
  id: string
  type: "gathering_context" | "reasoning" | "tool_call" | "synthesizing"
  content: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  startedAt: string
  completedAt?: string
  status: "active" | "completed" | "failed"
}

export interface AgentSession {
  id: string
  streamId: string
  triggeringEventId: string
  responseEventId?: string
  status: "active" | "summarizing" | "completed" | "failed"
  steps: AgentSessionStep[]
  summary?: string
  errorMessage?: string
  startedAt: string
  completedAt?: string
}
