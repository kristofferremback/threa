import type { PoolClient } from "pg"
import { sql } from "../lib/db"

/**
 * Raw database row for stream_events table.
 */
export interface StreamEventRow {
  id: string
  stream_id: string
  event_type: string
  actor_id: string | null
  content_type: string | null
  content_id: string | null
  payload: Record<string, unknown> | null
  created_at: Date
  edited_at: Date | null
  deleted_at: Date | null
  agent_id: string | null
  client_message_id: string | null
}

/**
 * Event with stream info (workspace_id).
 */
export interface EventWithStreamRow extends StreamEventRow {
  workspace_id: string
}

/**
 * Event with stream and text message content.
 */
export interface EventWithContentRow extends EventWithStreamRow {
  parent_stream_id: string | null
  message_content: string | null
  mentions: unknown[] | null
}

/**
 * Event with full details for display (joins with users, agents, messages).
 */
export interface StreamEventWithDetailsRow extends StreamEventRow {
  actor_email: string | null
  actor_name: string | null
  actor_avatar: string | null
  agent_name: string | null
  agent_avatar: string | null
  content: string | null
  mentions: unknown[] | null
  formatting: unknown | null
  original_event_id: string | null
  share_context: string | null
  reply_count?: number
}

/**
 * Parameters for inserting an event.
 */
export interface InsertEventParams {
  id: string
  streamId: string
  eventType: string
  actorId?: string | null
  agentId?: string | null
  contentType?: string | null
  contentId?: string | null
  payload?: Record<string, unknown> | null
  clientMessageId?: string | null
}

/**
 * Parameters for paginated event queries.
 */
export interface FindEventsParams {
  limit: number
  offset: number
}

/**
 * Repository for stream_events table operations.
 *
 * Design principles:
 * - Accepts PoolClient as first parameter (enables transaction control from service)
 * - Returns raw database rows (services handle mapping)
 * - No side effects (no outbox events, no external calls)
 * - Uses explicit field selection (no SELECT *)
 */
export const StreamEventRepository = {
  /**
   * Find an event by ID.
   */
  async findEventById(client: PoolClient, eventId: string): Promise<StreamEventRow | null> {
    const result = await client.query<StreamEventRow>(
      sql`SELECT
            id, stream_id, event_type, actor_id, content_type, content_id,
            payload, created_at, edited_at, deleted_at, agent_id, client_message_id
          FROM stream_events
          WHERE id = ${eventId}`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Find an event by ID with row lock.
   * Used for concurrent operations to prevent race conditions.
   */
  async findEventByIdForUpdate(
    client: PoolClient,
    eventId: string,
  ): Promise<StreamEventRow | null> {
    const result = await client.query<StreamEventRow>(
      sql`SELECT
            id, stream_id, event_type, actor_id, content_type, content_id,
            payload, created_at, edited_at, deleted_at, agent_id, client_message_id
          FROM stream_events
          WHERE id = ${eventId}
          FOR UPDATE`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Find an event with stream info (for validation/context).
   */
  async findEventWithStream(
    client: PoolClient,
    eventId: string,
  ): Promise<EventWithStreamRow | null> {
    const result = await client.query<EventWithStreamRow>(
      sql`SELECT
            e.id, e.stream_id, e.event_type, e.actor_id, e.content_type, e.content_id,
            e.payload, e.created_at, e.edited_at, e.deleted_at, e.agent_id, e.client_message_id,
            s.workspace_id
          FROM stream_events e
          INNER JOIN streams s ON e.stream_id = s.id
          WHERE e.id = ${eventId}`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Find an event with message content for threading/display.
   */
  async findEventWithStreamAndContent(
    client: PoolClient,
    eventId: string,
  ): Promise<EventWithContentRow | null> {
    const result = await client.query<EventWithContentRow>(
      sql`SELECT
            e.id, e.stream_id, e.event_type, e.actor_id, e.content_type, e.content_id,
            e.payload, e.created_at, e.edited_at, e.deleted_at, e.agent_id, e.client_message_id,
            s.workspace_id, s.parent_stream_id,
            tm.content as message_content, tm.mentions
          FROM stream_events e
          INNER JOIN streams s ON e.stream_id = s.id
          LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
          WHERE e.id = ${eventId}`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Find event by client message ID for idempotency checks.
   */
  async findEventByClientMessageId(
    client: PoolClient,
    streamId: string,
    clientMessageId: string,
  ): Promise<StreamEventWithDetailsRow | null> {
    const result = await client.query<StreamEventWithDetailsRow>(
      sql`SELECT
            se.id, se.stream_id, se.event_type, se.actor_id, se.content_type, se.content_id,
            se.payload, se.created_at, se.edited_at, se.deleted_at, se.agent_id, se.client_message_id,
            tm.content, tm.mentions,
            u.email as actor_email,
            u.name as actor_name,
            NULL::text as actor_avatar,
            NULL::text as agent_name,
            NULL::text as agent_avatar,
            NULL::text as formatting,
            NULL::text as original_event_id,
            NULL::text as share_context
          FROM stream_events se
          LEFT JOIN text_messages tm ON se.content_id = tm.id AND se.content_type = 'text_message'
          LEFT JOIN users u ON se.actor_id = u.id
          WHERE se.client_message_id = ${clientMessageId} AND se.stream_id = ${streamId}`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Find paginated events for a stream with full details.
   */
  async findEventsByStreamId(
    client: PoolClient,
    streamId: string,
    params: FindEventsParams,
  ): Promise<StreamEventWithDetailsRow[]> {
    const result = await client.query<StreamEventWithDetailsRow>(
      sql`SELECT
            e.id, e.stream_id, e.event_type, e.actor_id, e.content_type, e.content_id,
            e.payload, e.created_at, e.edited_at, e.deleted_at, e.agent_id, e.client_message_id,
            u.email as actor_email,
            COALESCE(wp.display_name, u.name) as actor_name,
            wp.avatar_url as actor_avatar,
            ap.name as agent_name,
            ap.avatar_emoji as agent_avatar,
            tm.content, tm.mentions, tm.formatting,
            sr.original_event_id, sr.context as share_context,
            (SELECT COUNT(*)::int FROM stream_events se2
             INNER JOIN streams s2 ON s2.branched_from_event_id = e.id
             WHERE se2.stream_id = s2.id AND se2.deleted_at IS NULL
            ) as reply_count
          FROM stream_events e
          INNER JOIN streams s ON e.stream_id = s.id
          LEFT JOIN users u ON e.actor_id = u.id
          LEFT JOIN workspace_profiles wp ON wp.workspace_id = s.workspace_id AND wp.user_id = e.actor_id
          LEFT JOIN agent_personas ap ON e.agent_id = ap.id
          LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
          LEFT JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
          WHERE e.stream_id = ${streamId} AND e.deleted_at IS NULL
          ORDER BY e.created_at DESC
          LIMIT ${params.limit} OFFSET ${params.offset}`,
    )
    return result.rows
  },

  /**
   * Find a single event with full details.
   */
  async findEventWithDetails(
    client: PoolClient,
    eventId: string,
  ): Promise<StreamEventWithDetailsRow | null> {
    const result = await client.query<StreamEventWithDetailsRow>(
      sql`SELECT
            e.id, e.stream_id, e.event_type, e.actor_id, e.content_type, e.content_id,
            e.payload, e.created_at, e.edited_at, e.deleted_at, e.agent_id, e.client_message_id,
            u.email as actor_email,
            COALESCE(wp.display_name, u.name) as actor_name,
            wp.avatar_url as actor_avatar,
            ap.name as agent_name,
            ap.avatar_emoji as agent_avatar,
            tm.content, tm.mentions, tm.formatting,
            sr.original_event_id, sr.context as share_context,
            (SELECT COUNT(*)::int FROM stream_events se2
             INNER JOIN streams s2 ON s2.branched_from_event_id = e.id
             WHERE se2.stream_id = s2.id AND se2.deleted_at IS NULL
            ) as reply_count
          FROM stream_events e
          INNER JOIN streams s ON e.stream_id = s.id
          LEFT JOIN users u ON e.actor_id = u.id
          LEFT JOIN workspace_profiles wp ON wp.workspace_id = s.workspace_id AND wp.user_id = e.actor_id
          LEFT JOIN agent_personas ap ON e.agent_id = ap.id
          LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
          LEFT JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
          WHERE e.id = ${eventId} AND e.deleted_at IS NULL`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Batch fetch events by IDs (for hydrating shared refs).
   */
  async findEventsByIds(
    client: PoolClient,
    eventIds: string[],
  ): Promise<StreamEventWithDetailsRow[]> {
    if (eventIds.length === 0) return []

    const result = await client.query<StreamEventWithDetailsRow>(
      sql`SELECT
            e.id, e.stream_id, e.event_type, e.actor_id, e.content_type, e.content_id,
            e.payload, e.created_at, e.edited_at, e.deleted_at, e.agent_id, e.client_message_id,
            u.email as actor_email,
            COALESCE(wp.display_name, u.name) as actor_name,
            wp.avatar_url as actor_avatar,
            ap.name as agent_name,
            ap.avatar_emoji as agent_avatar,
            tm.content, tm.mentions, tm.formatting,
            sr.original_event_id, sr.context as share_context
          FROM stream_events e
          INNER JOIN streams s ON e.stream_id = s.id
          LEFT JOIN users u ON e.actor_id = u.id
          LEFT JOIN workspace_profiles wp ON wp.workspace_id = s.workspace_id AND wp.user_id = e.actor_id
          LEFT JOIN agent_personas ap ON e.agent_id = ap.id
          LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
          LEFT JOIN shared_refs sr ON e.content_type = 'shared_ref' AND e.content_id = sr.id
          WHERE e.id = ANY(${eventIds})`,
    )
    return result.rows
  },

  /**
   * Insert a new event.
   */
  async insertEvent(client: PoolClient, params: InsertEventParams): Promise<StreamEventRow> {
    const result = await client.query<StreamEventRow>(
      sql`INSERT INTO stream_events (
            id, stream_id, event_type, actor_id, agent_id,
            content_type, content_id, payload, client_message_id
          )
          VALUES (
            ${params.id}, ${params.streamId}, ${params.eventType},
            ${params.actorId ?? null}, ${params.agentId ?? null},
            ${params.contentType ?? null}, ${params.contentId ?? null},
            ${params.payload ? JSON.stringify(params.payload) : null},
            ${params.clientMessageId ?? null}
          )
          RETURNING
            id, stream_id, event_type, actor_id, content_type, content_id,
            payload, created_at, edited_at, deleted_at, agent_id, client_message_id`,
    )
    return result.rows[0]
  },

  /**
   * Mark an event as edited.
   */
  async updateEventEditedAt(client: PoolClient, eventId: string): Promise<void> {
    await client.query(sql`UPDATE stream_events SET edited_at = NOW() WHERE id = ${eventId}`)
  },

  /**
   * Soft-delete an event.
   */
  async softDeleteEvent(client: PoolClient, eventId: string): Promise<void> {
    await client.query(sql`UPDATE stream_events SET deleted_at = NOW() WHERE id = ${eventId}`)
  },

  /**
   * Count messages in a stream (for auto-naming threshold).
   */
  async countMessagesByStreamId(client: PoolClient, streamId: string): Promise<number> {
    const result = await client.query<{ count: number }>(
      sql`SELECT COUNT(*)::int as count
          FROM stream_events
          WHERE stream_id = ${streamId} AND event_type = 'message' AND deleted_at IS NULL`,
    )
    return result.rows[0].count
  },

  /**
   * Get recent message content for auto-naming.
   */
  async findRecentMessagesContent(
    client: PoolClient,
    streamId: string,
    limit: number,
  ): Promise<{ content: string }[]> {
    const result = await client.query<{ content: string }>(
      sql`SELECT tm.content
          FROM stream_events e
          INNER JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
          WHERE e.stream_id = ${streamId} AND e.event_type = 'message' AND e.deleted_at IS NULL
          ORDER BY e.created_at ASC
          LIMIT ${limit}`,
    )
    return result.rows
  },

  /**
   * Get the stream ID for an event.
   */
  async findEventStreamId(client: PoolClient, eventId: string): Promise<string | null> {
    const result = await client.query<{ stream_id: string }>(
      sql`SELECT stream_id FROM stream_events WHERE id = ${eventId}`,
    )
    return result.rows[0]?.stream_id ?? null
  },
}
