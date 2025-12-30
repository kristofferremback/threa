// Constants and their types
export {
  // Stream types
  STREAM_TYPES,
  type StreamType,
  StreamTypes,
  // Visibility
  VISIBILITY_OPTIONS,
  type Visibility,
  Visibilities,
  // Companion modes
  COMPANION_MODES,
  type CompanionMode,
  CompanionModes,
  // Content formats
  CONTENT_FORMATS,
  type ContentFormat,
  // Author types
  AUTHOR_TYPES,
  type AuthorType,
  AuthorTypes,
  // Event types
  EVENT_TYPES,
  type EventType,
  COMMAND_EVENT_TYPES,
  type CommandEventType,
  // Workspace roles
  WORKSPACE_MEMBER_ROLES,
  type WorkspaceMemberRole,
  // Persona
  PERSONA_MANAGED_BY,
  type PersonaManagedBy,
  PERSONA_STATUSES,
  type PersonaStatus,
  // Attachments
  STORAGE_PROVIDERS,
  type StorageProvider,
  PROCESSING_STATUSES,
  type ProcessingStatus,
  // Conversations
  CONVERSATION_STATUSES,
  type ConversationStatus,
  ConversationStatuses,
  // Memos (GAM)
  MEMO_TYPES,
  type MemoType,
  MemoTypes,
  KNOWLEDGE_TYPES,
  type KnowledgeType,
  KnowledgeTypes,
  MEMO_STATUSES,
  type MemoStatus,
  MemoStatuses,
  PENDING_ITEM_TYPES,
  type PendingItemType,
  // Agent tools
  AGENT_TOOL_NAMES,
  type AgentToolName,
  AgentToolNames,
} from "./constants"

// Domain entities (wire format)
export type {
  User,
  Workspace,
  WorkspaceMember,
  Stream,
  StreamMember,
  Message,
  StreamEvent,
  Persona,
  Attachment,
  AttachmentSummary,
  Conversation,
  ConversationWithStaleness,
  Memo,
  PendingMemoItem,
  MemoStreamState,
} from "./domain"

// Slug validation
export {
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  MENTION_PATTERN,
  INVALID_SLUG_CHARS,
  isValidSlug,
  extractMentionSlugs,
  hasMention,
} from "./slug"

// API types
export type {
  // Streams
  CreateStreamInput,
  UpdateStreamInput,
  UpdateCompanionModeInput,
  StreamBootstrap,
  // Messages
  CreateMessageInput,
  UpdateMessageInput,
  // Workspaces
  CreateWorkspaceInput,
  WorkspaceBootstrap,
  // Emojis
  EmojiEntry,
  // Commands
  CommandInfo,
  DispatchCommandInput,
  DispatchCommandResponse,
  DispatchCommandError,
  CommandDispatchedPayload,
  CommandCompletedPayload,
  CommandFailedPayload,
} from "./api"
