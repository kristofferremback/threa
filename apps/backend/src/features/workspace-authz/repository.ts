import {
  permissionsForRole,
  WORKSPACE_USER_ROLES,
  type WorkspacePermissionSlug,
  type WorkspaceRoleSlug,
} from "@threa/types"
import type { Querier } from "../../db"

export interface WorkspaceUserPermissionsRow {
  workspace_id: string
  workos_user_id: string
  role_slugs: string[]
  status: string
  last_event_at: Date
  created_at: Date
  updated_at: Date
}

export interface WorkspaceUserPermissions {
  workspaceId: string
  workosUserId: string
  roleSlugs: string[]
  status: string
  lastEventAt: Date
}

export interface UpsertParams {
  workspaceId: string
  workosUserId: string
  roleSlugs: string[]
  status: string
  lastEventAt: Date
}

const SELECT_FIELDS = `
  workspace_id,
  workos_user_id,
  role_slugs,
  status,
  last_event_at,
  created_at,
  updated_at
`

const KNOWN_ROLE_SLUGS = new Set<string>(WORKSPACE_USER_ROLES)

/**
 * Union the permission set granted by every recognized role on a mirror row.
 * Unknown role slugs are skipped so a WorkOS dashboard role added ahead of a
 * code release degrades gracefully (caller falls through to 403).
 */
export function expandRoleSlugs(roleSlugs: readonly string[]): WorkspacePermissionSlug[] {
  const union = new Set<WorkspacePermissionSlug>()
  for (const slug of roleSlugs) {
    if (!KNOWN_ROLE_SLUGS.has(slug)) continue
    for (const perm of permissionsForRole(slug as WorkspaceRoleSlug)) {
      union.add(perm)
    }
  }
  return [...union]
}

function mapRow(row: WorkspaceUserPermissionsRow): WorkspaceUserPermissions {
  return {
    workspaceId: row.workspace_id,
    workosUserId: row.workos_user_id,
    roleSlugs: row.role_slugs,
    status: row.status,
    lastEventAt: row.last_event_at,
  }
}

export const WorkspaceUserPermissionsRepository = {
  /**
   * Race-safe upsert (INV-20). The `last_event_at < EXCLUDED.last_event_at`
   * guard rejects stale or duplicated fan-out events: we only overwrite when
   * the incoming snapshot is strictly newer. Returns the mapped row when an
   * actual change was applied.
   */
  async upsert(db: Querier, params: UpsertParams): Promise<WorkspaceUserPermissions | null> {
    const result = await db.query<WorkspaceUserPermissionsRow>(
      `INSERT INTO workspace_user_permissions (
         workspace_id,
         workos_user_id,
         role_slugs,
         status,
         last_event_at
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, workos_user_id) DO UPDATE SET
         role_slugs = EXCLUDED.role_slugs,
         status = EXCLUDED.status,
         last_event_at = EXCLUDED.last_event_at,
         updated_at = NOW()
       WHERE workspace_user_permissions.last_event_at < EXCLUDED.last_event_at
       RETURNING ${SELECT_FIELDS}`,
      [params.workspaceId, params.workosUserId, params.roleSlugs, params.status, params.lastEventAt]
    )
    const row = result.rows[0]
    return row ? mapRow(row) : null
  },

  async delete(
    db: Querier,
    params: { workspaceId: string; workosUserId: string; eventCreatedAt: Date }
  ): Promise<boolean> {
    const result = await db.query(
      `DELETE FROM workspace_user_permissions
       WHERE workspace_id = $1
         AND workos_user_id = $2
         AND last_event_at < $3`,
      [params.workspaceId, params.workosUserId, params.eventCreatedAt]
    )
    return (result.rowCount ?? 0) > 0
  },

  async getByWorkspaceAndUser(
    db: Querier,
    workspaceId: string,
    workosUserId: string
  ): Promise<WorkspaceUserPermissions | null> {
    const result = await db.query<WorkspaceUserPermissionsRow>(
      `SELECT ${SELECT_FIELDS}
       FROM workspace_user_permissions
       WHERE workspace_id = $1 AND workos_user_id = $2`,
      [workspaceId, workosUserId]
    )
    const row = result.rows[0]
    return row ? mapRow(row) : null
  },

  async listByWorkspace(db: Querier, workspaceId: string): Promise<WorkspaceUserPermissions[]> {
    const result = await db.query<WorkspaceUserPermissionsRow>(
      `SELECT ${SELECT_FIELDS}
       FROM workspace_user_permissions
       WHERE workspace_id = $1
       ORDER BY created_at ASC`,
      [workspaceId]
    )
    return result.rows.map(mapRow)
  },
}
