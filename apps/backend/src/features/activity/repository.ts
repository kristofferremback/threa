import type { Querier } from "../../db"
import { sql } from "../../db"
import { activityId } from "../../lib/id"

interface ActivityRow {
  id: string
  workspace_id: string
  member_id: string
  activity_type: string
  stream_id: string
  message_id: string
  actor_id: string
  actor_type: string
  context: Record<string, unknown>
  read_at: Date | null
  created_at: Date
}

export interface Activity {
  id: string
  workspaceId: string
  memberId: string
  activityType: string
  streamId: string
  messageId: string
  actorId: string
  actorType: string
  context: Record<string, unknown>
  readAt: Date | null
  createdAt: Date
}

export interface InsertActivityParams {
  workspaceId: string
  memberId: string
  activityType: string
  streamId: string
  messageId: string
  actorId: string
  actorType: string
  context?: Record<string, unknown>
}

export interface InsertActivityBatchParams {
  workspaceId: string
  memberIds: string[]
  activityType: string
  streamId: string
  messageId: string
  actorId: string
  actorType: string
  context?: Record<string, unknown>
}

function mapRowToActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    activityType: row.activity_type,
    streamId: row.stream_id,
    messageId: row.message_id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    context: row.context,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

export const ActivityRepository = {
  async insert(db: Querier, params: InsertActivityParams): Promise<Activity | null> {
    const id = activityId()
    const result = await db.query<ActivityRow>(sql`
      INSERT INTO member_activity (id, workspace_id, member_id, activity_type, stream_id, message_id, actor_id, actor_type, context)
      VALUES (
        ${id},
        ${params.workspaceId},
        ${params.memberId},
        ${params.activityType},
        ${params.streamId},
        ${params.messageId},
        ${params.actorId},
        ${params.actorType},
        ${JSON.stringify(params.context ?? {})}
      )
      ON CONFLICT (member_id, message_id, activity_type, actor_id) DO NOTHING
      RETURNING id, workspace_id, member_id, activity_type, stream_id, message_id, actor_id, actor_type, context, read_at, created_at
    `)
    return result.rows[0] ? mapRowToActivity(result.rows[0]) : null
  },

  /**
   * Batch insert activities for multiple members sharing the same message context.
   * Single UNNEST query replaces N sequential inserts. ON CONFLICT deduplicates.
   */
  async insertBatch(db: Querier, params: InsertActivityBatchParams): Promise<Activity[]> {
    if (params.memberIds.length === 0) return []

    const ids = params.memberIds.map(() => activityId())
    const contextJson = JSON.stringify(params.context ?? {})

    const result = await db.query<ActivityRow>(sql`
      INSERT INTO member_activity (id, workspace_id, member_id, activity_type, stream_id, message_id, actor_id, actor_type, context)
      SELECT * FROM UNNEST(
        ${ids}::text[],
        ${params.memberIds.map(() => params.workspaceId)}::text[],
        ${params.memberIds}::text[],
        ${params.memberIds.map(() => params.activityType)}::text[],
        ${params.memberIds.map(() => params.streamId)}::text[],
        ${params.memberIds.map(() => params.messageId)}::text[],
        ${params.memberIds.map(() => params.actorId)}::text[],
        ${params.memberIds.map(() => params.actorType)}::text[],
        ${params.memberIds.map(() => contextJson)}::jsonb[]
      )
      ON CONFLICT (member_id, message_id, activity_type, actor_id) DO NOTHING
      RETURNING id, workspace_id, member_id, activity_type, stream_id, message_id, actor_id, actor_type, context, read_at, created_at
    `)
    return result.rows.map(mapRowToActivity)
  },

  async listByMember(
    db: Querier,
    memberId: string,
    workspaceId: string,
    opts?: { limit?: number; cursor?: string; unreadOnly?: boolean }
  ): Promise<Activity[]> {
    const limit = opts?.limit ?? 50
    const hasCursor = opts?.cursor !== undefined
    const cursor = opts?.cursor ?? ""
    const unreadOnly = opts?.unreadOnly ?? false

    const result = await db.query<ActivityRow>(sql`
      SELECT id, workspace_id, member_id, activity_type, stream_id, message_id, actor_id, actor_type, context, read_at, created_at
      FROM member_activity
      WHERE member_id = ${memberId}
        AND workspace_id = ${workspaceId}
        AND (${!unreadOnly} OR read_at IS NULL)
        AND (${!hasCursor} OR created_at < (
          SELECT created_at FROM member_activity
          WHERE id = ${cursor} AND member_id = ${memberId} AND workspace_id = ${workspaceId}
        ))
      ORDER BY created_at DESC
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToActivity)
  },

  async countUnreadMentionsByStream(db: Querier, memberId: string, workspaceId: string): Promise<Map<string, number>> {
    const result = await db.query<{ stream_id: string; count: string }>(sql`
      SELECT stream_id, COUNT(*)::text AS count
      FROM member_activity
      WHERE member_id = ${memberId}
        AND workspace_id = ${workspaceId}
        AND activity_type = 'mention'
        AND read_at IS NULL
      GROUP BY stream_id
    `)
    const map = new Map<string, number>()
    for (const row of result.rows) {
      map.set(row.stream_id, Number(row.count))
    }
    return map
  },

  async countUnread(db: Querier, memberId: string, workspaceId: string): Promise<number> {
    const result = await db.query<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM member_activity
      WHERE member_id = ${memberId}
        AND workspace_id = ${workspaceId}
        AND read_at IS NULL
    `)
    return Number(result.rows[0].count)
  },

  async markAsRead(db: Querier, activityId: string, memberId: string): Promise<void> {
    await db.query(sql`
      UPDATE member_activity
      SET read_at = NOW()
      WHERE id = ${activityId}
        AND member_id = ${memberId}
        AND read_at IS NULL
    `)
  },

  async markStreamAsRead(db: Querier, memberId: string, streamId: string): Promise<number> {
    const result = await db.query(sql`
      UPDATE member_activity
      SET read_at = NOW()
      WHERE member_id = ${memberId}
        AND stream_id = ${streamId}
        AND read_at IS NULL
    `)
    return result.rowCount ?? 0
  },

  async markAllAsRead(db: Querier, memberId: string, workspaceId: string): Promise<number> {
    const result = await db.query(sql`
      UPDATE member_activity
      SET read_at = NOW()
      WHERE member_id = ${memberId}
        AND workspace_id = ${workspaceId}
        AND read_at IS NULL
    `)
    return result.rowCount ?? 0
  },
}
