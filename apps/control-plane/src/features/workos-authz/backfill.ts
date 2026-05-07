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
    for (const orgId of orgIds) {
      try {
        const memberships = await this.workosOrgService.listOrganizationMemberships(orgId)
        for (const m of memberships) {
          await WorkosAuthzRepository.upsertMembershipFromBackfill(this.pool, {
            organizationMembershipId: m.id,
            workosOrganizationId: m.organizationId,
            workosUserId: m.userId,
            status: m.status,
            roleSlugs: m.roleSlugs,
            observedAt: new Date(),
          })
          membershipsUpserted++
        }
      } catch (err) {
        logger.error({ err, organizationId: orgId }, "Failed to backfill WorkOS memberships for organization")
      }
    }

    if (this.lock) {
      await this.lock.stampBackfill()
    }

    logger.info({ orgsScanned: orgIds.length, membershipsUpserted }, "WorkOS authz backfill complete")
    return { orgsScanned: orgIds.length, membershipsUpserted }
  }
}
