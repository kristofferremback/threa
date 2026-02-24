import type { Querier } from "@threa/backend-common"

export interface WorkspaceRegistryRow {
  id: string
  name: string
  slug: string
  region: string
  created_by_workos_user_id: string
  created_at: Date
  updated_at: Date
}

export interface WorkspaceMembershipRow {
  workspace_id: string
  workos_user_id: string
  joined_at: Date
}

export const WorkspaceRegistryRepository = {
  async listByUser(db: Querier, workosUserId: string): Promise<WorkspaceRegistryRow[]> {
    const result = await db.query<WorkspaceRegistryRow>(
      `SELECT wr.id, wr.name, wr.slug, wr.region, wr.created_by_workos_user_id, wr.created_at, wr.updated_at
       FROM workspace_registry wr
       JOIN workspace_memberships wm ON wm.workspace_id = wr.id
       WHERE wm.workos_user_id = $1
       ORDER BY wr.created_at DESC`,
      [workosUserId]
    )
    return result.rows
  },

  async getRegion(db: Querier, workspaceId: string): Promise<string | null> {
    const result = await db.query<{ region: string }>("SELECT region FROM workspace_registry WHERE id = $1", [
      workspaceId,
    ])
    return result.rows[0]?.region ?? null
  },

  async findBySlug(db: Querier, slug: string): Promise<WorkspaceRegistryRow | null> {
    const result = await db.query<WorkspaceRegistryRow>(
      `SELECT id, name, slug, region, created_by_workos_user_id, created_at, updated_at
       FROM workspace_registry WHERE slug = $1`,
      [slug]
    )
    return result.rows[0] ?? null
  },

  async slugExists(db: Querier, slug: string): Promise<boolean> {
    const result = await db.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM workspace_registry WHERE slug = $1) as exists",
      [slug]
    )
    return result.rows[0]?.exists ?? false
  },

  async insert(
    db: Querier,
    workspace: { id: string; name: string; slug: string; region: string; createdByWorkosUserId: string }
  ): Promise<WorkspaceRegistryRow> {
    const result = await db.query<WorkspaceRegistryRow>(
      `INSERT INTO workspace_registry (id, name, slug, region, created_by_workos_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, slug, region, created_by_workos_user_id, created_at, updated_at`,
      [workspace.id, workspace.name, workspace.slug, workspace.region, workspace.createdByWorkosUserId]
    )
    return result.rows[0]
  },

  async deleteById(db: Querier, id: string): Promise<void> {
    await db.query("DELETE FROM workspace_registry WHERE id = $1", [id])
  },

  async insertMembership(db: Querier, workspaceId: string, workosUserId: string): Promise<void> {
    await db.query(
      `INSERT INTO workspace_memberships (workspace_id, workos_user_id)
       VALUES ($1, $2)
       ON CONFLICT (workspace_id, workos_user_id) DO NOTHING`,
      [workspaceId, workosUserId]
    )
  },

  async deleteMembershipsByWorkspace(db: Querier, workspaceId: string): Promise<void> {
    await db.query("DELETE FROM workspace_memberships WHERE workspace_id = $1", [workspaceId])
  },
}
