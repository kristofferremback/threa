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

/**
 * Base fields present on all outbox event payloads.
 * workspaceId is required for room scoping in broadcast.
 */
interface BaseOutboxPayload {
  workspaceId: string
  streamId: string
}

export interface MessageCreatedOutboxPayload extends BaseOutboxPayload {
  event: StreamEvent
}

export interface MessageEditedOutboxPayload extends BaseOutboxPayload {
  event: StreamEvent
}

export interface MessageDeletedOutboxPayload extends BaseOutboxPayload {
  messageId: string
}

export interface ReactionOutboxPayload extends BaseOutboxPayload {
  messageId: string
  emoji: string
  userId: string
}

export interface StreamCreatedOutboxPayload extends BaseOutboxPayload {
  stream: Stream
}

export interface StreamUpdatedOutboxPayload extends BaseOutboxPayload {
  stream: Stream
}

export interface StreamArchivedOutboxPayload extends BaseOutboxPayload {
  stream: Stream
}

export interface StreamDisplayNameUpdatedPayload extends BaseOutboxPayload {
  displayName: string
}

export interface AttachmentUploadedOutboxPayload extends BaseOutboxPayload {
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
