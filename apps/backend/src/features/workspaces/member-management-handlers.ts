import type { Request, Response } from "express"
import { z } from "zod"
import type { Pool } from "pg"
import { WORKSPACE_USER_ROLES, type WorkspaceRoleSlug } from "@threa/types"
import { HttpError } from "../../lib/errors"
import type { ControlPlaneClient } from "../../lib/control-plane-client"
import { UserRepository } from "./user-repository"

interface Dependencies {
  pool: Pool
  controlPlaneClient: ControlPlaneClient
}

const roleSlugSchema = z.enum(WORKSPACE_USER_ROLES as readonly [WorkspaceRoleSlug, ...WorkspaceRoleSlug[]])

const changeRoleBody = z.object({
  roleSlug: roleSlugSchema,
})

async function resolveTargetWorkosUserId(pool: Pool, workspaceId: string, userId: string): Promise<string> {
  const user = await UserRepository.findById(pool, workspaceId, userId)
  if (!user) {
    throw new HttpError("User not found in workspace", { status: 404, code: "NOT_FOUND" })
  }
  return user.workosUserId
}

/**
 * Regional pass-through for workspace member admin actions.
 *
 * The regional service does NOT mutate its own membership mirror — WorkOS is
 * the source of truth and the control plane's event poller fans changes back
 * out under INV-20 timestamp guards. Each handler just resolves the local
 * `users.id` to a WorkOS user id and forwards to the control plane, which
 * applies the role/remove against WorkOS under a per-org advisory lock.
 */
export function createWorkspaceMemberManagementHandlers({ pool, controlPlaneClient }: Dependencies) {
  return {
    async changeRole(req: Request, res: Response): Promise<void> {
      const workspaceId = req.workspaceId
      const actorWorkosUserId = req.user?.workosUserId
      const targetUserRowId = req.params.userId
      if (!workspaceId || !actorWorkosUserId) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      if (!targetUserRowId) {
        throw new HttpError("Missing userId", { status: 400, code: "VALIDATION_ERROR" })
      }
      const parsed = changeRoleBody.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      const targetWorkosUserId = await resolveTargetWorkosUserId(pool, workspaceId, targetUserRowId)
      await controlPlaneClient.changeWorkspaceMemberRole({
        workspaceId,
        targetUserId: targetWorkosUserId,
        actorWorkosUserId,
        roleSlug: parsed.data.roleSlug,
      })

      res.status(204).end()
    },

    async removeMember(req: Request, res: Response): Promise<void> {
      const workspaceId = req.workspaceId
      const actorWorkosUserId = req.user?.workosUserId
      const targetUserRowId = req.params.userId
      if (!workspaceId || !actorWorkosUserId) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }
      if (!targetUserRowId) {
        throw new HttpError("Missing userId", { status: 400, code: "VALIDATION_ERROR" })
      }

      const targetWorkosUserId = await resolveTargetWorkosUserId(pool, workspaceId, targetUserRowId)
      await controlPlaneClient.removeWorkspaceMember({
        workspaceId,
        targetUserId: targetWorkosUserId,
        actorWorkosUserId,
      })

      res.status(204).end()
    },
  }
}
