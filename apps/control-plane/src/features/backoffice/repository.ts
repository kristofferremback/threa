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
   * Idempotent grant of a platform role. Used both by the startup seeder (to
   * bootstrap platform admins from env) and by the grant-platform-role script.
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
}
