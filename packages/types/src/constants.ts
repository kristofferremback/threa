// Stream types
export const STREAM_TYPES = ["scratchpad", "channel", "dm", "thread"] as const
export type StreamType = (typeof STREAM_TYPES)[number]

export const StreamTypes = {
  SCRATCHPAD: "scratchpad",
  CHANNEL: "channel",
  DM: "dm",
  THREAD: "thread",
} as const satisfies Record<string, StreamType>

// Visibility
export const VISIBILITY_OPTIONS = ["public", "private"] as const
export type Visibility = (typeof VISIBILITY_OPTIONS)[number]

export const Visibilities = {
  PUBLIC: "public",
  PRIVATE: "private",
} as const satisfies Record<string, Visibility>

// Companion modes
export const COMPANION_MODES = ["off", "on", "next_message_only"] as const
export type CompanionMode = (typeof COMPANION_MODES)[number]

export const CompanionModes = {
  OFF: "off",
  ON: "on",
  NEXT_MESSAGE_ONLY: "next_message_only",
} as const satisfies Record<string, CompanionMode>

// Content formats
export const CONTENT_FORMATS = ["plaintext", "markdown"] as const
export type ContentFormat = (typeof CONTENT_FORMATS)[number]

// Author types
export const AUTHOR_TYPES = ["user", "persona"] as const
export type AuthorType = (typeof AUTHOR_TYPES)[number]

export const AuthorTypes = {
  USER: "user",
  PERSONA: "persona",
} as const satisfies Record<string, AuthorType>

// Event types
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

// Workspace member roles
export const WORKSPACE_MEMBER_ROLES = ["owner", "admin", "member"] as const
export type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLES)[number]

// Persona managed by
export const PERSONA_MANAGED_BY = ["system", "workspace"] as const
export type PersonaManagedBy = (typeof PERSONA_MANAGED_BY)[number]

// Persona status
export const PERSONA_STATUSES = ["pending", "active", "disabled", "archived"] as const
export type PersonaStatus = (typeof PERSONA_STATUSES)[number]
