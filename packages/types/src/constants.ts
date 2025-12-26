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
export const COMPANION_MODES = ["off", "on"] as const
export type CompanionMode = (typeof COMPANION_MODES)[number]

export const CompanionModes = {
  OFF: "off",
  ON: "on",
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
  "command_dispatched",
  "command_completed",
  "command_failed",
] as const
export type EventType = (typeof EVENT_TYPES)[number]

// Command event types (subset of EVENT_TYPES for command lifecycle)
export const COMMAND_EVENT_TYPES = ["command_dispatched", "command_completed", "command_failed"] as const
export type CommandEventType = (typeof COMMAND_EVENT_TYPES)[number]

// Workspace member roles
export const WORKSPACE_MEMBER_ROLES = ["owner", "admin", "member"] as const
export type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLES)[number]

// Persona managed by
export const PERSONA_MANAGED_BY = ["system", "workspace"] as const
export type PersonaManagedBy = (typeof PERSONA_MANAGED_BY)[number]

// Persona status
export const PERSONA_STATUSES = ["pending", "active", "disabled", "archived"] as const
export type PersonaStatus = (typeof PERSONA_STATUSES)[number]

// Attachment storage providers
export const STORAGE_PROVIDERS = ["s3"] as const
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number]

// Attachment processing status
export const PROCESSING_STATUSES = ["pending", "processing", "completed", "failed"] as const
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number]

// Conversation status
export const CONVERSATION_STATUSES = ["active", "stalled", "resolved"] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

export const ConversationStatuses = {
  ACTIVE: "active",
  STALLED: "stalled",
  RESOLVED: "resolved",
} as const satisfies Record<string, ConversationStatus>

// Memo types (GAM)
export const MEMO_TYPES = ["message", "conversation"] as const
export type MemoType = (typeof MEMO_TYPES)[number]

export const MemoTypes = {
  MESSAGE: "message",
  CONVERSATION: "conversation",
} as const satisfies Record<string, MemoType>

// Knowledge types (classification categories)
export const KNOWLEDGE_TYPES = ["decision", "learning", "procedure", "context", "reference"] as const
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number]

export const KnowledgeTypes = {
  DECISION: "decision",
  LEARNING: "learning",
  PROCEDURE: "procedure",
  CONTEXT: "context",
  REFERENCE: "reference",
} as const satisfies Record<string, KnowledgeType>

// Memo statuses (lifecycle)
export const MEMO_STATUSES = ["draft", "active", "archived", "superseded"] as const
export type MemoStatus = (typeof MEMO_STATUSES)[number]

export const MemoStatuses = {
  DRAFT: "draft",
  ACTIVE: "active",
  ARCHIVED: "archived",
  SUPERSEDED: "superseded",
} as const satisfies Record<string, MemoStatus>

// Pending memo item types
export const PENDING_ITEM_TYPES = ["message", "conversation"] as const
export type PendingItemType = (typeof PENDING_ITEM_TYPES)[number]
