import type { Querier } from "../../db"
import { sql } from "../../db"
import type { NotificationLevel } from "@threa/types"

interface StreamMemberRow {
  stream_id: string
  member_id: string
  pinned: boolean
  pinned_at: Date | null
  notification_level: string | null
  last_read_event_id: string | null
  last_read_at: Date | null
  joined_at: Date
}

export interface StreamMember {
  streamId: string
  memberId: string
  pinned: boolean
  pinnedAt: Date | null
  notificationLevel: NotificationLevel | null
  lastReadEventId: string | null
  lastReadAt: Date | null
  joinedAt: Date
}

export interface UpdateStreamMemberParams {
  pinned?: boolean
  notificationLevel?: NotificationLevel | null
  lastReadEventId?: string
}

function mapRowToMember(row: StreamMemberRow): StreamMember {
  return {
    streamId: row.stream_id,
    memberId: row.member_id,
    pinned: row.pinned,
    pinnedAt: row.pinned_at,
    notificationLevel: row.notification_level as NotificationLevel | null,
    lastReadEventId: row.last_read_event_id,
    lastReadAt: row.last_read_at,
    joinedAt: row.joined_at,
  }
}

export const StreamMemberRepository = {
  async findByStreamAndMember(db: Querier, streamId: string, memberId: string): Promise<StreamMember | null> {
    const result = await db.query<StreamMemberRow>(sql`
      SELECT stream_id, member_id, pinned, pinned_at, notification_level,
             last_read_event_id, last_read_at, joined_at
      FROM stream_members
      WHERE stream_id = ${streamId} AND member_id = ${memberId}
    `)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },

  async findByStreamsAndMember(db: Querier, streamIds: string[], memberId: string): Promise<StreamMember[]> {
    if (streamIds.length === 0) return []

    const result = await db.query<StreamMemberRow>(sql`
      SELECT stream_id, member_id, pinned, pinned_at, notification_level,
             last_read_event_id, last_read_at, joined_at
      FROM stream_members
      WHERE stream_id = ANY(${streamIds}) AND member_id = ${memberId}
    `)
    return result.rows.map(mapRowToMember)
  },

  async list(
    db: Querier,
    filters: { memberId?: string; streamId?: string; streamIds?: string[] }
  ): Promise<StreamMember[]> {
    if (filters.memberId && !filters.streamId && !filters.streamIds) {
      const result = await db.query<StreamMemberRow>(sql`
        SELECT stream_id, member_id, pinned, pinned_at, notification_level,
               last_read_event_id, last_read_at, joined_at
        FROM stream_members
        WHERE member_id = ${filters.memberId}
        ORDER BY pinned DESC, pinned_at DESC NULLS LAST, joined_at DESC
      `)
      return result.rows.map(mapRowToMember)
    }

    if (filters.streamId && !filters.memberId) {
      const result = await db.query<StreamMemberRow>(sql`
        SELECT stream_id, member_id, pinned, pinned_at, notification_level,
               last_read_event_id, last_read_at, joined_at
        FROM stream_members
        WHERE stream_id = ${filters.streamId}
        ORDER BY joined_at
      `)
      return result.rows.map(mapRowToMember)
    }

    if (filters.streamIds && filters.streamIds.length > 0 && !filters.memberId) {
      const result = await db.query<StreamMemberRow>(sql`
        SELECT stream_id, member_id, pinned, pinned_at, notification_level,
               last_read_event_id, last_read_at, joined_at
        FROM stream_members
        WHERE stream_id = ANY(${filters.streamIds})
        ORDER BY joined_at
      `)
      return result.rows.map(mapRowToMember)
    }

    throw new Error("StreamMemberRepository.list requires either memberId, streamId, or streamIds filter")
  },

  async insert(db: Querier, streamId: string, memberId: string): Promise<StreamMember> {
    const result = await db.query<StreamMemberRow>(sql`
      INSERT INTO stream_members (stream_id, member_id)
      VALUES (${streamId}, ${memberId})
      ON CONFLICT (stream_id, member_id) DO NOTHING
      RETURNING stream_id, member_id, pinned, pinned_at, notification_level,
                last_read_event_id, last_read_at, joined_at
    `)
    if (result.rows.length === 0) {
      const existing = await this.findByStreamAndMember(db, streamId, memberId)
      if (!existing) throw new Error("Failed to insert or find stream member")
      return existing
    }
    return mapRowToMember(result.rows[0])
  },

  async update(
    db: Querier,
    streamId: string,
    memberId: string,
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
    if (params.notificationLevel !== undefined) {
      sets.push(`notification_level = $${paramIndex++}`)
      values.push(params.notificationLevel)
    }
    if (params.lastReadEventId !== undefined) {
      sets.push(`last_read_event_id = $${paramIndex++}`)
      values.push(params.lastReadEventId)
      sets.push(`last_read_at = NOW()`)
    }

    if (sets.length === 0) return this.findByStreamAndMember(db, streamId, memberId)

    values.push(streamId, memberId)

    const query = `
      UPDATE stream_members SET ${sets.join(", ")}
      WHERE stream_id = $${paramIndex++} AND member_id = $${paramIndex}
      RETURNING stream_id, member_id, pinned, pinned_at, notification_level,
                last_read_event_id, last_read_at, joined_at
    `
    const result = await db.query<StreamMemberRow>(query, values)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },

  async delete(db: Querier, streamId: string, memberId: string): Promise<boolean> {
    const result = await db.query(sql`
      DELETE FROM stream_members
      WHERE stream_id = ${streamId} AND member_id = ${memberId}
    `)
    return result.rowCount !== null && result.rowCount > 0
  },

  async countByStreamForUpdate(db: Querier, streamId: string): Promise<number> {
    const result = await db.query<{ count: string }>(sql`
      SELECT COUNT(*) FROM stream_members WHERE stream_id = ${streamId} FOR UPDATE
    `)
    return parseInt(result.rows[0].count, 10)
  },

  async isMember(db: Querier, streamId: string, memberId: string): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1 FROM stream_members
      WHERE stream_id = ${streamId} AND member_id = ${memberId}
    `)
    return result.rows.length > 0
  },

  async filterMemberIds(db: Querier, streamId: string, memberIds: string[]): Promise<Set<string>> {
    if (memberIds.length === 0) return new Set()
    const result = await db.query<{ member_id: string }>(sql`
      SELECT member_id FROM stream_members
      WHERE stream_id = ${streamId} AND member_id = ANY(${memberIds})
    `)
    return new Set(result.rows.map((r) => r.member_id))
  },

  async batchUpdateLastReadEventId(db: Querier, memberId: string, updates: Map<string, string>): Promise<void> {
    if (updates.size === 0) return

    const streamIds = Array.from(updates.keys())
    const eventIds = Array.from(updates.values())

    await db.query(
      `
      UPDATE stream_members sm
      SET last_read_event_id = u.event_id, last_read_at = NOW()
      FROM (SELECT unnest($1::text[]) as stream_id, unnest($2::text[]) as event_id) u
      WHERE sm.stream_id = u.stream_id AND sm.member_id = $3
      `,
      [streamIds, eventIds, memberId]
    )
  },

  async filterStreamsWithAllMembers(db: Querier, streamIds: string[], memberIds: string[]): Promise<Set<string>> {
    if (streamIds.length === 0 || memberIds.length === 0) {
      return new Set(streamIds)
    }

    const result = await db.query<{ stream_id: string }>(sql`
      SELECT stream_id
      FROM stream_members
      WHERE stream_id = ANY(${streamIds})
        AND member_id = ANY(${memberIds})
      GROUP BY stream_id
      HAVING COUNT(DISTINCT member_id) = ${memberIds.length}
    `)

    return new Set(result.rows.map((r) => r.stream_id))
  },

  async deleteByMemberInDescendants(db: Querier, memberId: string, ancestorStreamId: string): Promise<string[]> {
    const result = await db.query<{ stream_id: string }>(
      `WITH RECURSIVE descendants AS (
        SELECT id FROM streams WHERE parent_stream_id = $2
        UNION ALL
        SELECT s.id FROM streams s JOIN descendants d ON s.parent_stream_id = d.id
      )
      DELETE FROM stream_members
      WHERE member_id = $1 AND stream_id IN (SELECT id FROM descendants)
      RETURNING stream_id`,
      [memberId, ancestorStreamId]
    )
    return result.rows.map((r) => r.stream_id)
  },
}
