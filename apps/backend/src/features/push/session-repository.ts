import type { Querier } from "../../db"
import { sql } from "../../db"
import { userSessionId } from "../../lib/id"

interface UserSessionRow {
  id: string
  workspace_id: string
  user_id: string
  device_key: string
  last_active_at: Date
  last_focused_at: Date | null
  created_at: Date
}

export interface UserSession {
  id: string
  workspaceId: string
  userId: string
  deviceKey: string
  lastActiveAt: Date
  lastFocusedAt: Date | null
  createdAt: Date
}

function mapRowToSession(row: UserSessionRow): UserSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    deviceKey: row.device_key,
    lastActiveAt: row.last_active_at,
    lastFocusedAt: row.last_focused_at,
    createdAt: row.created_at,
  }
}

export const UserSessionRepository = {
  async upsert(
    db: Querier,
    params: { workspaceId: string; userId: string; deviceKey: string; focused?: boolean }
  ): Promise<UserSession> {
    const id = userSessionId()
    const focusedAt = params.focused ? new Date() : null

    const result = await db.query<UserSessionRow>(sql`
      INSERT INTO user_sessions (id, workspace_id, user_id, device_key, last_active_at, last_focused_at)
      VALUES (${id}, ${params.workspaceId}, ${params.userId}, ${params.deviceKey}, now(), ${focusedAt})
      ON CONFLICT (workspace_id, user_id, device_key)
      DO UPDATE SET
        last_active_at = now(),
        last_focused_at = COALESCE(${focusedAt}, user_sessions.last_focused_at)
      RETURNING *
    `)
    return mapRowToSession(result.rows[0])
  },

  /**
   * Batch upsert sessions in a single SQL statement (INV-56).
   * Used by heartbeat handler to avoid N individual upserts per workspace.
   * All entries in a batch share the same focused state (same browser tab).
   */
  async upsertBatch(
    db: Querier,
    entries: Array<{ workspaceId: string; userId: string; deviceKey: string }>,
    focused?: boolean
  ): Promise<void> {
    if (entries.length === 0) return
    if (entries.length === 1) {
      await this.upsert(db, { ...entries[0], focused })
      return
    }

    const ids = entries.map(() => userSessionId())
    const workspaceIds = entries.map((e) => e.workspaceId)
    const userIds = entries.map((e) => e.userId)
    const deviceKeys = entries.map((e) => e.deviceKey)
    const focusedAt = focused ? new Date() : null

    await db.query(sql`
      INSERT INTO user_sessions (id, workspace_id, user_id, device_key, last_active_at, last_focused_at)
      SELECT unnest(${ids}::text[]), unnest(${workspaceIds}::text[]), unnest(${userIds}::text[]), unnest(${deviceKeys}::text[]), now(), ${focusedAt}
      ON CONFLICT (workspace_id, user_id, device_key)
      DO UPDATE SET
        last_active_at = now(),
        last_focused_at = COALESCE(${focusedAt}, user_sessions.last_focused_at)
    `)
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

  /**
   * Check whether a user has had any session activity within the given window.
   * Used to detect expired auth sessions: if no heartbeat has arrived in a long
   * window (e.g. 30 days), the user is likely logged out on all devices.
   */
  async hasAnyRecentSession(db: Querier, workspaceId: string, userId: string, windowMs: number): Promise<boolean> {
    const result = await db.query<{ exists: boolean }>(sql`
      SELECT EXISTS(
        SELECT 1 FROM user_sessions
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${userId}
          AND last_active_at > now() - (${windowMs}::text || ' milliseconds')::interval
      ) AS exists
    `)
    return result.rows[0].exists
  },

  async cleanupStale(db: Querier, olderThanMs: number): Promise<number> {
    const result = await db.query(sql`
      DELETE FROM user_sessions
      WHERE last_active_at < now() - (${olderThanMs}::text || ' milliseconds')::interval
    `)
    return result.rowCount ?? 0
  },
}
