import { PoolClient } from "pg"
import { sql } from "../db"

// Internal row type (snake_case, not exported)
interface StreamMemberRow {
  stream_id: string
  user_id: string
  pinned: boolean
  pinned_at: Date | null
  muted: boolean
  last_read_event_id: string | null
  last_read_at: Date | null
  joined_at: Date
}

// Domain type (camelCase, exported)
export interface StreamMember {
  streamId: string
  userId: string
  pinned: boolean
  pinnedAt: Date | null
  muted: boolean
  lastReadEventId: string | null
  lastReadAt: Date | null
  joinedAt: Date
}

export interface UpdateStreamMemberParams {
  pinned?: boolean
  muted?: boolean
  lastReadEventId?: string
}

function mapRowToMember(row: StreamMemberRow): StreamMember {
  return {
    streamId: row.stream_id,
    userId: row.user_id,
    pinned: row.pinned,
    pinnedAt: row.pinned_at,
    muted: row.muted,
    lastReadEventId: row.last_read_event_id,
    lastReadAt: row.last_read_at,
    joinedAt: row.joined_at,
  }
}

export const StreamMemberRepository = {
  async findByStreamAndUser(
    client: PoolClient,
    streamId: string,
    userId: string,
  ): Promise<StreamMember | null> {
    const result = await client.query<StreamMemberRow>(sql`
      SELECT stream_id, user_id, pinned, pinned_at, muted,
             last_read_event_id, last_read_at, joined_at
      FROM stream_members
      WHERE stream_id = ${streamId} AND user_id = ${userId}
    `)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },

  async findByUser(client: PoolClient, userId: string): Promise<StreamMember[]> {
    const result = await client.query<StreamMemberRow>(sql`
      SELECT stream_id, user_id, pinned, pinned_at, muted,
             last_read_event_id, last_read_at, joined_at
      FROM stream_members
      WHERE user_id = ${userId}
      ORDER BY pinned DESC, pinned_at DESC NULLS LAST, joined_at DESC
    `)
    return result.rows.map(mapRowToMember)
  },

  async findByStream(client: PoolClient, streamId: string): Promise<StreamMember[]> {
    const result = await client.query<StreamMemberRow>(sql`
      SELECT stream_id, user_id, pinned, pinned_at, muted,
             last_read_event_id, last_read_at, joined_at
      FROM stream_members
      WHERE stream_id = ${streamId}
      ORDER BY joined_at
    `)
    return result.rows.map(mapRowToMember)
  },

  async insert(
    client: PoolClient,
    streamId: string,
    userId: string,
  ): Promise<StreamMember> {
    const result = await client.query<StreamMemberRow>(sql`
      INSERT INTO stream_members (stream_id, user_id)
      VALUES (${streamId}, ${userId})
      ON CONFLICT (stream_id, user_id) DO NOTHING
      RETURNING stream_id, user_id, pinned, pinned_at, muted,
                last_read_event_id, last_read_at, joined_at
    `)
    // If conflict, fetch existing
    if (result.rows.length === 0) {
      const existing = await this.findByStreamAndUser(client, streamId, userId)
      if (!existing) throw new Error("Failed to insert or find stream member")
      return existing
    }
    return mapRowToMember(result.rows[0])
  },

  async update(
    client: PoolClient,
    streamId: string,
    userId: string,
    params: UpdateStreamMemberParams,
  ): Promise<StreamMember | null> {
    const sets: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (params.pinned !== undefined) {
      sets.push(`pinned = $${paramIndex++}`)
      values.push(params.pinned)
      if (params.pinned) {
        sets.push(`pinned_at = NOW()`)
      } else {
        sets.push(`pinned_at = NULL`)
      }
    }
    if (params.muted !== undefined) {
      sets.push(`muted = $${paramIndex++}`)
      values.push(params.muted)
    }
    if (params.lastReadEventId !== undefined) {
      sets.push(`last_read_event_id = $${paramIndex++}`)
      values.push(params.lastReadEventId)
      sets.push(`last_read_at = NOW()`)
    }

    if (sets.length === 0) return this.findByStreamAndUser(client, streamId, userId)

    values.push(streamId, userId)

    const query = `
      UPDATE stream_members SET ${sets.join(", ")}
      WHERE stream_id = $${paramIndex++} AND user_id = $${paramIndex}
      RETURNING stream_id, user_id, pinned, pinned_at, muted,
                last_read_event_id, last_read_at, joined_at
    `
    const result = await client.query<StreamMemberRow>(query, values)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },

  async delete(client: PoolClient, streamId: string, userId: string): Promise<boolean> {
    const result = await client.query(sql`
      DELETE FROM stream_members
      WHERE stream_id = ${streamId} AND user_id = ${userId}
    `)
    return result.rowCount !== null && result.rowCount > 0
  },

  async isMember(
    client: PoolClient,
    streamId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await client.query(sql`
      SELECT 1 FROM stream_members
      WHERE stream_id = ${streamId} AND user_id = ${userId}
    `)
    return result.rows.length > 0
  },
}
