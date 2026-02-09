// Re-export shims — these repos moved to features/workspaces/
export { MemberRepository } from "../features/workspaces"
export type { Member, InsertMemberParams } from "../features/workspaces"

export { WorkspaceRepository } from "../features/workspaces"
export type { Workspace, WorkspaceMember, InsertWorkspaceParams } from "../features/workspaces"

// Re-export shims — these repos moved to features/streams/ (INV-51)
export { StreamRepository } from "../features/streams"
export type { Stream, InsertStreamParams, UpdateStreamParams } from "../features/streams"

export { StreamMemberRepository } from "../features/streams"
export type { StreamMember, UpdateStreamMemberParams } from "../features/streams"

// Re-export shims — these repos moved to features/agents/
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

// Re-export shims — these repos moved to features/messaging/
export { MessageRepository } from "../features/messaging"
export type { Message, InsertMessageParams } from "../features/messaging"

// Re-export shims — these repos moved to features/attachments/
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

export { OutboxRepository, OUTBOX_CHANNEL, isOutboxEventType } from "./outbox-repository"
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
} from "./outbox-repository"

// Re-export shims — these repos moved to features/conversations/
export { ConversationRepository } from "../features/conversations"
export type { Conversation, InsertConversationParams, UpdateConversationParams } from "../features/conversations"

// Re-export shims — these repos moved to features/memos/
export { MemoRepository } from "../features/memos"
export type { Memo, InsertMemoParams, UpdateMemoParams, MemoSearchResult } from "../features/memos"

export { PendingItemRepository } from "../features/memos"
export type { PendingMemoItem, QueuePendingItemParams } from "../features/memos"

// Re-export shim — moved to features/streams/ (INV-51)
export { StreamStateRepository } from "../features/streams"
export type { MemoStreamState, StreamReadyToProcess } from "../features/streams"

// Re-export shims — these repos moved to features/emoji/
export { EmojiUsageRepository } from "../features/emoji"
export type { EmojiUsage, InsertEmojiUsageParams } from "../features/emoji"

// Re-export shims — these repos moved to features/ai-usage/
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
