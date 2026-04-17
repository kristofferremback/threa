import type { Querier } from "@threa/backend-common"

export interface PlatformRoleRow {
  workos_user_id: string
  role: string
  created_at: Date
  updated_at: Date
}

const SELECT_FIELDS = "workos_user_id, role, created_at, updated_at"

export const PlatformRoleRepository = {
  async findByWorkosUserId(db: Querier, workosUserId: string): Promise<PlatformRoleRow | null> {
    const result = await db.query<PlatformRoleRow>(
      `SELECT ${SELECT_FIELDS} FROM platform_roles WHERE workos_user_id = $1`,
      [workosUserId]
    )
    return result.rows[0] ?? null
  },

  /**
   * Idempotent grant of a platform role. Used both by the grant-platform-role
   * script and by the backoffice service for single-user grants.
   * Race-safe per INV-20: ON CONFLICT UPDATE keeps the row in sync.
   */
  async upsert(db: Querier, workosUserId: string, role: string): Promise<PlatformRoleRow> {
    const result = await db.query<PlatformRoleRow>(
      `INSERT INTO platform_roles (workos_user_id, role)
       VALUES ($1, $2)
       ON CONFLICT (workos_user_id) DO UPDATE SET
         role = EXCLUDED.role,
         updated_at = NOW()
       RETURNING ${SELECT_FIELDS}`,
      [workosUserId, role]
    )
    return result.rows[0]
  },

  /**
   * Bulk idempotent upsert. Uses parallel-array unnest so the whole batch is
   * a single round-trip (INV-56). No-op on an empty input. Used by the startup
   * seeder to bootstrap platform admins from env.
   */
  async upsertMany(db: Querier, rows: Array<{ workosUserId: string; role: string }>): Promise<void> {
    if (rows.length === 0) return
    const userIds = rows.map((r) => r.workosUserId)
    const roles = rows.map((r) => r.role)
    await db.query(
      `INSERT INTO platform_roles (workos_user_id, role)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (workos_user_id) DO UPDATE SET
         role = EXCLUDED.role,
         updated_at = NOW()`,
      [userIds, roles]
    )
  },

  /**
   * List `(workosUserId, region)` pairs for every platform admin who has a
   * workspace in each region. Joins into `workspace_memberships` and
   * `workspace_registry`; an admin with no workspaces yields no rows. Used
   * by the boot-time reconcile sweep to fan out to regions.
   */
  async listAdminRegionPairs(db: Querier): Promise<Array<{ workosUserId: string; region: string }>> {
    const result = await db.query<{ workos_user_id: string; region: string }>(
      `SELECT DISTINCT pr.workos_user_id, wr.region
       FROM platform_roles pr
       JOIN workspace_memberships wm ON wm.workos_user_id = pr.workos_user_id
       JOIN workspace_registry wr ON wr.id = wm.workspace_id
       WHERE pr.role = 'admin'`
    )
    return result.rows.map((row) => ({ workosUserId: row.workos_user_id, region: row.region }))
  },
}
