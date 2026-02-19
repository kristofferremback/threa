import type { Querier } from "../../db"
import { sql } from "../../db"
import { COMMAND_EVENT_TYPES, type AgentSessionRerunContext, type AuthorType, type EventType } from "@threa/types"

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

interface AgentSessionRerunContextRow {
  session_id: string
  rerun_context: unknown
}

export interface StreamEvent {
  id: string
  streamId: string
  sequence: bigint
  eventType: EventType
  payload: unknown
  actorId: string | null
  actorType: AuthorType | null
  createdAt: Date
}

export interface InsertEventParams {
  id: string
  streamId: string
  eventType: EventType
  payload: unknown
  actorId?: string
  actorType?: AuthorType
}

function mapRowToEvent(row: StreamEventRow): StreamEvent {
  return {
    id: row.id,
    streamId: row.stream_id,
    sequence: BigInt(row.sequence),
    eventType: row.event_type as EventType,
    payload: row.payload,
    actorId: row.actor_id,
    actorType: row.actor_type as AuthorType | null,
    createdAt: row.created_at,
  }
}

function parseAgentSessionRerunContext(value: unknown): AgentSessionRerunContext | null {
  if (!value || typeof value !== "object") return null
  const ctx = value as Record<string, unknown>
  if (ctx.cause !== "invoking_message_edited" && ctx.cause !== "referenced_message_edited") return null
  if (typeof ctx.editedMessageId !== "string") return null
  return {
    cause: ctx.cause,
    editedMessageId: ctx.editedMessageId,
    editedMessageRevision:
      typeof ctx.editedMessageRevision === "number" && Number.isInteger(ctx.editedMessageRevision)
        ? ctx.editedMessageRevision
        : null,
    editedMessageBefore: typeof ctx.editedMessageBefore === "string" ? ctx.editedMessageBefore : null,
    editedMessageAfter: typeof ctx.editedMessageAfter === "string" ? ctx.editedMessageAfter : null,
  }
}

export const StreamEventRepository = {
  async getNextSequence(db: Querier, streamId: string): Promise<bigint> {
    // Upsert and return next sequence atomically
    const result = await db.query<{ next_sequence: string }>(sql`
      INSERT INTO stream_sequences (stream_id, next_sequence)
      VALUES (${streamId}, 2)
      ON CONFLICT (stream_id) DO UPDATE
        SET next_sequence = stream_sequences.next_sequence + 1
      RETURNING next_sequence - 1 AS next_sequence
    `)
    return BigInt(result.rows[0].next_sequence)
  },

  async getNextSequences(db: Querier, streamId: string, count: number): Promise<bigint[]> {
    if (count <= 0) return []
    const result = await db.query<{ start_sequence: string }>(sql`
      INSERT INTO stream_sequences (stream_id, next_sequence)
      VALUES (${streamId}, ${count + 1})
      ON CONFLICT (stream_id) DO UPDATE
        SET next_sequence = stream_sequences.next_sequence + ${count}
      RETURNING next_sequence - ${count} AS start_sequence
    `)
    const start = BigInt(result.rows[0].start_sequence)
    return Array.from({ length: count }, (_, i) => start + BigInt(i))
  },

  async insert(db: Querier, params: InsertEventParams): Promise<StreamEvent> {
    const sequence = await this.getNextSequence(db, params.streamId)

    const result = await db.query<StreamEventRow>(sql`
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

  async insertMany(db: Querier, paramsList: InsertEventParams[]): Promise<StreamEvent[]> {
    if (paramsList.length === 0) return []
    const streamId = paramsList[0].streamId
    const sequences = await this.getNextSequences(db, streamId, paramsList.length)

    const ids = paramsList.map((p) => p.id)
    const streamIds = paramsList.map(() => streamId)
    const seqs = sequences.map((s) => s.toString())
    const eventTypes = paramsList.map((p) => p.eventType)
    const payloads = paramsList.map((p) => JSON.stringify(p.payload))
    const actorIds = paramsList.map((p) => p.actorId ?? null)
    const actorTypes = paramsList.map((p) => p.actorType ?? null)

    const result = await db.query<StreamEventRow>(
      `INSERT INTO stream_events (id, stream_id, sequence, event_type, payload, actor_id, actor_type)
       SELECT * FROM unnest($1::text[], $2::text[], $3::bigint[], $4::text[], $5::jsonb[], $6::text[], $7::text[])
       RETURNING id, stream_id, sequence, event_type, payload, actor_id, actor_type, created_at`,
      [ids, streamIds, seqs, eventTypes, payloads, actorIds, actorTypes]
    )
    return result.rows.map(mapRowToEvent)
  },

  async list(
    db: Querier,
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

    const result = await db.query<StreamEventRow>(query, params)
    const events = result.rows.map(mapRowToEvent)

    // When fetching most recent (DESC), reverse to return in chronological order
    return afterSequence !== undefined ? events : events.reverse()
  },

  async findById(db: Querier, id: string): Promise<StreamEvent | null> {
    const result = await db.query<StreamEventRow>(sql`
      SELECT id, stream_id, sequence, event_type, payload, actor_id, actor_type, created_at
      FROM stream_events
      WHERE id = ${id}
    `)
    return result.rows[0] ? mapRowToEvent(result.rows[0]) : null
  },

  async getLatestSequence(db: Querier, streamId: string): Promise<bigint | null> {
    const result = await db.query<{ sequence: string }>(sql`
      SELECT sequence FROM stream_events
      WHERE stream_id = ${streamId}
      ORDER BY sequence DESC
      LIMIT 1
    `)
    return result.rows[0] ? BigInt(result.rows[0].sequence) : null
  },

  /**
   * Get the latest sequence number for member messages only.
   * Used to check if new member messages arrived while excluding persona responses.
   */
  async getLatestMemberMessageSequence(db: Querier, streamId: string): Promise<bigint | null> {
    const result = await db.query<{ sequence: string }>(sql`
      SELECT sequence FROM stream_events
      WHERE stream_id = ${streamId}
        AND event_type = 'message_created'
        AND actor_type = 'member'
      ORDER BY sequence DESC
      LIMIT 1
    `)
    return result.rows[0] ? BigInt(result.rows[0].sequence) : null
  },

  /**
   * List message IDs emitted by a specific agent session.
   * Uses message_created event payload.sessionId to include messages sent before
   * session completion (when agent_sessions.sent_message_ids may still be empty).
   */
  async listMessageIdsBySession(db: Querier, streamId: string, sessionId: string): Promise<string[]> {
    const result = await db.query<{ message_id: string }>(sql`
      SELECT payload->>'messageId' AS message_id
      FROM stream_events
      WHERE stream_id = ${streamId}
        AND event_type = 'message_created'
        AND payload->>'sessionId' = ${sessionId}
        AND payload->>'messageId' IS NOT NULL
      ORDER BY sequence ASC
    `)
    return result.rows.map((row) => row.message_id)
  },

  async listRerunContextBySessionIds(
    db: Querier,
    streamId: string,
    sessionIds: string[]
  ): Promise<Map<string, AgentSessionRerunContext>> {
    if (sessionIds.length === 0) return new Map()

    const result = await db.query<AgentSessionRerunContextRow>(sql`
      SELECT
        payload->>'sessionId' AS session_id,
        payload->'rerunContext' AS rerun_context
      FROM stream_events
      WHERE stream_id = ${streamId}
        AND event_type = 'agent_session:started'
        AND payload->>'sessionId' = ANY(${sessionIds}::text[])
    `)

    const map = new Map<string, AgentSessionRerunContext>()
    for (const row of result.rows) {
      const rerunContext = parseAgentSessionRerunContext(row.rerun_context)
      if (!rerunContext) continue
      map.set(row.session_id, rerunContext)
    }
    return map
  },

  /**
   * Count message_created events for multiple streams.
   * Returns a map of streamId -> message count
   */
  async countMessagesByStreamBatch(db: Querier, streamIds: string[]): Promise<Map<string, number>> {
    if (streamIds.length === 0) return new Map()

    const result = await db.query<{ stream_id: string; count: string }>(sql`
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
    db: Querier,
    memberships: Array<{ streamId: string; lastReadEventId: string | null }>
  ): Promise<Map<string, number>> {
    if (memberships.length === 0) return new Map()

    const streamIds = memberships.map((m) => m.streamId)
    const lastReadEventIds = memberships.map((m) => m.lastReadEventId)

    const result = await db.query<{ stream_id: string; unread_count: string }>(
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
  async getLatestEventIdByStreamBatch(db: Querier, streamIds: string[]): Promise<Map<string, string>> {
    if (streamIds.length === 0) return new Map()

    const result = await db.query<{ stream_id: string; latest_event_id: string }>(sql`
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
