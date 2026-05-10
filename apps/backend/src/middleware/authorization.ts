import type { NextFunction, Request, RequestHandler, Response } from "express"
import { HttpError } from "@threa/backend-common"
import type { User } from "../features/workspaces"

type WorkspaceRole = User["role"]

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = { user: 0, admin: 1, owner: 2 }

export function hasRoleAtLeast(user: { role: WorkspaceRole }, minimumRole: WorkspaceRole): boolean {
  return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[minimumRole]
}

/**
 * Throw 403 unless the user has at least the given role. Handler-side equivalent
 * of `requireRole` for endpoints whose authorization depends on request shape
 * (e.g. role gating differs by entity type).
 */
export function assertRoleAtLeast(user: { role: WorkspaceRole }, minimumRole: WorkspaceRole): void {
  if (!hasRoleAtLeast(user, minimumRole)) {
    throw new HttpError("Insufficient role", { status: 403, code: "FORBIDDEN" })
  }
}

export function requireRole(minimumRole: WorkspaceRole): RequestHandler {
  return function requireRoleMiddleware(req: Request, _res: Response, next: NextFunction): void {
    const user = req.user
    if (!user) {
      next(new HttpError("Not authenticated", { status: 401, code: "UNAUTHORIZED" }))
      return
    }

    if (!hasRoleAtLeast(user, minimumRole)) {
      next(new HttpError("Insufficient role", { status: 403, code: "FORBIDDEN" }))
      return
    }

    next()
  }
}
