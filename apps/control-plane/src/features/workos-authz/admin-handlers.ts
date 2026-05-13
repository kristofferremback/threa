import type { Request, Response } from "express"
import { z } from "zod/v4"
import type { Pool } from "pg"
import { HttpError } from "@threa/backend-common"
import { WORKSPACE_USER_ROLES, type WorkspaceRoleSlug } from "@threa/types"
import type { AdminActor, WorkosAuthzAdminService } from "./admin-service"
import { WorkspaceRegistryRepository } from "../workspaces"

interface Dependencies {
  pool: Pool
  adminService: WorkosAuthzAdminService
}

const roleSlugSchema = z.enum(WORKSPACE_USER_ROLES as readonly [WorkspaceRoleSlug, ...WorkspaceRoleSlug[]])

const internalActor = z.object({ workosUserId: z.string().min(1) })

const internalChangeRoleBody = z.object({
  actor: internalActor,
  roleSlug: roleSlugSchema,
})

const internalRemoveBody = z.object({
  actor: internalActor,
})

const backofficeChangeRoleBody = z.object({
  roleSlug: roleSlugSchema,
})

async function resolveOrganizationId(pool: Pool, workspaceId: string): Promise<string> {
  const orgId = await WorkspaceRegistryRepository.getWorkosOrganizationId(pool, workspaceId)
  if (!orgId) {
    throw new HttpError("Workspace not linked to a WorkOS organization", {
      status: 404,
      code: "NOT_LINKED",
    })
  }
  return orgId
}

function requireParam(value: string | undefined, name: string): string {
  if (!value) {
    throw new HttpError(`Missing ${name}`, { status: 400, code: "VALIDATION_ERROR" })
  }
  return value
}

/**
 * Internal endpoints called by regional backends on behalf of a workspace
 * owner. The regional service has already enforced
 * `requireWorkspacePermission("members:write")`; the body's `actor` is the
 * authenticated user id from that session. `isPlatformAdmin` is hard-coded
 * `false` — the platform-admin bypass is only reachable via the backoffice
 * surface, which gates on `requirePlatformAdmin`.
 */
export function createInternalAuthzAdminHandlers({ pool, adminService }: Dependencies) {
  return {
    async changeRole(req: Request, res: Response): Promise<void> {
      const workspaceId = requireParam(req.params.workspaceId, "workspaceId")
      const targetUserId = requireParam(req.params.userId, "userId")
      const parsed = internalChangeRoleBody.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }
      const organizationId = await resolveOrganizationId(pool, workspaceId)
      const actor: AdminActor = { workosUserId: parsed.data.actor.workosUserId, isPlatformAdmin: false }
      await adminService.changeRole({
        actor,
        organizationId,
        targetUserId,
        roleSlug: parsed.data.roleSlug,
      })
      res.status(204).end()
    },

    async removeMember(req: Request, res: Response): Promise<void> {
      const workspaceId = requireParam(req.params.workspaceId, "workspaceId")
      const targetUserId = requireParam(req.params.userId, "userId")
      const parsed = internalRemoveBody.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }
      const organizationId = await resolveOrganizationId(pool, workspaceId)
      const actor: AdminActor = { workosUserId: parsed.data.actor.workosUserId, isPlatformAdmin: false }
      await adminService.removeMember({
        actor,
        organizationId,
        targetUserId,
      })
      res.status(204).end()
    },
  }
}

/**
 * Backoffice endpoints called directly by the backoffice frontend. The actor
 * is always the authenticated session user with `isPlatformAdmin: true`
 * (`requirePlatformAdmin` has already gated the route). The admin service
 * still applies data-integrity guards (last-owner, self-demote), so a
 * platform admin can't accidentally orphan a workspace.
 */
export function createBackofficeAuthzAdminHandlers({ pool, adminService }: Dependencies) {
  return {
    async changeRole(req: Request, res: Response): Promise<void> {
      if (!req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      const workspaceId = requireParam(req.params.id, "workspaceId")
      const targetUserId = requireParam(req.params.userId, "userId")
      const parsed = backofficeChangeRoleBody.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }
      const organizationId = await resolveOrganizationId(pool, workspaceId)
      const actor: AdminActor = { workosUserId: req.authUser.id, isPlatformAdmin: true }
      await adminService.changeRole({
        actor,
        organizationId,
        targetUserId,
        roleSlug: parsed.data.roleSlug,
      })
      res.status(204).end()
    },

    async removeMember(req: Request, res: Response): Promise<void> {
      if (!req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      const workspaceId = requireParam(req.params.id, "workspaceId")
      const targetUserId = requireParam(req.params.userId, "userId")
      const organizationId = await resolveOrganizationId(pool, workspaceId)
      const actor: AdminActor = { workosUserId: req.authUser.id, isPlatformAdmin: true }
      await adminService.removeMember({
        actor,
        organizationId,
        targetUserId,
      })
      res.status(204).end()
    },
  }
}
