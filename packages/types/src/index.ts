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
  ProcessingStatuses,
  EXTRACTION_CONTENT_TYPES,
  type ExtractionContentType,
  ExtractionContentTypes,
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
  // Source types
  SOURCE_TYPES,
  type SourceType,
  SourceTypes,
  // Agent triggers
  AGENT_TRIGGERS,
  type AgentTrigger,
  AgentTriggers,
  // Agent session events
  AGENT_SESSION_EVENT_TYPES,
  type AgentSessionEventType,
  // Agent step types
  AGENT_STEP_TYPES,
  type AgentStepType,
  AgentStepTypes,
  // Agent session statuses
  AGENT_SESSION_STATUSES,
  type AgentSessionStatus,
  AgentSessionStatuses,
  // PDF processing
  PDF_PAGE_CLASSIFICATIONS,
  type PdfPageClassification,
  PdfPageClassifications,
  PDF_JOB_STATUSES,
  type PdfJobStatus,
  PdfJobStatuses,
  PDF_SIZE_TIERS,
  type PdfSizeTier,
  PdfSizeTiers,
  EXTRACTION_SOURCE_TYPES,
  type ExtractionSourceType,
  ExtractionSourceTypes,
} from "./constants"

// Domain entities (wire format)
export type {
  User,
  Workspace,
  WorkspaceMember,
  Stream,
  LastMessagePreview,
  StreamWithPreview,
  StreamMember,
  Message,
  StreamEvent,
  Persona,
  Attachment,
  AttachmentSummary,
  SourceItem,
  Conversation,
  ConversationWithStaleness,
  Memo,
  PendingMemoItem,
  MemoStreamState,
  ChartData,
  TableData,
  DiagramData,
  AttachmentExtraction,
  PdfSection,
  PdfMetadata,
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
  CreateMessageInputJson,
  CreateMessageInputMarkdown,
  UpdateMessageInput,
  UpdateMessageInputJson,
  UpdateMessageInputMarkdown,
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
  // AI Usage
  AIUsageSummary,
  AIUsageOrigin,
  AIUsageByOrigin,
  AIUsageByUser,
  AIUsageRecord,
  AIUsageResponse,
  AIRecentUsageResponse,
  AIBudgetConfig,
  AIBudgetResponse,
  UpdateAIBudgetInput,
} from "./api"

// ProseMirror / TipTap JSON types
export type {
  // Loose input type (compatible with TipTap)
  JSONContent,
  JSONContentMark,
  // Strict document types
  ThreaDocument,
  ThreaBlockNode,
  ThreaParagraph,
  ThreaHeading,
  ThreaCodeBlock,
  ThreaBlockquote,
  ThreaBulletList,
  ThreaOrderedList,
  ThreaListItem,
  ThreaHorizontalRule,
  ThreaInlineNode,
  ThreaTextNode,
  ThreaMention,
  ThreaChannelLink,
  ThreaCommand,
  ThreaEmoji,
  ThreaAttachmentReference,
  ThreaHardBreak,
  ThreaMark,
  ThreaBoldMark,
  ThreaItalicMark,
  ThreaStrikeMark,
  ThreaCodeMark,
  ThreaLinkMark,
  ThreaNodeType,
  ThreaMarkType,
} from "./prosemirror"
export {
  // Validation schema
  threaDocumentSchema,
  // Error class
  ContentValidationError,
  // Type guards and validators
  isThreaDocument,
  validateContent,
  tryValidateContent,
} from "./prosemirror"

// User Preferences
export {
  // Theme
  THEME_OPTIONS,
  type Theme,
  Themes,
  // Message display
  MESSAGE_DISPLAY_OPTIONS,
  type MessageDisplay,
  MessageDisplays,
  // Date format
  DATE_FORMAT_OPTIONS,
  type DateFormat,
  DateFormats,
  // Time format
  TIME_FORMAT_OPTIONS,
  type TimeFormat,
  TimeFormats,
  // Notification level
  NOTIFICATION_LEVEL_OPTIONS,
  type NotificationLevel,
  NotificationLevels,
  // Font size
  FONT_SIZE_OPTIONS,
  type FontSize,
  FontSizes,
  // Font family
  FONT_FAMILY_OPTIONS,
  type FontFamily,
  FontFamilies,
  // Message send mode
  MESSAGE_SEND_MODE_OPTIONS,
  type MessageSendMode,
  MessageSendModes,
  // Settings tabs
  SETTINGS_TAB_OPTIONS,
  SETTINGS_TABS,
  type SettingsTab,
  // Domain types
  type AccessibilityPreferences,
  DEFAULT_ACCESSIBILITY,
  type KeyboardShortcuts,
  type UserPreferences,
  DEFAULT_USER_PREFERENCES,
  // API types
  type UpdateUserPreferencesInput,
} from "./preferences"

// Agent trace types
export {
  TRACE_SOURCE_TYPES,
  type TraceSourceType,
  type TraceSource,
  type AgentSessionStep,
  type AgentSession,
  type AgentSessionWithSteps,
  type AgentActivityUpdate,
  type AgentSessionStartedPayload,
  type AgentSessionCompletedPayload,
  type AgentSessionFailedPayload,
  type AgentSessionProgressPayload,
  type StepStartedPayload,
  type StepProgressPayload,
  type StepCompletedPayload,
  type SessionTerminalPayload,
  type AgentActivityStartedPayload,
  type AgentActivityEndedPayload,
} from "./agent-trace"
