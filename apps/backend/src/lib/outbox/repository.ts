import { OutboxRepository as BaseOutboxRepository, type Querier } from "@threa/backend-common"
import type { Stream } from "../../features/streams"
import type { StreamEvent } from "../../features/streams"
import type { User } from "../../features/workspaces"
import type { ConversationWithStaleness } from "../../features/conversations"
import type {
  Memo as WireMemo,
  UserPreferences,
  LastMessagePreview,
  Bot as WireBot,
  SavedMessageView,
} from "@threa/types"

/**
 * Outbox event types and their payloads.
 * Use the OutboxEventPayload type to get type-safe payload access.
 */
export type OutboxEventType =
  | "message:created"
  | "message:edited"
  | "message:deleted"
  | "message:updated"
  | "reaction:added"
  | "reaction:removed"
  | "stream:created"
  | "stream:updated"
  | "stream:archived"
  | "stream:unarchived"
  | "stream:display_name_updated"
  | "stream:read"
  | "stream:read_all"
  | "stream:activity"
  | "attachment:uploaded"
  | "workspace_user:added"
  | "workspace_user:removed"
  | "workspace_user:updated"
  | "conversation:created"
  | "conversation:updated"
  | "memo:created"
  | "memo:revised"
  | "command:dispatched"
  | "command:completed"
  | "command:failed"
  | "agent_session:started"
  | "agent_session:completed"
  | "agent_session:failed"
  | "agent_session:deleted"
  | "user_preferences:updated"
  | "budget:alert"
  | "stream:member_joined"
  | "stream:member_added"
  | "stream:member_removed"
  | "invitation:sent"
  | "invitation:accepted"
  | "invitation:revoked"
  | "activity:created"
  | "saved:upserted"
  | "saved:deleted"
  | "saved_reminder:fired"
  | "bot:created"
  | "bot:updated"
  | "link_preview:ready"
  | "link_preview:dismissed"
  | "attachment:transcoded"

/** Events that are scoped to a stream (have streamId) */
export type StreamScopedEventType =
  | "message:created"
  | "message:edited"
  | "message:deleted"
  | "message:updated"
  | "reaction:added"
  | "reaction:removed"
  | "stream:display_name_updated"
  | "stream:member_joined"
  | "stream:member_added"
  | "stream:member_removed"
  | "stream:activity"
  | "conversation:created"
  | "conversation:updated"
  | "agent_session:started"
  | "agent_session:completed"
  | "agent_session:failed"
  | "agent_session:deleted"
  | "link_preview:ready"
  | "command:dispatched"
  | "command:completed"
  | "command:failed"

/** Events that are scoped to a workspace (no streamId) */
export type WorkspaceScopedEventType =
  | "stream:created"
  | "stream:updated"
  | "stream:archived"
  | "stream:unarchived"
  | "attachment:uploaded"
  | "workspace_user:added"
  | "workspace_user:removed"
  | "workspace_user:updated"
  | "bot:created"
  | "bot:updated"
  | "attachment:transcoded"

/**
 * Base fields for stream-scoped events.
 */
interface StreamScopedPayload {
  workspaceId: string
  streamId: string
}

/**
 * Base fields for workspace-scoped events.
 */
interface WorkspaceScopedPayload {
  workspaceId: string
}

// Stream-scoped event payloads
export interface MessageCreatedOutboxPayload extends StreamScopedPayload {
  event: StreamEvent
}

export interface MessageEditedOutboxPayload extends StreamScopedPayload {
  event: StreamEvent
}

export interface MessageDeletedOutboxPayload extends StreamScopedPayload {
  messageId: string
  deletedAt: string
}

export interface MessageUpdatedOutboxPayload extends StreamScopedPayload {
  messageId: string
  updateType: "reply_count" | "content"
  replyCount?: number
  content?: string
  /**
   * When `updateType === "reply_count"`, carries the recomputed thread summary
   * (or `null` when the last remaining reply was deleted). Lets the frontend
   * refresh ThreadCard content alongside `replyCount` instead of waiting for
   * the next bootstrap.
   */
  threadSummary?: import("@threa/types").ThreadSummary | null
}

export interface ReactionOutboxPayload extends StreamScopedPayload {
  messageId: string
  emoji: string
  userId: string
}

export interface StreamDisplayNameUpdatedPayload extends StreamScopedPayload {
  displayName: string
  visibility: string
}

export interface StreamMemberJoinedOutboxPayload extends StreamScopedPayload {
  event: StreamEvent
}

export interface StreamMemberAddedOutboxPayload extends StreamScopedPayload {
  memberId: string
  stream: Stream
  event: StreamEvent
}

export interface StreamMemberRemovedOutboxPayload extends StreamScopedPayload {
  memberId: string
  event?: StreamEvent
}

// Workspace-scoped event payloads (no streamId)
// Note: StreamCreatedOutboxPayload includes streamId for routing:
// - For threads: streamId = parentStreamId (broadcast to parent stream room)
// - For non-threads: streamId = stream.id (broadcast to workspace room)
export interface StreamCreatedOutboxPayload extends WorkspaceScopedPayload {
  streamId: string
  stream: Stream
  dmUserIds?: [string, string]
}

export interface StreamUpdatedOutboxPayload extends WorkspaceScopedPayload {
  streamId: string
  stream: Stream
}

export interface StreamArchivedOutboxPayload extends WorkspaceScopedPayload {
  streamId: string
  stream: Stream
}

export interface StreamUnarchivedOutboxPayload extends WorkspaceScopedPayload {
  streamId: string
  stream: Stream
}

export interface AttachmentUploadedOutboxPayload extends WorkspaceScopedPayload {
  attachmentId: string
  filename: string
  mimeType: string
  sizeBytes: number
  storagePath: string
}

export interface AttachmentTranscodedOutboxPayload extends WorkspaceScopedPayload {
  attachmentId: string
  processingStatus: string
  streamId?: string
  messageId?: string
}

export interface WorkspaceUserAddedOutboxPayload extends WorkspaceScopedPayload {
  user: User
}

export interface WorkspaceUserRemovedOutboxPayload extends WorkspaceScopedPayload {
  removedUserId: string
}

export interface WorkspaceUserUpdatedOutboxPayload extends WorkspaceScopedPayload {
  user: User
}

/** Stream-scoped event for sidebar updates when new messages arrive.
 *  Only members of the stream receive preview content. */
export interface StreamActivityOutboxPayload extends StreamScopedPayload {
  authorId: string
  lastMessagePreview: LastMessagePreview
}

// Conversation event payloads
export interface ConversationCreatedOutboxPayload extends StreamScopedPayload {
  conversationId: string
  conversation: ConversationWithStaleness
  /** For thread conversations, the parent channel's stream ID (for discoverability) */
  parentStreamId?: string
}

export interface ConversationUpdatedOutboxPayload extends StreamScopedPayload {
  conversationId: string
  conversation: ConversationWithStaleness
  /** For thread conversations, the parent channel's stream ID (for discoverability) */
  parentStreamId?: string
}

// Memo event payloads
export interface MemoCreatedOutboxPayload extends WorkspaceScopedPayload {
  memoId: string
  memo: WireMemo
}

export interface MemoRevisedOutboxPayload extends WorkspaceScopedPayload {
  memoId: string
  previousMemoId: string
  memo: WireMemo
  revisionReason: string
}

// Author-scoped event payloads (only visible to the author)
export interface CommandDispatchedOutboxPayload extends StreamScopedPayload {
  event: StreamEvent
  authorId: string
}

export interface CommandCompletedOutboxPayload extends StreamScopedPayload {
  authorId: string
  event: StreamEvent
}

export interface CommandFailedOutboxPayload extends StreamScopedPayload {
  authorId: string
  event: StreamEvent
}

// Agent session event payloads (stream-scoped - visible to all stream members)
export interface AgentSessionStartedOutboxPayload extends StreamScopedPayload {
  event: StreamEvent
}

export interface AgentSessionCompletedOutboxPayload extends StreamScopedPayload {
  event: StreamEvent
}

export interface AgentSessionFailedOutboxPayload extends StreamScopedPayload {
  event: StreamEvent
}

export interface AgentSessionDeletedOutboxPayload extends StreamScopedPayload {
  event: StreamEvent
}

// Read state event payloads (author-scoped - only visible to the user marking as read)
export interface StreamReadOutboxPayload extends WorkspaceScopedPayload {
  authorId: string
  streamId: string
  lastReadEventId: string
}

export interface StreamsReadAllOutboxPayload extends WorkspaceScopedPayload {
  authorId: string
  streamIds: string[]
}

// User preferences event payload (author-scoped - only visible to the user who updated)
export interface UserPreferencesUpdatedOutboxPayload extends WorkspaceScopedPayload {
  authorId: string
  preferences: UserPreferences
}

// Invitation event payloads
export interface InvitationSentOutboxPayload extends WorkspaceScopedPayload {
  invitationId: string
  email: string
  role: string
  inviterWorkosUserId?: string
}

export interface InvitationAcceptedOutboxPayload extends WorkspaceScopedPayload {
  invitationId: string
  email: string
  workosUserId: string
  userName: string
}

export interface InvitationRevokedOutboxPayload extends WorkspaceScopedPayload {
  invitationId: string
}

// User-scoped event payloads (delivered to a specific target user)
export interface ActivityCreatedOutboxPayload extends WorkspaceScopedPayload {
  targetUserId: string
  activity: {
    id: string
    activityType: string
    streamId: string
    messageId: string
    actorId: string
    actorType: string
    context: Record<string, unknown>
    createdAt: string
    /**
     * Self rows represent the target user's own action. The push service must
     * not deliver notifications for these; the frontend must not increment
     * unread counts either.
     */
    isSelf: boolean
  }
}

export interface SavedUpsertedOutboxPayload extends WorkspaceScopedPayload {
  targetUserId: string
  saved: SavedMessageView
}

export interface SavedDeletedOutboxPayload extends WorkspaceScopedPayload {
  targetUserId: string
  savedId: string
  messageId: string
}

export interface SavedReminderFiredOutboxPayload extends WorkspaceScopedPayload {
  targetUserId: string
  savedId: string
  messageId: string
  streamId: string
  saved: SavedMessageView
}

// Bot event payloads
export interface BotCreatedOutboxPayload extends WorkspaceScopedPayload {
  bot: WireBot
}

export interface BotUpdatedOutboxPayload extends WorkspaceScopedPayload {
  bot: WireBot
}

// Link preview event payloads
export interface LinkPreviewReadyOutboxPayload extends StreamScopedPayload {
  messageId: string
  previews: import("@threa/types").LinkPreviewSummary[]
}

export interface LinkPreviewDismissedOutboxPayload extends WorkspaceScopedPayload {
  authorId: string
  messageId: string
  linkPreviewId: string
}

// Budget alert event payload
export interface BudgetAlertOutboxPayload extends WorkspaceScopedPayload {
  alertType: string
  thresholdPercent: number
  currentUsageUsd: number
  budgetUsd: number
  percentUsed: number
}

/**
 * Maps event types to their payload types for type-safe event handling.
 */
export interface OutboxEventPayloadMap {
  "message:created": MessageCreatedOutboxPayload
  "message:edited": MessageEditedOutboxPayload
  "message:deleted": MessageDeletedOutboxPayload
  "message:updated": MessageUpdatedOutboxPayload
  "reaction:added": ReactionOutboxPayload
  "reaction:removed": ReactionOutboxPayload
  "stream:created": StreamCreatedOutboxPayload
  "stream:updated": StreamUpdatedOutboxPayload
  "stream:archived": StreamArchivedOutboxPayload
  "stream:unarchived": StreamUnarchivedOutboxPayload
  "stream:display_name_updated": StreamDisplayNameUpdatedPayload
  "stream:member_joined": StreamMemberJoinedOutboxPayload
  "stream:member_added": StreamMemberAddedOutboxPayload
  "stream:member_removed": StreamMemberRemovedOutboxPayload
  "stream:read": StreamReadOutboxPayload
  "stream:read_all": StreamsReadAllOutboxPayload
  "stream:activity": StreamActivityOutboxPayload
  "attachment:uploaded": AttachmentUploadedOutboxPayload
  "workspace_user:added": WorkspaceUserAddedOutboxPayload
  "workspace_user:removed": WorkspaceUserRemovedOutboxPayload
  "workspace_user:updated": WorkspaceUserUpdatedOutboxPayload
  "conversation:created": ConversationCreatedOutboxPayload
  "conversation:updated": ConversationUpdatedOutboxPayload
  "memo:created": MemoCreatedOutboxPayload
  "memo:revised": MemoRevisedOutboxPayload
  "command:dispatched": CommandDispatchedOutboxPayload
  "command:completed": CommandCompletedOutboxPayload
  "command:failed": CommandFailedOutboxPayload
  "agent_session:started": AgentSessionStartedOutboxPayload
  "agent_session:completed": AgentSessionCompletedOutboxPayload
  "agent_session:failed": AgentSessionFailedOutboxPayload
  "agent_session:deleted": AgentSessionDeletedOutboxPayload
  "user_preferences:updated": UserPreferencesUpdatedOutboxPayload
  "budget:alert": BudgetAlertOutboxPayload
  "invitation:sent": InvitationSentOutboxPayload
  "invitation:accepted": InvitationAcceptedOutboxPayload
  "invitation:revoked": InvitationRevokedOutboxPayload
  "activity:created": ActivityCreatedOutboxPayload
  "saved:upserted": SavedUpsertedOutboxPayload
  "saved:deleted": SavedDeletedOutboxPayload
  "saved_reminder:fired": SavedReminderFiredOutboxPayload
  "bot:created": BotCreatedOutboxPayload
  "bot:updated": BotUpdatedOutboxPayload
  "link_preview:ready": LinkPreviewReadyOutboxPayload
  "link_preview:dismissed": LinkPreviewDismissedOutboxPayload
  "attachment:transcoded": AttachmentTranscodedOutboxPayload
}

export type OutboxEventPayload<T extends OutboxEventType> = OutboxEventPayloadMap[T]

export interface OutboxEvent<T extends OutboxEventType = OutboxEventType> {
  id: bigint
  eventType: T
  payload: OutboxEventPayloadMap[T]
  createdAt: Date
}

/**
 * Type guard to narrow an OutboxEvent to a specific event type.
 */
export function isOutboxEventType<T extends OutboxEventType>(
  event: OutboxEvent,
  eventType: T
): event is OutboxEvent<T> {
  return event.eventType === eventType
}

/**
 * Type guard to narrow an OutboxEvent to one of several event types.
 */
export function isOneOfOutboxEventType<T extends OutboxEventType>(
  event: OutboxEvent,
  eventTypes: T[]
): event is OutboxEvent<T> {
  return eventTypes.includes(event.eventType as T)
}

const STREAM_SCOPED_EVENTS: StreamScopedEventType[] = [
  "message:created",
  "message:edited",
  "message:deleted",
  "message:updated",
  "reaction:added",
  "reaction:removed",
  "stream:display_name_updated",
  "stream:member_joined",
  "stream:member_added",
  "stream:member_removed",
  "stream:activity",
  "conversation:created",
  "conversation:updated",
  "agent_session:started",
  "agent_session:completed",
  "agent_session:failed",
  "agent_session:deleted",
  "link_preview:ready",
  "command:dispatched",
  "command:completed",
  "command:failed",
]

/**
 * Type guard to check if an event is stream-scoped (has streamId in payload).
 */
export function isStreamScopedEvent(event: OutboxEvent): event is OutboxEvent<StreamScopedEventType> {
  return STREAM_SCOPED_EVENTS.includes(event.eventType as StreamScopedEventType)
}

/** Events that are author-scoped (only visible to the author) */
export type AuthorScopedEventType =
  | "stream:read"
  | "stream:read_all"
  | "user_preferences:updated"
  | "link_preview:dismissed"

const AUTHOR_SCOPED_EVENTS: AuthorScopedEventType[] = [
  "stream:read",
  "stream:read_all",
  "link_preview:dismissed",
  "user_preferences:updated",
]

/**
 * Type guard to check if an event is author-scoped (only visible to the author).
 * These events are emitted only to sockets belonging to the author.
 */
export function isAuthorScopedEvent(event: OutboxEvent): event is OutboxEvent<AuthorScopedEventType> {
  return AUTHOR_SCOPED_EVENTS.includes(event.eventType as AuthorScopedEventType)
}

/** Events that are scoped to a specific target user (delivered to that user's sockets) */
export type UserScopedEventType = "activity:created" | "saved:upserted" | "saved:deleted" | "saved_reminder:fired"

const USER_SCOPED_EVENTS: UserScopedEventType[] = [
  "activity:created",
  "saved:upserted",
  "saved:deleted",
  "saved_reminder:fired",
]

/**
 * Type guard to check if an event is user-scoped (delivered to a specific target user).
 */
export function isUserScopedEvent(event: OutboxEvent): event is OutboxEvent<UserScopedEventType> {
  return USER_SCOPED_EVENTS.includes(event.eventType as UserScopedEventType)
}

export { OUTBOX_CHANNEL } from "@threa/backend-common"
export type { DeleteRetainedOutboxEventsParams } from "@threa/backend-common"

/**
 * Type-safe wrapper around the generic OutboxRepository.
 * Narrows event types and payload maps to backend domain types.
 */
export const OutboxRepository = {
  insert: BaseOutboxRepository.insert as <T extends OutboxEventType>(
    client: Querier,
    eventType: T,
    payload: OutboxEventPayloadMap[T]
  ) => Promise<OutboxEvent<T>>,

  insertMany: BaseOutboxRepository.insertMany as <T extends OutboxEventType>(
    client: Querier,
    entries: Array<{ eventType: T; payload: OutboxEventPayloadMap[T] }>
  ) => Promise<OutboxEvent<T>[]>,

  fetchAfterId: BaseOutboxRepository.fetchAfterId as unknown as (
    client: Querier,
    afterId: bigint,
    limit?: number,
    excludeIds?: bigint[]
  ) => Promise<OutboxEvent[]>,

  getRetentionWatermark: BaseOutboxRepository.getRetentionWatermark,
  deleteRetainedEvents: BaseOutboxRepository.deleteRetainedEvents,
}
