import { PoolClient } from "pg"
import { sql } from "../db"
import { bigIntReplacer } from "../lib/serialization"
import type { Stream } from "./stream-repository"
import type { StreamEvent } from "./stream-event-repository"

/**
 * Outbox event types and their payloads.
 * Use the OutboxEventPayload type to get type-safe payload access.
 */
export type OutboxEventType =
  | "message:created"
  | "message:edited"
  | "message:deleted"
  | "reaction:added"
  | "reaction:removed"
  | "stream:created"
  | "stream:updated"
  | "stream:archived"
  | "stream:display_name_updated"
  | "attachment:uploaded"

/** Events that are scoped to a stream (have streamId) */
export type StreamScopedEventType =
  | "message:created"
  | "message:edited"
  | "message:deleted"
  | "reaction:added"
  | "reaction:removed"
  | "stream:display_name_updated"

/** Events that are scoped to a workspace (no streamId) */
export type WorkspaceScopedEventType = "stream:created" | "stream:updated" | "stream:archived" | "attachment:uploaded"

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

export interface ReactionOutboxPayload extends StreamScopedPayload {
  messageId: string
  emoji: string
  userId: string
}

export interface StreamDisplayNameUpdatedPayload extends StreamScopedPayload {
  displayName: string
}

// Workspace-scoped event payloads (no streamId)
export interface StreamCreatedOutboxPayload extends WorkspaceScopedPayload {
  stream: Stream
}

export interface StreamUpdatedOutboxPayload extends WorkspaceScopedPayload {
  stream: Stream
}

export interface StreamArchivedOutboxPayload extends WorkspaceScopedPayload {
  stream: Stream
}

export interface AttachmentUploadedOutboxPayload extends WorkspaceScopedPayload {
  attachmentId: string
  filename: string
  mimeType: string
  sizeBytes: number
  storagePath: string
}

/**
 * Maps event types to their payload types for type-safe event handling.
 */
export interface OutboxEventPayloadMap {
  "message:created": MessageCreatedOutboxPayload
  "message:edited": MessageEditedOutboxPayload
  "message:deleted": MessageDeletedOutboxPayload
  "reaction:added": ReactionOutboxPayload
  "reaction:removed": ReactionOutboxPayload
  "stream:created": StreamCreatedOutboxPayload
  "stream:updated": StreamUpdatedOutboxPayload
  "stream:archived": StreamArchivedOutboxPayload
  "stream:display_name_updated": StreamDisplayNameUpdatedPayload
  "attachment:uploaded": AttachmentUploadedOutboxPayload
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

const STREAM_SCOPED_EVENTS: StreamScopedEventType[] = [
  "message:created",
  "message:edited",
  "message:deleted",
  "reaction:added",
  "reaction:removed",
  "stream:display_name_updated",
]

/**
 * Type guard to check if an event is stream-scoped (has streamId in payload).
 */
export function isStreamScopedEvent(event: OutboxEvent): event is OutboxEvent<StreamScopedEventType> {
  return STREAM_SCOPED_EVENTS.includes(event.eventType as StreamScopedEventType)
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
