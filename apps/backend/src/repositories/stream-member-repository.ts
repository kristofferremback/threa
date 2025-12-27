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
  async findByStreamAndUser(client: PoolClient, streamId: string, userId: string): Promise<StreamMember | null> {
    const result = await client.query<StreamMemberRow>(sql`
      SELECT stream_id, user_id, pinned, pinned_at, muted,
             last_read_event_id, last_read_at, joined_at
      FROM stream_members
      WHERE stream_id = ${streamId} AND user_id = ${userId}
    `)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },

  async findByStreamsAndUser(client: PoolClient, streamIds: string[], userId: string): Promise<StreamMember[]> {
    if (streamIds.length === 0) return []

    const result = await client.query<StreamMemberRow>(sql`
      SELECT stream_id, user_id, pinned, pinned_at, muted,
             last_read_event_id, last_read_at, joined_at
      FROM stream_members
      WHERE stream_id = ANY(${streamIds}) AND user_id = ${userId}
    `)
    return result.rows.map(mapRowToMember)
  },

  async list(client: PoolClient, filters: { userId?: string; streamId?: string }): Promise<StreamMember[]> {
    if (filters.userId && !filters.streamId) {
      const result = await client.query<StreamMemberRow>(sql`
        SELECT stream_id, user_id, pinned, pinned_at, muted,
               last_read_event_id, last_read_at, joined_at
        FROM stream_members
        WHERE user_id = ${filters.userId}
        ORDER BY pinned DESC, pinned_at DESC NULLS LAST, joined_at DESC
      `)
      return result.rows.map(mapRowToMember)
    }

    if (filters.streamId && !filters.userId) {
      const result = await client.query<StreamMemberRow>(sql`
        SELECT stream_id, user_id, pinned, pinned_at, muted,
               last_read_event_id, last_read_at, joined_at
        FROM stream_members
        WHERE stream_id = ${filters.streamId}
        ORDER BY joined_at
      `)
      return result.rows.map(mapRowToMember)
    }

    throw new Error("StreamMemberRepository.list requires either userId or streamId filter")
  },

  async insert(client: PoolClient, streamId: string, userId: string): Promise<StreamMember> {
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
    params: UpdateStreamMemberParams
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

  async isMember(client: PoolClient, streamId: string, userId: string): Promise<boolean> {
    const result = await client.query(sql`
      SELECT 1 FROM stream_members
      WHERE stream_id = ${streamId} AND user_id = ${userId}
    `)
    return result.rows.length > 0
  },

  /**
   * Batch update lastReadEventId for multiple streams for a single user.
   * Uses a single UPDATE query with unnest for efficiency.
   */
  async batchUpdateLastReadEventId(client: PoolClient, userId: string, updates: Map<string, string>): Promise<void> {
    if (updates.size === 0) return

    const streamIds = Array.from(updates.keys())
    const eventIds = Array.from(updates.values())

    await client.query(
      `
      UPDATE stream_members sm
      SET last_read_event_id = u.event_id, last_read_at = NOW()
      FROM (SELECT unnest($1::text[]) as stream_id, unnest($2::text[]) as event_id) u
      WHERE sm.stream_id = u.stream_id AND sm.user_id = $3
      `,
      [streamIds, eventIds, userId]
    )
  },

  /**
   * Check which streams have ALL of the specified users as members.
   * Returns the set of stream IDs where every user is a member.
   */
  async filterStreamsWithAllUsers(client: PoolClient, streamIds: string[], userIds: string[]): Promise<Set<string>> {
    if (streamIds.length === 0 || userIds.length === 0) {
      return new Set(streamIds)
    }

    const result = await client.query<{ stream_id: string }>(sql`
      SELECT stream_id
      FROM stream_members
      WHERE stream_id = ANY(${streamIds})
        AND user_id = ANY(${userIds})
      GROUP BY stream_id
      HAVING COUNT(DISTINCT user_id) = ${userIds.length}
    `)

    return new Set(result.rows.map((r) => r.stream_id))
  },
}
