// Domain types that mirror the backend exactly
// Keep in sync with apps/backend/src/repositories/*
// and apps/backend/src/lib/constants.ts

// Enum-like constants
export const STREAM_TYPES = ["scratchpad", "channel", "dm", "thread"] as const
export type StreamType = (typeof STREAM_TYPES)[number]

export const StreamTypes = {
  SCRATCHPAD: "scratchpad",
  CHANNEL: "channel",
  DM: "dm",
  THREAD: "thread",
} as const satisfies Record<string, StreamType>

export const VISIBILITY_OPTIONS = ["public", "private"] as const
export type Visibility = (typeof VISIBILITY_OPTIONS)[number]

export const Visibilities = {
  PUBLIC: "public",
  PRIVATE: "private",
} as const satisfies Record<string, Visibility>

export const COMPANION_MODES = ["off", "on", "next_message_only"] as const
export type CompanionMode = (typeof COMPANION_MODES)[number]

export const CompanionModes = {
  OFF: "off",
  ON: "on",
  NEXT_MESSAGE_ONLY: "next_message_only",
} as const satisfies Record<string, CompanionMode>

export const CONTENT_FORMATS = ["plaintext", "markdown"] as const
export type ContentFormat = (typeof CONTENT_FORMATS)[number]

export const AUTHOR_TYPES = ["user", "persona"] as const
export type AuthorType = (typeof AUTHOR_TYPES)[number]

export const AuthorTypes = {
  USER: "user",
  PERSONA: "persona",
} as const satisfies Record<string, AuthorType>

// Domain entities
export interface User {
  id: string
  email: string
  name: string
}

export interface Workspace {
  id: string
  name: string
  slug: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceMember {
  workspaceId: string
  userId: string
  role: "owner" | "admin" | "member"
  joinedAt: string
}

export interface Stream {
  id: string
  workspaceId: string
  type: StreamType
  displayName: string | null
  slug: string | null
  description: string | null
  visibility: Visibility
  parentStreamId: string | null
  parentMessageId: string | null
  rootStreamId: string | null
  companionMode: CompanionMode
  companionPersonaId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface StreamMember {
  streamId: string
  userId: string
  pinned: boolean
  muted: boolean
  lastReadEventId: string | null
  lastReadAt: string | null
  joinedAt: string
}

export interface Message {
  id: string
  streamId: string
  sequence: string // bigint serialized as string
  authorId: string
  authorType: AuthorType
  content: string
  contentFormat: ContentFormat
  replyCount: number
  reactions: Record<string, string[]>
  editedAt: string | null
  deletedAt: string | null
  createdAt: string
}

// Event types from stream_events
export const EVENT_TYPES = [
  "message_created",
  "message_edited",
  "message_deleted",
  "reaction_added",
  "reaction_removed",
  "member_joined",
  "member_left",
  "thread_created",
  "companion_response",
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export interface StreamEvent {
  id: string
  streamId: string
  sequence: string // bigint as string
  eventType: EventType
  payload: unknown
  actorId: string | null
  actorType: AuthorType | null
  createdAt: string
}

// Persona (AI agents)
export interface Persona {
  id: string
  workspaceId: string | null
  slug: string
  name: string
  description: string | null
  managedBy: "system" | "workspace"
  status: "pending" | "active" | "disabled" | "archived"
  avatarEmoji: string | null
}
