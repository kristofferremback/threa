import type { NextFunction, Request, RequestHandler, Response } from "express"
import type { User } from "../features/workspaces"

type WorkspaceRole = User["role"]

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 }

export function requireRole(minimumRole: WorkspaceRole): RequestHandler {
  const minimumLevel = ROLE_HIERARCHY[minimumRole]

  return function requireRoleMiddleware(req: Request, res: Response, next: NextFunction): void {
    const user = req.user
    if (!user) {
      res.status(401).json({ error: "Not authenticated" })
      return
    }

    if (ROLE_HIERARCHY[user.role] < minimumLevel) {
      res.status(403).json({ error: "Insufficient role" })
      return
    }

    next()
  }
}
