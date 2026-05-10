import type { NextFunction, Request, RequestHandler, Response } from "express"
import { roleRank, type WorkspaceRoleSlug } from "@threa/types"

export function requireRole(minimumRole: WorkspaceRoleSlug): RequestHandler {
  const minimumLevel = roleRank(minimumRole)

  return function requireRoleMiddleware(req: Request, res: Response, next: NextFunction): void {
    const user = req.user
    if (!user) {
      res.status(401).json({ error: "Not authenticated" })
      return
    }

    if (roleRank(user.role) < minimumLevel) {
      res.status(403).json({ error: "Insufficient role" })
      return
    }

    next()
  }
}
