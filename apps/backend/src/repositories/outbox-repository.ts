import { PoolClient } from "pg"
import { sql } from "../db"
import { bigIntReplacer } from "../lib/serialization"
import type { Stream } from "./stream-repository"
import type { StreamEvent } from "./stream-event-repository"
import type { User } from "./user-repository"
import type { ConversationWithStaleness } from "../lib/conversation-staleness"
import type { Memo as WireMemo } from "@threa/types"

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
  | "stream:display_name_updated"
  | "stream:read"
  | "streams:read_all"
  | "attachment:uploaded"
  | "workspace_member:added"
  | "workspace_member:removed"
  | "user:updated"
  | "conversation:created"
  | "conversation:updated"
  | "memo:created"
  | "memo:revised"
  | "command:dispatched"
  | "command:completed"
  | "command:failed"

/** Events that are scoped to a stream (have streamId) */
export type StreamScopedEventType =
  | "message:created"
  | "message:edited"
  | "message:deleted"
  | "message:updated"
  | "reaction:added"
  | "reaction:removed"
  | "stream:display_name_updated"
  | "conversation:created"
  | "conversation:updated"

/** Events that are scoped to a workspace (no streamId) */
export type WorkspaceScopedEventType =
  | "stream:created"
  | "stream:updated"
  | "stream:archived"
  | "attachment:uploaded"
  | "workspace_member:added"
  | "workspace_member:removed"
  | "user:updated"

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
  userId: string
}

export interface StreamDisplayNameUpdatedPayload extends StreamScopedPayload {
  displayName: string
}

// Workspace-scoped event payloads (no streamId)
// Note: StreamCreatedOutboxPayload includes streamId for routing:
// - For threads: streamId = parentStreamId (broadcast to parent stream room)
// - For non-threads: streamId = stream.id (broadcast to workspace room)
export interface StreamCreatedOutboxPayload extends WorkspaceScopedPayload {
  streamId: string
  stream: Stream
}

export interface StreamUpdatedOutboxPayload extends WorkspaceScopedPayload {
  streamId: string
  stream: Stream
}

export interface StreamArchivedOutboxPayload extends WorkspaceScopedPayload {
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
  user: User
}

export interface WorkspaceMemberRemovedOutboxPayload extends WorkspaceScopedPayload {
  userId: string
}

export interface UserUpdatedOutboxPayload extends WorkspaceScopedPayload {
  user: User
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
  "stream:display_name_updated": StreamDisplayNameUpdatedPayload
  "stream:read": StreamReadOutboxPayload
  "streams:read_all": StreamsReadAllOutboxPayload
  "attachment:uploaded": AttachmentUploadedOutboxPayload
  "workspace_member:added": WorkspaceMemberAddedOutboxPayload
  "workspace_member:removed": WorkspaceMemberRemovedOutboxPayload
  "user:updated": UserUpdatedOutboxPayload
  "conversation:created": ConversationCreatedOutboxPayload
  "conversation:updated": ConversationUpdatedOutboxPayload
  "memo:created": MemoCreatedOutboxPayload
  "memo:revised": MemoRevisedOutboxPayload
  "command:dispatched": CommandDispatchedOutboxPayload
  "command:completed": CommandCompletedOutboxPayload
  "command:failed": CommandFailedOutboxPayload
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
  "conversation:created",
  "conversation:updated",
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
  | "streams:read_all"

const AUTHOR_SCOPED_EVENTS: AuthorScopedEventType[] = [
  "command:dispatched",
  "command:completed",
  "command:failed",
  "stream:read",
  "streams:read_all",
]

/**
 * Type guard to check if an event is author-scoped (only visible to the author).
 * These events are emitted only to sockets belonging to the author.
 */
export function isAuthorScopedEvent(event: OutboxEvent): event is OutboxEvent<AuthorScopedEventType> {
  return AUTHOR_SCOPED_EVENTS.includes(event.eventType as AuthorScopedEventType)
}

interface OutboxRow {
  id: string
  event_type: string
  payload: unknown
  created_at: Date
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
    client: PoolClient,
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
   */
  async fetchAfterId(client: PoolClient, afterId: bigint, limit: number = 100): Promise<OutboxEvent[]> {
    const result = await client.query<OutboxRow>(sql`
      SELECT id, event_type, payload, created_at
      FROM outbox
      WHERE id > ${afterId.toString()}
      ORDER BY id
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToOutbox)
  },
}
