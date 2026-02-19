import { sql, type Querier } from "../../db"
import { bigIntReplacer } from "../serialization"
import type { Stream } from "../../features/streams"
import type { StreamEvent } from "../../features/streams"
import type { Member } from "../../features/workspaces"
import type { ConversationWithStaleness } from "../../features/conversations"
import type { Memo as WireMemo, UserPreferences, LastMessagePreview } from "@threa/types"

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
  | "workspace_member:added"
  | "workspace_member:removed"
  | "member:updated"
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
  | "activity:created"

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

/** Events that are scoped to a workspace (no streamId) */
export type WorkspaceScopedEventType =
  | "stream:created"
  | "stream:updated"
  | "stream:archived"
  | "stream:unarchived"
  | "attachment:uploaded"
  | "workspace_member:added"
  | "workspace_member:removed"
  | "member:updated"

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
}

export interface ReactionOutboxPayload extends StreamScopedPayload {
  messageId: string
  emoji: string
  memberId: string
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
}

// Workspace-scoped event payloads (no streamId)
// Note: StreamCreatedOutboxPayload includes streamId for routing:
// - For threads: streamId = parentStreamId (broadcast to parent stream room)
// - For non-threads: streamId = stream.id (broadcast to workspace room)
export interface StreamCreatedOutboxPayload extends WorkspaceScopedPayload {
  streamId: string
  stream: Stream
  dmMemberIds?: [string, string]
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

export interface WorkspaceMemberAddedOutboxPayload extends WorkspaceScopedPayload {
  member: Member
}

export interface WorkspaceMemberRemovedOutboxPayload extends WorkspaceScopedPayload {
  memberId: string
}

export interface MemberUpdatedOutboxPayload extends WorkspaceScopedPayload {
  member: Member
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
}

export interface InvitationAcceptedOutboxPayload extends WorkspaceScopedPayload {
  invitationId: string
  email: string
  userId: string
}

// Member-scoped event payloads (delivered to a specific target member)
export interface ActivityCreatedOutboxPayload extends WorkspaceScopedPayload {
  targetMemberId: string
  activity: {
    id: string
    activityType: string
    streamId: string
    messageId: string
    actorId: string
    actorType: string
    context: Record<string, unknown>
    createdAt: string
  }
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
  "workspace_member:added": WorkspaceMemberAddedOutboxPayload
  "workspace_member:removed": WorkspaceMemberRemovedOutboxPayload
  "member:updated": MemberUpdatedOutboxPayload
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
  "activity:created": ActivityCreatedOutboxPayload
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
]

/**
 * Type guard to check if an event is stream-scoped (has streamId in payload).
 */
export function isStreamScopedEvent(event: OutboxEvent): event is OutboxEvent<StreamScopedEventType> {
  return STREAM_SCOPED_EVENTS.includes(event.eventType as StreamScopedEventType)
}

/** Events that are author-scoped (only visible to the author) */
export type AuthorScopedEventType =
  | "command:dispatched"
  | "command:completed"
  | "command:failed"
  | "stream:read"
  | "stream:read_all"
  | "user_preferences:updated"

const AUTHOR_SCOPED_EVENTS: AuthorScopedEventType[] = [
  "command:dispatched",
  "command:completed",
  "command:failed",
  "stream:read",
  "stream:read_all",
  "user_preferences:updated",
]

/**
 * Type guard to check if an event is author-scoped (only visible to the author).
 * These events are emitted only to sockets belonging to the author.
 */
export function isAuthorScopedEvent(event: OutboxEvent): event is OutboxEvent<AuthorScopedEventType> {
  return AUTHOR_SCOPED_EVENTS.includes(event.eventType as AuthorScopedEventType)
}

/** Events that are scoped to a specific target member (delivered to that member's sockets) */
export type MemberScopedEventType = "activity:created"

const MEMBER_SCOPED_EVENTS: MemberScopedEventType[] = ["activity:created"]

/**
 * Type guard to check if an event is member-scoped (delivered to a specific target member).
 */
export function isMemberScopedEvent(event: OutboxEvent): event is OutboxEvent<MemberScopedEventType> {
  return MEMBER_SCOPED_EVENTS.includes(event.eventType as MemberScopedEventType)
}

interface OutboxRow {
  id: string
  event_type: string
  payload: unknown
  created_at: Date
}

interface RetentionWatermarkRow {
  listener_count: string
  min_last_processed_id: string | null
}

export interface DeleteRetainedOutboxEventsParams {
  maxEventId: bigint
  createdBefore: Date
  limit: number
}

function mapRowToOutbox(row: OutboxRow): OutboxEvent {
  return {
    id: BigInt(row.id),
    eventType: row.event_type as OutboxEventType,
    payload: row.payload as OutboxEventPayloadMap[OutboxEventType],
    createdAt: row.created_at,
  }
}

export const OUTBOX_CHANNEL = "outbox_events"

export const OutboxRepository = {
  async insert<T extends OutboxEventType>(
    client: Querier,
    eventType: T,
    payload: OutboxEventPayloadMap[T]
  ): Promise<OutboxEvent<T>> {
    const result = await client.query<OutboxRow>(sql`
      INSERT INTO outbox (event_type, payload)
      VALUES (${eventType}, ${JSON.stringify(payload, bigIntReplacer)})
      RETURNING id, event_type, payload, created_at
    `)

    // Notify listeners that new events are available
    await client.query(`NOTIFY ${OUTBOX_CHANNEL}`)

    return mapRowToOutbox(result.rows[0]) as OutboxEvent<T>
  },

  /**
   * Fetches events after a cursor ID for cursor-based processing.
   * No locking - the caller should hold a lock on their listener's cursor row.
   *
   * @param excludeIds IDs to skip (already processed in the sliding window)
   */
  async fetchAfterId(
    client: Querier,
    afterId: bigint,
    limit: number = 100,
    excludeIds: bigint[] = []
  ): Promise<OutboxEvent[]> {
    if (excludeIds.length === 0) {
      const result = await client.query<OutboxRow>(sql`
        SELECT id, event_type, payload, created_at
        FROM outbox
        WHERE id > ${afterId.toString()}
        ORDER BY id
        LIMIT ${limit}
      `)
      return result.rows.map(mapRowToOutbox)
    }

    const excludeIdStrings = excludeIds.map((id) => id.toString())
    const result = await client.query<OutboxRow>(sql`
      SELECT id, event_type, payload, created_at
      FROM outbox
      WHERE id > ${afterId.toString()}
        AND id != ALL(${excludeIdStrings}::bigint[])
      ORDER BY id
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToOutbox)
  },

  /**
   * Returns the retention watermark for the specified listeners.
   * The watermark is the minimum cursor across all listeners.
   *
   * Safety behavior:
   * - Returns null if listenerIds is empty
   * - Returns null if any listener row is missing
   */
  async getRetentionWatermark(client: Querier, listenerIds: string[]): Promise<bigint | null> {
    if (listenerIds.length === 0) {
      return null
    }

    const result = await client.query<RetentionWatermarkRow>(sql`
      SELECT
        COUNT(*)::text AS listener_count,
        MIN(last_processed_id)::text AS min_last_processed_id
      FROM outbox_listeners
      WHERE listener_id = ANY(${listenerIds})
    `)

    const row = result.rows[0]
    const listenerCount = Number(row.listener_count)

    if (listenerCount !== listenerIds.length) {
      return null
    }

    if (row.min_last_processed_id === null) {
      return null
    }

    return BigInt(row.min_last_processed_id)
  },

  /**
   * Deletes outbox events that are both:
   * - At or before the listener watermark (safe for all listeners)
   * - Older than the retention cutoff
   *
   * Deletion is batched to keep transactions short.
   */
  async deleteRetainedEvents(client: Querier, params: DeleteRetainedOutboxEventsParams): Promise<number> {
    if (params.limit <= 0) {
      return 0
    }

    const result = await client.query(sql`
      WITH candidates AS (
        SELECT id
        FROM outbox
        WHERE id <= ${params.maxEventId.toString()}
          AND created_at < ${params.createdBefore}
        ORDER BY id
        LIMIT ${params.limit}
      )
      DELETE FROM outbox
      USING candidates
      WHERE outbox.id = candidates.id
    `)

    return result.rowCount ?? 0
  },
}
