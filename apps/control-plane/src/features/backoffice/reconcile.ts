import type { Pool } from "pg"
import { logger } from "@threa/backend-common"
import type { RegionalClient } from "../../lib/regional-client"

/**
 * At control-plane boot, push `isPlatformAdmin=true` to every region each
 * platform admin has a workspace in. On first deploy after the migration this
 * backfills regional `platform_admins`; on subsequent boots it resurrects rows
 * in regions that were down when a grant happened.
 *
 * Grant-only — does NOT push revocations. Today the only way to mutate
 * `platform_roles` is manual SQL (there's no revoke UI/API), so the drift
 * window is narrow in practice. When a revoke code path is added, it should
 * push `isPlatformAdmin=false` to every region the user currently has
 * membership in (same `workspace_memberships` + `workspace_registry` join as
 * grant). A user who has also been removed from every workspace leaves a
 * dead regional row behind, but they can no longer reach the frontend so it
 * won't surface — still worth a follow-up cleanup pass when the revoke API
 * lands.
 *
 * Per-region pushes run concurrently; individual failures are logged, next
 * boot retries. Meant to be invoked after `server.listen` so a slow region
 * can't stall health checks.
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

  const settled = await Promise.allSettled(
    result.rows.map((row) =>
      regionalClient.setPlatformAdmin(row.region, row.workos_user_id, true).then(
        () => ({ ok: true as const, row }),
        (err: unknown) => ({ ok: false as const, row, err })
      )
    )
  )

  let succeeded = 0
  let failed = 0
  for (const outcome of settled) {
    // allSettled with the inner catch means every promise resolves; the outer
    // fulfilled value carries our ok flag.
    if (outcome.status !== "fulfilled") continue
    if (outcome.value.ok) {
      succeeded++
    } else {
      failed++
      logger.warn(
        { err: outcome.value.err, region: outcome.value.row.region, workosUserId: outcome.value.row.workos_user_id },
        "Platform-admin reconcile: regional push failed; will retry next boot"
      )
    }
  }

  logger.info({ succeeded, failed, total: result.rows.length }, "Platform-admin reconcile complete")
}
