import type { Pool } from "pg"
import { logger, type WorkosMembershipEvent } from "@threa/backend-common"
import { WorkosAuthzRepository } from "./repository"

interface Dependencies {
  pool: Pool
}

/**
 * Service that applies WorkOS membership events to the local mirror.
 *
 * Phase 1 is read-only — no fan-out to regional backends, no enforcement,
 * no write paths back to WorkOS. The poller calls `processEvent` for each
 * event in order and the service routes it to the correct repo method.
 *
 * INV-6: services own transaction boundaries. Each event is one upsert/delete,
 * which is already atomic at the row level, so no explicit transaction is
 * needed here.
 */
export class WorkosAuthzService {
  private pool: Pool

  constructor({ pool }: Dependencies) {
    this.pool = pool
  }

  async processEvent(event: WorkosMembershipEvent): Promise<void> {
    const { membership } = event
    switch (event.type) {
      case "organization_membership.created":
      case "organization_membership.updated": {
        const updated = await WorkosAuthzRepository.upsertMembershipFromEvent(this.pool, {
          organizationMembershipId: membership.id,
          workosOrganizationId: membership.organizationId,
          workosUserId: membership.userId,
          status: membership.status,
          roleSlugs: membership.roleSlugs,
          eventId: event.id,
          eventCreatedAt: event.createdAt,
        })
        if (!updated) {
          logger.debug(
            {
              eventId: event.id,
              eventType: event.type,
              organizationId: membership.organizationId,
              userId: membership.userId,
            },
            "WorkOS authz event ignored as stale"
          )
        }
        return
      }
      case "organization_membership.deleted": {
        await WorkosAuthzRepository.deleteMembership(this.pool, {
          workosOrganizationId: membership.organizationId,
          workosUserId: membership.userId,
          eventCreatedAt: event.createdAt,
        })
        return
      }
    }
  }
}
