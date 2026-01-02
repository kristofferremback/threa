import { PoolClient } from "pg"
import { sql } from "../db"

// Internal row type (snake_case, not exported)
interface StreamEventRow {
  id: string
  stream_id: string
  sequence: string // bigint comes as string from pg
  event_type: string
  payload: unknown
  actor_id: string | null
  actor_type: string | null
  created_at: Date
}

// Domain type (camelCase, exported)
export type EventType =
  | "message_created"
  | "message_edited"
  | "message_deleted"
  | "reaction_added"
  | "reaction_removed"
  | "member_joined"
  | "member_left"
  | "thread_created"
  | "stream_archived"
  | "stream_unarchived"
  | "companion_response"
  | "command_dispatched"
  | "command_completed"
  | "command_failed"

export interface StreamEvent {
  id: string
  streamId: string
  sequence: bigint
  eventType: EventType
  payload: unknown
  actorId: string | null
  actorType: "user" | "persona" | null
  createdAt: Date
}

export interface InsertEventParams {
  id: string
  streamId: string
  eventType: EventType
  payload: unknown
  actorId?: string
  actorType?: "user" | "persona"
}

function mapRowToEvent(row: StreamEventRow): StreamEvent {
  return {
    id: row.id,
    streamId: row.stream_id,
    sequence: BigInt(row.sequence),
    eventType: row.event_type as EventType,
    payload: row.payload,
    actorId: row.actor_id,
    actorType: row.actor_type as "user" | "persona" | null,
    createdAt: row.created_at,
  }
}

export const StreamEventRepository = {
  async getNextSequence(client: PoolClient, streamId: string): Promise<bigint> {
    // Upsert and return next sequence atomically
    const result = await client.query<{ next_sequence: string }>(sql`
      INSERT INTO stream_sequences (stream_id, next_sequence)
      VALUES (${streamId}, 2)
      ON CONFLICT (stream_id) DO UPDATE
        SET next_sequence = stream_sequences.next_sequence + 1
      RETURNING next_sequence - 1 AS next_sequence
    `)
    return BigInt(result.rows[0].next_sequence)
  },

  async insert(client: PoolClient, params: InsertEventParams): Promise<StreamEvent> {
    const sequence = await this.getNextSequence(client, params.streamId)

    const result = await client.query<StreamEventRow>(sql`
      INSERT INTO stream_events (id, stream_id, sequence, event_type, payload, actor_id, actor_type)
      VALUES (
        ${params.id},
        ${params.streamId},
        ${sequence.toString()},
        ${params.eventType},
        ${JSON.stringify(params.payload)},
        ${params.actorId ?? null},
        ${params.actorType ?? null}
      )
      RETURNING id, stream_id, sequence, event_type, payload, actor_id, actor_type, created_at
    `)
    return mapRowToEvent(result.rows[0])
  },

  async list(
    client: PoolClient,
    streamId: string,
    filters?: { types?: EventType[]; afterSequence?: bigint; limit?: number; viewerId?: string }
  ): Promise<StreamEvent[]> {
    const limit = filters?.limit ?? 50
    const types = filters?.types
    const viewerId = filters?.viewerId
    const afterSequence = filters?.afterSequence

    // Command events are author-only: only visible to the actor who created them.
    // If viewerId is provided, filter out command events from other users.
    // If viewerId is not provided, return all events (backwards compatibility for internal use).
    const COMMAND_EVENT_TYPES = ["command_dispatched", "command_completed", "command_failed"]

    // Build query dynamically to avoid 8 permutations of the same query
    const conditions: string[] = ["stream_id = $1"]
    const params: unknown[] = [streamId]
    let paramIndex = 2

    if (afterSequence !== undefined) {
      conditions.push(`sequence > $${paramIndex}`)
      params.push(afterSequence.toString())
      paramIndex++
    }

    if (types && types.length > 0) {
      conditions.push(`event_type = ANY($${paramIndex})`)
      params.push(types)
      paramIndex++
    }

    if (viewerId) {
      conditions.push(`(event_type != ALL($${paramIndex}) OR actor_id = $${paramIndex + 1})`)
      params.push(COMMAND_EVENT_TYPES)
      params.push(viewerId)
      paramIndex += 2
    }

    // If afterSequence is provided, paginate forward (ASC order)
    // Otherwise, get the most recent N events (DESC, then reverse)
    const orderDirection = afterSequence !== undefined ? "ASC" : "DESC"

    const query = `
      SELECT id, stream_id, sequence, event_type, payload, actor_id, actor_type, created_at
      FROM stream_events
      WHERE ${conditions.join(" AND ")}
      ORDER BY sequence ${orderDirection}
      LIMIT $${paramIndex}
    `
    params.push(limit)

    const result = await client.query<StreamEventRow>(query, params)
    const events = result.rows.map(mapRowToEvent)

    // When fetching most recent (DESC), reverse to return in chronological order
    return afterSequence !== undefined ? events : events.reverse()
  },

  async findById(client: PoolClient, id: string): Promise<StreamEvent | null> {
    const result = await client.query<StreamEventRow>(sql`
      SELECT id, stream_id, sequence, event_type, payload, actor_id, actor_type, created_at
      FROM stream_events
      WHERE id = ${id}
    `)
    return result.rows[0] ? mapRowToEvent(result.rows[0]) : null
  },

  async getLatestSequence(client: PoolClient, streamId: string): Promise<bigint | null> {
    const result = await client.query<{ sequence: string }>(sql`
      SELECT sequence FROM stream_events
      WHERE stream_id = ${streamId}
      ORDER BY sequence DESC
      LIMIT 1
    `)
    return result.rows[0] ? BigInt(result.rows[0].sequence) : null
  },

  /**
   * Count message_created events for multiple streams.
   * Returns a map of streamId -> message count
   */
  async countMessagesByStreamBatch(client: PoolClient, streamIds: string[]): Promise<Map<string, number>> {
    if (streamIds.length === 0) return new Map()

    const result = await client.query<{ stream_id: string; count: string }>(sql`
      SELECT stream_id, COUNT(*)::text AS count
      FROM stream_events
      WHERE stream_id = ANY(${streamIds})
        AND event_type = 'message_created'
      GROUP BY stream_id
    `)

    const map = new Map<string, number>()
    for (const row of result.rows) {
      map.set(row.stream_id, parseInt(row.count, 10))
    }
    return map
  },

  /**
   * Count unread message_created events per stream for a user.
   * Unread = events with sequence > lastReadEventId's sequence.
   * If lastReadEventId is null, all messages in that stream are unread.
   */
  async countUnreadByStreamBatch(
    client: PoolClient,
    memberships: Array<{ streamId: string; lastReadEventId: string | null }>
  ): Promise<Map<string, number>> {
    if (memberships.length === 0) return new Map()

    const streamIds = memberships.map((m) => m.streamId)
    const lastReadEventIds = memberships.map((m) => m.lastReadEventId)

    const result = await client.query<{ stream_id: string; unread_count: string }>(
      `
      WITH memberships AS (
        SELECT
          m.stream_id,
          COALESCE(se.sequence, 0) as last_read_seq
        FROM (
          SELECT unnest($1::text[]) as stream_id, unnest($2::text[]) as last_read_event_id
        ) m
        LEFT JOIN stream_events se ON se.id = m.last_read_event_id
      )
      SELECT
        m.stream_id,
        COUNT(*) FILTER (WHERE e.sequence > m.last_read_seq)::text as unread_count
      FROM memberships m
      LEFT JOIN stream_events e ON e.stream_id = m.stream_id AND e.event_type = 'message_created'
      GROUP BY m.stream_id
    `,
      [streamIds, lastReadEventIds]
    )

    const map = new Map<string, number>()
    for (const row of result.rows) {
      map.set(row.stream_id, parseInt(row.unread_count, 10))
    }
    return map
  },

  /**
   * Get the latest event ID for multiple streams.
   * Returns a map of streamId -> latestEventId
   */
  async getLatestEventIdByStreamBatch(client: PoolClient, streamIds: string[]): Promise<Map<string, string>> {
    if (streamIds.length === 0) return new Map()

    const result = await client.query<{ stream_id: string; latest_event_id: string }>(sql`
      SELECT DISTINCT ON (stream_id) stream_id, id as latest_event_id
      FROM stream_events
      WHERE stream_id = ANY(${streamIds})
      ORDER BY stream_id, sequence DESC
    `)

    const map = new Map<string, string>()
    for (const row of result.rows) {
      map.set(row.stream_id, row.latest_event_id)
    }
    return map
  },
}
