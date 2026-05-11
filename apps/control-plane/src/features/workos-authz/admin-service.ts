import type { Pool } from "pg"
import { HttpError, logger, type WorkosOrgService } from "@threa/backend-common"
import { WORKSPACE_ROLE_SLUGS, WORKSPACE_USER_ROLES, type WorkspaceRoleSlug } from "@threa/types"
import { WorkosAuthzRepository, type WorkosOrgMembershipRow } from "./repository"

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
 * Write paths for WorkOS organization memberships. Reads the mirror to enforce
 * data-integrity guards and delegates the actual WorkOS mutation to
 * `WorkosOrgService`. Mirror updates land asynchronously through the regular
 * event poller — callers see eventual consistency, not read-your-write.
 *
 * INV-6: service owns the orchestration; no transaction is required because
 * the local mirror is read-only on this path.
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
    await this.assertActorMayManage(params.actor, params.organizationId)

    // Promotion to owner via assign is allowed (this is how a new owner gets
    // their first membership). Demotion to non-owner of an existing owner is
    // a `changeRole` concern and is guarded there.
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
  }

  async changeRole(params: ChangeRoleParams): Promise<void> {
    assertKnownRole(params.roleSlug)
    await this.assertActorMayManage(params.actor, params.organizationId)

    const target = await this.requireTargetMembership(params.organizationId, params.targetUserId)
    const wasOwner = target.role_slugs.includes(WORKSPACE_ROLE_SLUGS.OWNER)
    const willBeOwner = params.roleSlug === WORKSPACE_ROLE_SLUGS.OWNER

    if (wasOwner && !willBeOwner) {
      this.assertNotSelfDemote(params.actor, params.targetUserId)
      await this.assertNotLastOwner(params.organizationId, params.targetUserId)
    }

    await this.workosOrgService.changeOrganizationMembershipRole({
      organizationMembershipId: target.organization_membership_id,
      roleSlug: params.roleSlug,
    })
    logger.info(
      {
        actor: params.actor.workosUserId,
        organizationId: params.organizationId,
        targetUserId: params.targetUserId,
        fromRoles: target.role_slugs,
        toRole: params.roleSlug,
      },
      "WorkosAuthzAdminService: changeRole"
    )
  }

  async removeMember(params: RemoveMemberParams): Promise<void> {
    await this.assertActorMayManage(params.actor, params.organizationId)

    const target = await this.requireTargetMembership(params.organizationId, params.targetUserId)
    this.assertNotSelfDemote(params.actor, params.targetUserId)
    if (target.role_slugs.includes(WORKSPACE_ROLE_SLUGS.OWNER)) {
      await this.assertNotLastOwner(params.organizationId, params.targetUserId)
    }

    await this.workosOrgService.removeOrganizationMembership(target.organization_membership_id)
    logger.info(
      {
        actor: params.actor.workosUserId,
        organizationId: params.organizationId,
        targetUserId: params.targetUserId,
      },
      "WorkosAuthzAdminService: removeMember"
    )
  }

  // --- guards --------------------------------------------------------------

  private async assertActorMayManage(actor: AdminActor, organizationId: string): Promise<void> {
    if (actor.isPlatformAdmin) return
    const membership = await WorkosAuthzRepository.getByOrgAndUser(this.pool, organizationId, actor.workosUserId)
    if (!membership || !membership.role_slugs.includes(WORKSPACE_ROLE_SLUGS.OWNER)) {
      throw new HttpError("Only workspace owners may manage members", {
        status: 403,
        code: "FORBIDDEN",
      })
    }
  }

  private async requireTargetMembership(organizationId: string, targetUserId: string): Promise<WorkosOrgMembershipRow> {
    const membership = await WorkosAuthzRepository.getByOrgAndUser(this.pool, organizationId, targetUserId)
    if (!membership) {
      throw new HttpError("Target member not found", { status: 404, code: "NOT_FOUND" })
    }
    return membership
  }

  private assertNotSelfDemote(actor: AdminActor, targetUserId: string): void {
    if (actor.workosUserId === targetUserId) {
      throw new HttpError("Owners cannot demote or remove themselves; transfer ownership first", {
        status: 422,
        code: "SELF_DEMOTE",
      })
    }
  }

  private async assertNotLastOwner(organizationId: string, targetUserId: string): Promise<void> {
    const remainingOwners = await WorkosAuthzRepository.countByRoleExcludingUser(this.pool, {
      workosOrganizationId: organizationId,
      roleSlug: WORKSPACE_ROLE_SLUGS.OWNER,
      excludeWorkosUserId: targetUserId,
    })
    if (remainingOwners === 0) {
      throw new HttpError("Cannot leave the workspace without an owner", {
        status: 422,
        code: "LAST_OWNER",
      })
    }
  }
}

function assertKnownRole(slug: string): asserts slug is WorkspaceRoleSlug {
  if (!(WORKSPACE_USER_ROLES as readonly string[]).includes(slug)) {
    throw new HttpError(`Unknown workspace role: ${slug}`, { status: 400, code: "INVALID_ROLE" })
  }
}
