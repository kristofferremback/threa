import type { PoolClient } from "pg"
import { sql } from "../lib/db"

/**
 * Raw database row for stream_members table.
 */
export interface StreamMemberRow {
  stream_id: string
  user_id: string
  role: string
  notify_level: string
  last_read_event_id: string | null
  last_read_at: Date
  added_by_user_id: string | null
  joined_at: Date
  left_at: Date | null
  updated_at: Date
  pinned_at: Date | null
}

/**
 * Stream member with user info from joined tables.
 */
export interface StreamMemberWithUserRow extends StreamMemberRow {
  email: string
  name: string
}

/**
 * Parameters for inserting a member.
 */
export interface InsertMemberParams {
  streamId: string
  userId: string
  role?: string
  addedByUserId?: string | null
  notifyLevel?: string
}

/**
 * Parameters for upserting a member.
 */
export interface UpsertMemberParams {
  streamId: string
  userId: string
  role?: string
  addedByUserId?: string | null
}

/**
 * Parameters for upserting a member with read cursor.
 */
export interface UpsertMemberWithReadCursorParams {
  streamId: string
  userId: string
  lastReadEventId: string
}

/**
 * Repository for stream_members table operations.
 *
 * Design principles:
 * - Accepts PoolClient as first parameter (enables transaction control from service)
 * - Returns raw database rows (services handle mapping)
 * - No side effects (no outbox events, no external calls)
 * - Uses explicit field selection (no SELECT *)
 */
export const StreamMemberRepository = {
  /**
   * Find a user's membership in a stream.
   */
  async findMembershipByStreamAndUser(
    client: PoolClient,
    streamId: string,
    userId: string,
  ): Promise<StreamMemberRow | null> {
    const result = await client.query<StreamMemberRow>(
      sql`SELECT
            stream_id, user_id, role, notify_level, last_read_event_id, last_read_at,
            added_by_user_id, joined_at, left_at, updated_at, pinned_at
          FROM stream_members
          WHERE stream_id = ${streamId} AND user_id = ${userId}`,
    )
    return result.rows[0] ?? null
  },

  /**
   * Insert a new member into a stream.
   */
  async insertMember(client: PoolClient, params: InsertMemberParams): Promise<void> {
    await client.query(
      sql`INSERT INTO stream_members (stream_id, user_id, role, added_by_user_id, notify_level)
          VALUES (
            ${params.streamId}, ${params.userId},
            ${params.role ?? "member"}, ${params.addedByUserId ?? null},
            ${params.notifyLevel ?? "default"}
          )`,
    )
  },

  /**
   * Add or reactivate a member.
   * If member already exists, clears left_at and updates role.
   */
  async upsertMember(client: PoolClient, params: UpsertMemberParams): Promise<void> {
    await client.query(
      sql`INSERT INTO stream_members (stream_id, user_id, role, added_by_user_id)
          VALUES (${params.streamId}, ${params.userId}, ${params.role ?? "member"}, ${params.addedByUserId ?? null})
          ON CONFLICT (stream_id, user_id) DO UPDATE SET
            left_at = NULL,
            role = EXCLUDED.role,
            updated_at = NOW()`,
    )
  },

  /**
   * Add/update member and set read cursor.
   */
  async upsertMemberWithReadCursor(
    client: PoolClient,
    params: UpsertMemberWithReadCursorParams,
  ): Promise<void> {
    await client.query(
      sql`INSERT INTO stream_members (stream_id, user_id, last_read_event_id, last_read_at)
          VALUES (${params.streamId}, ${params.userId}, ${params.lastReadEventId}, NOW())
          ON CONFLICT (stream_id, user_id) DO UPDATE SET
            last_read_event_id = EXCLUDED.last_read_event_id,
            last_read_at = NOW()`,
    )
  },

  /**
   * Soft-remove a member by setting left_at.
   */
  async removeMember(client: PoolClient, streamId: string, userId: string): Promise<void> {
    await client.query(
      sql`UPDATE stream_members SET left_at = NOW(), updated_at = NOW()
          WHERE stream_id = ${streamId} AND user_id = ${userId}`,
    )
  },

  /**
   * Copy all active members from parent stream to a new stream.
   * Used when creating threads to inherit membership.
   */
  async copyParentMembership(
    client: PoolClient,
    parentStreamId: string,
    newStreamId: string,
  ): Promise<void> {
    await client.query(
      sql`INSERT INTO stream_members (stream_id, user_id, role, notify_level)
          SELECT ${newStreamId}, user_id, 'member', notify_level
          FROM stream_members
          WHERE stream_id = ${parentStreamId} AND left_at IS NULL`,
    )
  },

  /**
   * Update a user's read cursor position.
   */
  async updateReadCursor(
    client: PoolClient,
    streamId: string,
    userId: string,
    eventId: string,
  ): Promise<void> {
    await client.query(
      sql`UPDATE stream_members SET
            last_read_event_id = ${eventId},
            last_read_at = NOW(),
            updated_at = NOW()
          WHERE stream_id = ${streamId} AND user_id = ${userId}`,
    )
  },

  /**
   * Get a user's last read event ID.
   */
  async getReadCursor(
    client: PoolClient,
    streamId: string,
    userId: string,
  ): Promise<string | null> {
    const result = await client.query<{ last_read_event_id: string | null }>(
      sql`SELECT last_read_event_id
          FROM stream_members
          WHERE stream_id = ${streamId} AND user_id = ${userId}`,
    )
    return result.rows[0]?.last_read_event_id ?? null
  },

  /**
   * Find all active members of a stream with user info.
   */
  async findStreamMembers(
    client: PoolClient,
    streamId: string,
  ): Promise<StreamMemberWithUserRow[]> {
    const result = await client.query<StreamMemberWithUserRow>(
      sql`SELECT
            sm.stream_id, sm.user_id, sm.role, sm.notify_level, sm.last_read_event_id,
            sm.last_read_at, sm.added_by_user_id, sm.joined_at, sm.left_at,
            sm.updated_at, sm.pinned_at,
            u.email, u.name
          FROM stream_members sm
          INNER JOIN users u ON sm.user_id = u.id
          WHERE sm.stream_id = ${streamId} AND sm.left_at IS NULL
          ORDER BY sm.joined_at`,
    )
    return result.rows
  },

  /**
   * Pin a stream for a user.
   */
  async pinStream(client: PoolClient, streamId: string, userId: string): Promise<void> {
    await client.query(
      sql`UPDATE stream_members SET pinned_at = NOW(), updated_at = NOW()
          WHERE stream_id = ${streamId} AND user_id = ${userId}`,
    )
  },

  /**
   * Unpin a stream for a user.
   */
  async unpinStream(client: PoolClient, streamId: string, userId: string): Promise<void> {
    await client.query(
      sql`UPDATE stream_members SET pinned_at = NULL, updated_at = NOW()
          WHERE stream_id = ${streamId} AND user_id = ${userId}`,
    )
  },
}
