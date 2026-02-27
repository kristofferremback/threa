import type { Querier } from "../../db"
import { sql } from "../../db"
import { userSessionId } from "../../lib/id"

interface UserSessionRow {
  id: string
  workspace_id: string
  user_id: string
  device_key: string
  last_active_at: Date
  created_at: Date
}

export interface UserSession {
  id: string
  workspaceId: string
  userId: string
  deviceKey: string
  lastActiveAt: Date
  createdAt: Date
}

function mapRowToSession(row: UserSessionRow): UserSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    deviceKey: row.device_key,
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
  }
}

export const UserSessionRepository = {
  async upsert(db: Querier, params: { workspaceId: string; userId: string; deviceKey: string }): Promise<UserSession> {
    const id = userSessionId()
    const result = await db.query<UserSessionRow>(sql`
      INSERT INTO user_sessions (id, workspace_id, user_id, device_key, last_active_at)
      VALUES (${id}, ${params.workspaceId}, ${params.userId}, ${params.deviceKey}, now())
      ON CONFLICT (workspace_id, user_id, device_key)
      DO UPDATE SET last_active_at = now()
      RETURNING *
    `)
    return mapRowToSession(result.rows[0])
  },

  async getActiveSessions(db: Querier, workspaceId: string, userId: string, windowMs: number): Promise<UserSession[]> {
    const result = await db.query<UserSessionRow>(sql`
      SELECT * FROM user_sessions
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND last_active_at > now() - (${windowMs}::text || ' milliseconds')::interval
    `)
    return result.rows.map(mapRowToSession)
  },

  async deleteSession(db: Querier, workspaceId: string, userId: string, deviceKey: string): Promise<void> {
    await db.query(sql`
      DELETE FROM user_sessions
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND device_key = ${deviceKey}
    `)
  },

  async cleanupStale(db: Querier, olderThanMs: number): Promise<number> {
    const result = await db.query(sql`
      DELETE FROM user_sessions
      WHERE last_active_at < now() - (${olderThanMs}::text || ' milliseconds')::interval
    `)
    return result.rowCount ?? 0
  },
}
