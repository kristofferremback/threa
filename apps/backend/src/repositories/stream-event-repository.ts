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
  | "companion_response"

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
    filters?: { types?: EventType[]; afterSequence?: bigint; limit?: number }
  ): Promise<StreamEvent[]> {
    const limit = filters?.limit ?? 50
    const afterSequence = filters?.afterSequence ?? BigInt(-1)
    const types = filters?.types

    if (types && types.length > 0) {
      const result = await client.query<StreamEventRow>(sql`
        SELECT id, stream_id, sequence, event_type, payload, actor_id, actor_type, created_at
        FROM stream_events
        WHERE stream_id = ${streamId}
          AND sequence > ${afterSequence.toString()}
          AND event_type = ANY(${types})
        ORDER BY sequence ASC
        LIMIT ${limit}
      `)
      return result.rows.map(mapRowToEvent)
    }

    const result = await client.query<StreamEventRow>(sql`
      SELECT id, stream_id, sequence, event_type, payload, actor_id, actor_type, created_at
      FROM stream_events
      WHERE stream_id = ${streamId}
        AND sequence > ${afterSequence.toString()}
      ORDER BY sequence ASC
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToEvent)
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
}
