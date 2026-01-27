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
  "stream_archived",
  "stream_unarchived",
  "companion_response",
  "command_dispatched",
  "command_completed",
  "command_failed",
  "agent_session:started",
  "agent_session:completed",
  "agent_session:failed",
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

// Agent tool names
export const AGENT_TOOL_NAMES = [
  "send_message",
  "web_search",
  "read_url",
  "search_messages",
  "search_streams",
  "search_users",
  "get_stream_messages",
] as const
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number]

export const AgentToolNames = {
  SEND_MESSAGE: "send_message",
  WEB_SEARCH: "web_search",
  READ_URL: "read_url",
  SEARCH_MESSAGES: "search_messages",
  SEARCH_STREAMS: "search_streams",
  SEARCH_USERS: "search_users",
  GET_STREAM_MESSAGES: "get_stream_messages",
} as const satisfies Record<string, AgentToolName>

// Source types for message citations
export const SOURCE_TYPES = ["web", "workspace"] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const SourceTypes = {
  WEB: "web",
  WORKSPACE: "workspace",
} as const satisfies Record<string, SourceType>

// Agent invocation triggers
export const AGENT_TRIGGERS = ["mention", "companion"] as const
export type AgentTrigger = (typeof AGENT_TRIGGERS)[number]

export const AgentTriggers = {
  MENTION: "mention",
  COMPANION: "companion",
} as const satisfies Record<string, AgentTrigger>

// Agent session event types (stream events for session lifecycle)
export const AGENT_SESSION_EVENT_TYPES = [
  "agent_session:started",
  "agent_session:completed",
  "agent_session:failed",
] as const
export type AgentSessionEventType = (typeof AGENT_SESSION_EVENT_TYPES)[number]

// Agent step types (semantic - frontend maps to display labels)
export const AGENT_STEP_TYPES = [
  "thinking",
  "reconsidering",
  "web_search",
  "visit_page",
  "workspace_search",
  "message_sent",
  "tool_call",
  "tool_error",
] as const
export type AgentStepType = (typeof AGENT_STEP_TYPES)[number]

export const AgentStepTypes = {
  THINKING: "thinking",
  RECONSIDERING: "reconsidering",
  WEB_SEARCH: "web_search",
  VISIT_PAGE: "visit_page",
  WORKSPACE_SEARCH: "workspace_search",
  MESSAGE_SENT: "message_sent",
  TOOL_CALL: "tool_call",
  TOOL_ERROR: "tool_error",
} as const satisfies Record<string, AgentStepType>

// Agent session statuses
export const AGENT_SESSION_STATUSES = ["pending", "running", "completed", "failed"] as const
export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number]

export const AgentSessionStatuses = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const satisfies Record<string, AgentSessionStatus>
