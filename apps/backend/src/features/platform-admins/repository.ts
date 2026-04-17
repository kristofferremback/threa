import type { Querier } from "../../db"
import { sql } from "../../db"

export const PlatformAdminRepository = {
  async isPlatformAdmin(db: Querier, workosUserId: string): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1 FROM platform_admins WHERE workos_user_id = ${workosUserId}
    `)
    return result.rows.length > 0
  },

  /**
   * Idempotent grant. Called by control-plane pushes and by the boot-time
   * reconcile sweep. No-op if the user is already a platform admin.
   */
  async grant(db: Querier, workosUserId: string): Promise<void> {
    await db.query(sql`
      INSERT INTO platform_admins (workos_user_id)
      VALUES (${workosUserId})
      ON CONFLICT (workos_user_id) DO NOTHING
    `)
  },

  async revoke(db: Querier, workosUserId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM platform_admins WHERE workos_user_id = ${workosUserId}
    `)
  },
}
