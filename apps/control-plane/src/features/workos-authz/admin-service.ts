import type { Pool } from "pg"
import { HttpError, logger, type WorkosOrganizationMembership, type WorkosOrgService } from "@threa/backend-common"
import { WORKSPACE_ROLE_SLUGS, WORKSPACE_USER_ROLES, type WorkspaceRoleSlug } from "@threa/types"
import { withOrganizationAdminLock } from "./org-admin-lock"

interface Dependencies {
  pool: Pool
  workosOrgService: WorkosOrgService
}

/**
 * The user performing an admin action. `isPlatformAdmin` lets the backoffice
 * surface bypass the owner-action gate while still respecting data-integrity
 * guards (last-owner, self-demote). Regional surfaces pass
 * `isPlatformAdmin: false`; their `requireWorkspacePermission('workspace:owner')`
 * middleware is the first gate and this service is the second.
 */
export interface AdminActor {
  workosUserId: string
  isPlatformAdmin: boolean
}

export interface AssignRoleParams {
  actor: AdminActor
  organizationId: string
  targetUserId: string
  roleSlug: WorkspaceRoleSlug
}

export interface ChangeRoleParams {
  actor: AdminActor
  organizationId: string
  targetUserId: string
  roleSlug: WorkspaceRoleSlug
}

export interface RemoveMemberParams {
  actor: AdminActor
  organizationId: string
  targetUserId: string
}

/**
 * Write paths for WorkOS organization memberships.
 *
 * Concurrency model: every write acquires a per-organization advisory lock
 * via `withOrganizationAdminLock`, then reads the *authoritative* membership
 * list from WorkOS (not the local mirror, which is async-updated by the event
 * poller and would be stale here). All guards — actor permission, target
 * lookup, last-owner protection — derive from that single fresh snapshot.
 *
 * This is intentional: a check-then-act against the mirror is INV-20-unsafe
 * because the mirror's `last_event_at` only advances after the poller picks
 * up the WorkOS event, so two concurrent admin writes both see the pre-write
 * state. The lock + WorkOS read makes the guard transactional from the
 * caller's perspective.
 *
 * The poller continues to be the canonical mirror updater; this path does not
 * write to the mirror.
 */
export class WorkosAuthzAdminService {
  private pool: Pool
  private workosOrgService: WorkosOrgService

  constructor({ pool, workosOrgService }: Dependencies) {
    this.pool = pool
    this.workosOrgService = workosOrgService
  }

  async assignRole(params: AssignRoleParams): Promise<void> {
    assertKnownRole(params.roleSlug)
    await withOrganizationAdminLock(this.pool, params.organizationId, async () => {
      const memberships = await this.workosOrgService.listOrganizationMemberships(params.organizationId)
      this.assertActorMayManage(params.actor, memberships)

      // Promotion to owner via assign is allowed (this is how a new owner gets
      // their first membership). Demotion of an existing owner is a
      // `changeRole` concern and is guarded there.
      await this.workosOrgService.ensureOrganizationMembership({
        organizationId: params.organizationId,
        userId: params.targetUserId,
        roleSlug: params.roleSlug,
      })
      logger.info(
        {
          actor: params.actor.workosUserId,
          organizationId: params.organizationId,
          targetUserId: params.targetUserId,
          roleSlug: params.roleSlug,
        },
        "WorkosAuthzAdminService: assignRole"
      )
    })
  }

  async changeRole(params: ChangeRoleParams): Promise<void> {
    assertKnownRole(params.roleSlug)
    await withOrganizationAdminLock(this.pool, params.organizationId, async () => {
      const memberships = await this.workosOrgService.listOrganizationMemberships(params.organizationId)
      this.assertActorMayManage(params.actor, memberships)

      const target = requireTargetMembership(memberships, params.targetUserId)
      const wasOwner = target.roleSlugs.includes(WORKSPACE_ROLE_SLUGS.OWNER)
      const willBeOwner = params.roleSlug === WORKSPACE_ROLE_SLUGS.OWNER

      if (wasOwner && !willBeOwner) {
        this.assertNotSelfDemote(params.actor, params.targetUserId)
        this.assertNotLastOwner(memberships, params.targetUserId)
      }

      await this.workosOrgService.changeOrganizationMembershipRole({
        organizationMembershipId: target.id,
        roleSlug: params.roleSlug,
      })
      logger.info(
        {
          actor: params.actor.workosUserId,
          organizationId: params.organizationId,
          targetUserId: params.targetUserId,
          fromRoles: target.roleSlugs,
          toRole: params.roleSlug,
        },
        "WorkosAuthzAdminService: changeRole"
      )
    })
  }

  async removeMember(params: RemoveMemberParams): Promise<void> {
    await withOrganizationAdminLock(this.pool, params.organizationId, async () => {
      const memberships = await this.workosOrgService.listOrganizationMemberships(params.organizationId)
      this.assertActorMayManage(params.actor, memberships)

      const target = requireTargetMembership(memberships, params.targetUserId)
      this.assertNotSelfDemote(params.actor, params.targetUserId)
      if (target.roleSlugs.includes(WORKSPACE_ROLE_SLUGS.OWNER)) {
        this.assertNotLastOwner(memberships, params.targetUserId)
      }

      await this.workosOrgService.removeOrganizationMembership(target.id)
      logger.info(
        {
          actor: params.actor.workosUserId,
          organizationId: params.organizationId,
          targetUserId: params.targetUserId,
        },
        "WorkosAuthzAdminService: removeMember"
      )
    })
  }

  // --- guards (all derived from a single WorkOS snapshot taken under the
  // per-org advisory lock) --------------------------------------------------

  private assertActorMayManage(actor: AdminActor, memberships: WorkosOrganizationMembership[]): void {
    if (actor.isPlatformAdmin) return
    const actorMembership = memberships.find((m) => m.userId === actor.workosUserId)
    if (!actorMembership || !actorMembership.roleSlugs.includes(WORKSPACE_ROLE_SLUGS.OWNER)) {
      throw new HttpError("Only workspace owners may manage members", {
        status: 403,
        code: "FORBIDDEN",
      })
    }
  }

  private assertNotSelfDemote(actor: AdminActor, targetUserId: string): void {
    if (actor.workosUserId === targetUserId) {
      throw new HttpError("Owners cannot demote or remove themselves; transfer ownership first", {
        status: 422,
        code: "SELF_DEMOTE",
      })
    }
  }

  private assertNotLastOwner(memberships: WorkosOrganizationMembership[], targetUserId: string): void {
    const remainingOwners = memberships.filter(
      (m) => m.userId !== targetUserId && m.roleSlugs.includes(WORKSPACE_ROLE_SLUGS.OWNER)
    ).length
    if (remainingOwners === 0) {
      throw new HttpError("Cannot leave the workspace without an owner", {
        status: 422,
        code: "LAST_OWNER",
      })
    }
  }
}

function requireTargetMembership(
  memberships: WorkosOrganizationMembership[],
  targetUserId: string
): WorkosOrganizationMembership {
  const target = memberships.find((m) => m.userId === targetUserId)
  if (!target) {
    throw new HttpError("Target member not found", { status: 404, code: "NOT_FOUND" })
  }
  return target
}

function assertKnownRole(slug: string): asserts slug is WorkspaceRoleSlug {
  if (!(WORKSPACE_USER_ROLES as readonly string[]).includes(slug)) {
    throw new HttpError(`Unknown workspace role: ${slug}`, { status: 400, code: "INVALID_ROLE" })
  }
}
