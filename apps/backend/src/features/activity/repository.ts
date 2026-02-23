import type { Querier } from "../../db"
import { sql } from "../../db"
import { activityId } from "../../lib/id"

interface ActivityRow {
  id: string
  workspace_id: string
  user_id: string
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
  userId: string
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
  userId: string
  activityType: string
  streamId: string
  messageId: string
  actorId: string
  actorType: string
  context?: Record<string, unknown>
}

export interface InsertActivityBatchParams {
  workspaceId: string
  userIds: string[]
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
    userId: row.user_id,
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
      INSERT INTO user_activity (id, workspace_id, user_id, activity_type, stream_id, message_id, actor_id, actor_type, context)
      VALUES (
        ${id},
        ${params.workspaceId},
        ${params.userId},
        ${params.activityType},
        ${params.streamId},
        ${params.messageId},
        ${params.actorId},
        ${params.actorType},
        ${JSON.stringify(params.context ?? {})}
      )
      ON CONFLICT (user_id, message_id, activity_type, actor_id)
      DO UPDATE SET id = user_activity.id
      RETURNING id, workspace_id, user_id, activity_type, stream_id, message_id, actor_id, actor_type, context, read_at, created_at
    `)
    return result.rows[0] ? mapRowToActivity(result.rows[0]) : null
  },

  /**
   * Batch insert activities for multiple users sharing the same message context.
   * Single UNNEST query replaces N sequential inserts. ON CONFLICT deduplicates.
   */
  async insertBatch(db: Querier, params: InsertActivityBatchParams): Promise<Activity[]> {
    if (params.userIds.length === 0) return []

    const ids = params.userIds.map(() => activityId())
    const contextJson = JSON.stringify(params.context ?? {})

    const result = await db.query<ActivityRow>(sql`
      INSERT INTO user_activity (id, workspace_id, user_id, activity_type, stream_id, message_id, actor_id, actor_type, context)
      SELECT * FROM UNNEST(
        ${ids}::text[],
        ${params.userIds.map(() => params.workspaceId)}::text[],
        ${params.userIds}::text[],
        ${params.userIds.map(() => params.activityType)}::text[],
        ${params.userIds.map(() => params.streamId)}::text[],
        ${params.userIds.map(() => params.messageId)}::text[],
        ${params.userIds.map(() => params.actorId)}::text[],
        ${params.userIds.map(() => params.actorType)}::text[],
        ${params.userIds.map(() => contextJson)}::jsonb[]
      )
      ON CONFLICT (user_id, message_id, activity_type, actor_id)
      DO UPDATE SET id = user_activity.id
      RETURNING id, workspace_id, user_id, activity_type, stream_id, message_id, actor_id, actor_type, context, read_at, created_at
    `)
    return result.rows.map(mapRowToActivity)
  },

  async listByUser(
    db: Querier,
    userId: string,
    workspaceId: string,
    opts?: { limit?: number; cursor?: string; unreadOnly?: boolean }
  ): Promise<Activity[]> {
    const limit = opts?.limit ?? 50
    const hasCursor = opts?.cursor !== undefined
    const cursor = opts?.cursor ?? ""
    const unreadOnly = opts?.unreadOnly ?? false

    const result = await db.query<ActivityRow>(sql`
      SELECT id, workspace_id, user_id, activity_type, stream_id, message_id, actor_id, actor_type, context, read_at, created_at
      FROM user_activity
      WHERE user_id = ${userId}
        AND workspace_id = ${workspaceId}
        AND (${!unreadOnly} OR read_at IS NULL)
        AND (${!hasCursor} OR created_at < (
          SELECT created_at FROM user_activity
          WHERE id = ${cursor} AND user_id = ${userId} AND workspace_id = ${workspaceId}
        ))
      ORDER BY created_at DESC
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToActivity)
  },

  /**
   * Single-scan aggregation: per-stream mention counts, per-stream total counts,
   * and workspace-wide total — all from one GROUP BY with FILTER.
   */
  async countUnreadGrouped(
    db: Querier,
    userId: string,
    workspaceId: string
  ): Promise<{ mentionsByStream: Map<string, number>; totalByStream: Map<string, number>; total: number }> {
    const result = await db.query<{ stream_id: string; mention_count: string; total_count: string }>(sql`
      SELECT
        stream_id,
        COUNT(*) FILTER (WHERE activity_type = 'mention')::text AS mention_count,
        COUNT(*)::text AS total_count
      FROM user_activity
      WHERE user_id = ${userId}
        AND workspace_id = ${workspaceId}
        AND read_at IS NULL
      GROUP BY stream_id
    `)
    const mentionsByStream = new Map<string, number>()
    const totalByStream = new Map<string, number>()
    let total = 0
    for (const row of result.rows) {
      const mentions = Number(row.mention_count)
      const count = Number(row.total_count)
      if (mentions > 0) mentionsByStream.set(row.stream_id, mentions)
      totalByStream.set(row.stream_id, count)
      total += count
    }
    return { mentionsByStream, totalByStream, total }
  },

  async markAsRead(db: Querier, activityId: string, userId: string): Promise<void> {
    await db.query(sql`
      UPDATE user_activity
      SET read_at = NOW()
      WHERE id = ${activityId}
        AND user_id = ${userId}
        AND read_at IS NULL
    `)
  },

  async markStreamAsRead(db: Querier, userId: string, streamId: string): Promise<number> {
    const result = await db.query(sql`
      UPDATE user_activity
      SET read_at = NOW()
      WHERE user_id = ${userId}
        AND stream_id = ${streamId}
        AND read_at IS NULL
    `)
    return result.rowCount ?? 0
  },

  async markAllAsRead(db: Querier, userId: string, workspaceId: string): Promise<number> {
    const result = await db.query(sql`
      UPDATE user_activity
      SET read_at = NOW()
      WHERE user_id = ${userId}
        AND workspace_id = ${workspaceId}
        AND read_at IS NULL
    `)
    return result.rowCount ?? 0
  },
}
