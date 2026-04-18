import type { Request, Response, NextFunction } from "express"
import type { Pool } from "pg"
import type { WorkosOrgService } from "@threa/backend-common"
import { UserRepository, type User } from "../features/workspaces"
import { resolveWorkspaceAuthorization } from "./workspace-authz-resolver"

declare global {
  namespace Express {
    interface Request {
      workspaceId?: string
      user?: User
    }
  }
}

interface Dependencies {
  pool: Pool
  workosOrgService: WorkosOrgService
}

export function createWorkspaceUserMiddleware({ pool, workosOrgService }: Dependencies) {
  return async function workspaceUserMiddleware(req: Request, res: Response, next: NextFunction) {
    const { workspaceId } = req.params

    if (!workspaceId) {
      return next()
    }

    const workosUserId = req.workosUserId
    if (!workosUserId) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    const access = await UserRepository.findWorkspaceUserAccess(pool, workspaceId, workosUserId)
    if (!access.workspaceExists) {
      return res.status(404).json({ error: "Workspace not found" })
    }

    const user = access.user
    if (!user) {
      return res.status(403).json({ error: "Not a user in this workspace" })
    }

    const authz = await resolveWorkspaceAuthorization({
      pool,
      workosOrgService,
      workspaceId,
      workosUserId,
      userId: user.id,
      source: "session",
    })
    if (authz.status === "missing_org") {
      return res.status(500).json({ error: "Workspace is not configured for WorkOS authorization" })
    }
    if (authz.status === "missing_membership") {
      return res.status(403).json({ error: "Not authorized in this workspace" })
    }

    if (user.role !== authz.value.compatibilityRole) {
      await UserRepository.update(pool, workspaceId, user.id, { role: authz.value.compatibilityRole })
    }

    req.workspaceId = workspaceId
    req.authz = authz.value
    req.user = {
      ...user,
      role: authz.value.compatibilityRole,
      isOwner: authz.value.isOwner,
      assignedRole: authz.value.assignedRoles[0] ?? null,
      assignedRoles: authz.value.assignedRoles,
      canEditRole: authz.value.canEditRole,
    }
    next()
  }
}
