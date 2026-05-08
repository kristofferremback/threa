import type { Pool } from "pg"
import { logger, type WorkosOrgService } from "@threa/backend-common"
import { WorkspaceRegistryRepository } from "../workspaces"
import { WorkosAuthzRepository } from "./repository"
import type { WorkosEventPollerLock } from "../../lib/workos-event-poller-lock"

interface Dependencies {
  pool: Pool
  workosOrgService: WorkosOrgService
  /** Optional — when provided, backfill stamps `last_backfill_at` after a successful run. */
  lock?: WorkosEventPollerLock
}

export interface WorkosAuthzBackfillResult {
  orgsScanned: number
  membershipsUpserted: number
  membershipsRemoved: number
}

/**
 * Read every workspace with a non-null `workos_organization_id`, ask WorkOS
 * for its full membership list, and upsert each row via the backfill path.
 *
 * Backfill is idempotent and re-runnable. It does NOT touch the poller's
 * `last_event_id` cursor: the regular event poller has its own timestamp
 * guard so a stale event replay can't clobber freshly backfilled state.
 */
export class WorkosAuthzBackfill {
  private pool: Pool
  private workosOrgService: WorkosOrgService
  private lock?: WorkosEventPollerLock

  constructor({ pool, workosOrgService, lock }: Dependencies) {
    this.pool = pool
    this.workosOrgService = workosOrgService
    this.lock = lock
  }

  async run(): Promise<WorkosAuthzBackfillResult> {
    const orgIds = await WorkspaceRegistryRepository.listWorkosOrganizationIds(this.pool)

    let membershipsUpserted = 0
    let membershipsRemoved = 0
    let hadErrors = false
    for (const orgId of orgIds) {
      try {
        // Stamp once per org before reading, so any membership event WorkOS
        // observes after this snapshot wins the timestamp guard on upsert and
        // survives the reconcile delete below.
        const observedAt = new Date()
        const memberships = await this.workosOrgService.listOrganizationMemberships(orgId)
        for (const m of memberships) {
          await WorkosAuthzRepository.upsertMembershipFromBackfill(this.pool, {
            organizationMembershipId: m.id,
            workosOrganizationId: m.organizationId,
            workosUserId: m.userId,
            status: m.status,
            roleSlugs: m.roleSlugs,
            observedAt,
          })
          membershipsUpserted++
        }
        // Reconcile: drop mirror rows for memberships WorkOS no longer reports.
        // Without this, a missed delete event leaves stale rows in the mirror
        // that no rerun of backfill would ever clean up.
        membershipsRemoved += await WorkosAuthzRepository.reconcileOrganizationSnapshot(this.pool, {
          workosOrganizationId: orgId,
          snapshotMembershipIds: memberships.map((m) => m.id),
          observedAt,
        })
      } catch (err) {
        hadErrors = true
        logger.error({ err, organizationId: orgId }, "Failed to backfill WorkOS memberships for organization")
      }
    }

    // Only stamp last_backfill_at on a fully successful run — otherwise the
    // first-boot guard in server.ts would suppress retry of failed orgs.
    if (!hadErrors && this.lock) {
      await this.lock.stampBackfill()
    }

    logger.info(
      { orgsScanned: orgIds.length, membershipsUpserted, membershipsRemoved, hadErrors },
      "WorkOS authz backfill complete"
    )
    return { orgsScanned: orgIds.length, membershipsUpserted, membershipsRemoved }
  }
}
