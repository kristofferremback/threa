import type { Pool } from "pg"
import { logger } from "@threa/backend-common"
import type { RegionalClient } from "../../lib/regional-client"

/**
 * At control-plane boot, push every platform admin's flag to every region
 * they have a workspace in. Self-heals regional drift (e.g. a region that was
 * down when a role was granted) and, on first deploy after the migration,
 * backfills regional `platform_admins` for every existing admin.
 *
 * Idempotent: regional `PlatformAdminRepository.grant` uses ON CONFLICT DO
 * NOTHING, so re-running on every boot is safe. Best-effort per region: if a
 * region is unreachable we log and move on — the next boot will retry.
 */
export async function reconcilePlatformAdminsAcrossRegions(pool: Pool, regionalClient: RegionalClient): Promise<void> {
  const result = await pool.query<{ workos_user_id: string; region: string }>(
    `SELECT DISTINCT pr.workos_user_id, wr.region
     FROM platform_roles pr
     JOIN workspace_memberships wm ON wm.workos_user_id = pr.workos_user_id
     JOIN workspace_registry wr ON wr.id = wm.workspace_id
     WHERE pr.role = 'admin'`
  )

  if (result.rows.length === 0) {
    logger.info("Platform-admin reconcile: no admin/region pairs to sync")
    return
  }

  let succeeded = 0
  let failed = 0
  for (const row of result.rows) {
    try {
      await regionalClient.setPlatformAdmin(row.region, row.workos_user_id, true)
      succeeded++
    } catch (err) {
      failed++
      logger.warn(
        { err, region: row.region, workosUserId: row.workos_user_id },
        "Platform-admin reconcile: regional push failed; will retry next boot"
      )
    }
  }

  logger.info({ succeeded, failed, total: result.rows.length }, "Platform-admin reconcile complete")
}
