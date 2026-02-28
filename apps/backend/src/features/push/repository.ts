import type { Querier } from "../../db"
import { sql } from "../../db"
import { pushSubscriptionId } from "../../lib/id"

interface PushSubscriptionRow {
  id: string
  workspace_id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  device_key: string
  user_agent: string | null
  created_at: Date
  updated_at: Date
}

export interface PushSubscription {
  id: string
  workspaceId: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  deviceKey: string
  userAgent: string | null
  createdAt: Date
  updatedAt: Date
}

export interface InsertPushSubscriptionParams {
  workspaceId: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  deviceKey: string
  userAgent?: string
}

function mapRowToSubscription(row: PushSubscriptionRow): PushSubscription {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    deviceKey: row.device_key,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const PushSubscriptionRepository = {
  async insert(db: Querier, params: InsertPushSubscriptionParams): Promise<PushSubscription> {
    const id = pushSubscriptionId()
    const result = await db.query<PushSubscriptionRow>(sql`
      INSERT INTO push_subscriptions (id, workspace_id, user_id, endpoint, p256dh, auth, device_key, user_agent)
      VALUES (
        ${id},
        ${params.workspaceId},
        ${params.userId},
        ${params.endpoint},
        ${params.p256dh},
        ${params.auth},
        ${params.deviceKey},
        ${params.userAgent ?? null}
      )
      ON CONFLICT (workspace_id, user_id, endpoint)
      DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        device_key = EXCLUDED.device_key,
        user_agent = EXCLUDED.user_agent,
        updated_at = now()
      RETURNING *
    `)
    return mapRowToSubscription(result.rows[0])
  },

  async deleteByEndpoint(db: Querier, workspaceId: string, userId: string, endpoint: string): Promise<boolean> {
    const result = await db.query(sql`
      DELETE FROM push_subscriptions
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND endpoint = ${endpoint}
    `)
    return (result.rowCount ?? 0) > 0
  },

  async deleteByIds(db: Querier, workspaceId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await db.query(sql`
      DELETE FROM push_subscriptions
      WHERE workspace_id = ${workspaceId} AND id = ANY(${ids})
    `)
  },

  /** Check if a subscription already exists for this user+endpoint (used for cap-safe upserts). */
  async existsByEndpoint(db: Querier, workspaceId: string, userId: string, endpoint: string): Promise<boolean> {
    const result = await db.query<{ exists: boolean }>(sql`
      SELECT EXISTS(
        SELECT 1 FROM push_subscriptions
        WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND endpoint = ${endpoint}
      ) AS exists
    `)
    return result.rows[0].exists
  },

  /** Count user subscriptions with row locks to prevent concurrent cap violations (INV-20). */
  async countByUserForUpdate(db: Querier, workspaceId: string, userId: string): Promise<number> {
    const result = await db.query<{ count: string }>(sql`
      SELECT count(*) AS count FROM push_subscriptions
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
      FOR UPDATE
    `)
    return parseInt(result.rows[0].count, 10)
  },

  async deleteOldestByUser(db: Querier, workspaceId: string, userId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM push_subscriptions
      WHERE id = (
        SELECT id FROM push_subscriptions
        WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
        ORDER BY updated_at ASC
        LIMIT 1
      )
    `)
  },

  async findByUserId(db: Querier, workspaceId: string, userId: string): Promise<PushSubscription[]> {
    const result = await db.query<PushSubscriptionRow>(sql`
      SELECT * FROM push_subscriptions
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
      ORDER BY created_at DESC
    `)
    return result.rows.map(mapRowToSubscription)
  },
}
