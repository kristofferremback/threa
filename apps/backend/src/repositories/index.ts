// Backwards-compatibility shims — legacy consumers import from repositories/
export { MemberRepository } from "../features/workspaces"
export type { Member, InsertMemberParams } from "../features/workspaces"

export { WorkspaceRepository } from "../features/workspaces"
export type { Workspace, WorkspaceMember, InsertWorkspaceParams } from "../features/workspaces"

// Backwards-compatibility shims — canonical source: features/streams/
export { StreamRepository } from "../features/streams"
export type { Stream, InsertStreamParams, UpdateStreamParams } from "../features/streams"

export { StreamMemberRepository } from "../features/streams"
export type { StreamMember, UpdateStreamMemberParams } from "../features/streams"

// Backwards-compatibility shims — canonical source: features/agents/
export { StreamPersonaParticipantRepository } from "../features/agents"
export type { StreamPersonaParticipant } from "../features/agents"

export { PersonaRepository } from "../features/agents"
export type { Persona } from "../features/agents"

export { AgentSessionRepository, SessionStatuses } from "../features/agents"
export type {
  AgentSession,
  AgentSessionStep,
  SessionStatus,
  StepType,
  InsertSessionParams,
  UpsertStepParams,
} from "../features/agents"

export { StreamEventRepository } from "../features/streams"
export type { StreamEvent, InsertEventParams } from "../features/streams"

// Backwards-compatibility shims — canonical source: features/messaging/
export { MessageRepository } from "../features/messaging"
export type { Message, InsertMessageParams } from "../features/messaging"

// Backwards-compatibility shims — canonical source: features/attachments/
export { AttachmentRepository } from "../features/attachments"
export type { Attachment, InsertAttachmentParams, AttachmentWithExtraction } from "../features/attachments"

export { AttachmentExtractionRepository } from "../features/attachments"
export type {
  AttachmentExtraction,
  InsertAttachmentExtractionParams,
  PdfMetadata,
  PdfSection,
} from "../features/attachments"

export { PdfPageExtractionRepository } from "../features/attachments"
export type {
  PdfPageExtraction,
  EmbeddedImage,
  InsertPdfPageExtractionParams,
  UpdatePdfPageExtractionParams,
} from "../features/attachments"

export { PdfProcessingJobRepository } from "../features/attachments"
export type { PdfProcessingJob, InsertPdfProcessingJobParams } from "../features/attachments"

export { OutboxRepository, OUTBOX_CHANNEL, isOutboxEventType } from "../lib/outbox"
export type {
  OutboxEvent,
  OutboxEventType,
  OutboxEventPayload,
  OutboxEventPayloadMap,
  MessageCreatedOutboxPayload,
  MessageEditedOutboxPayload,
  MessageDeletedOutboxPayload,
  ReactionOutboxPayload,
  StreamDisplayNameUpdatedPayload,
  AttachmentUploadedOutboxPayload,
} from "../lib/outbox"

// Backwards-compatibility shims — canonical source: features/conversations/
export { ConversationRepository } from "../features/conversations"
export type { Conversation, InsertConversationParams, UpdateConversationParams } from "../features/conversations"

// Backwards-compatibility shims — canonical source: features/memos/
export { MemoRepository } from "../features/memos"
export type { Memo, InsertMemoParams, UpdateMemoParams, MemoSearchResult } from "../features/memos"

export { PendingItemRepository } from "../features/memos"
export type { PendingMemoItem, QueuePendingItemParams } from "../features/memos"

// Backwards-compatibility shim — canonical source: features/streams/
export { StreamStateRepository } from "../features/streams"
export type { MemoStreamState, StreamReadyToProcess } from "../features/streams"

// Backwards-compatibility shims — canonical source: features/emoji/
export { EmojiUsageRepository } from "../features/emoji"
export type { EmojiUsage, InsertEmojiUsageParams } from "../features/emoji"

// Backwards-compatibility shims — canonical source: features/ai-usage/
export { AIUsageRepository } from "../features/ai-usage"
export type {
  AIUsageRecord,
  AIUsageOrigin,
  InsertAIUsageRecordParams,
  UsageSummary,
  ModelBreakdown,
  FunctionBreakdown,
  MemberBreakdown,
  OriginBreakdown,
} from "../features/ai-usage"

export { AIBudgetRepository } from "../features/ai-usage"
export type {
  AIBudget,
  AIUserQuota,
  AIAlert,
  UpsertAIBudgetParams,
  UpdateAIBudgetParams,
  UpsertAIUserQuotaParams,
  InsertAIAlertParams,
} from "../features/ai-usage"
