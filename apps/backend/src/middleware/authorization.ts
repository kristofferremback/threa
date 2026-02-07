import type { NextFunction, Request, RequestHandler, Response } from "express"
import type { Member } from "../repositories/member-repository"

type WorkspaceRole = Member["role"]

interface AuthorizationOptions {
  allowedRoles: WorkspaceRole[]
}

export function requireWorkspaceRole(options: AuthorizationOptions): RequestHandler {
  const allowed = new Set(options.allowedRoles)

  return function requireWorkspaceRoleMiddleware(req: Request, res: Response, next: NextFunction): void {
    const member = req.member
    if (!member) {
      res.status(401).json({ error: "Not authenticated" })
      return
    }

    if (!allowed.has(member.role)) {
      res.status(403).json({
        error: "Insufficient role",
        required: options.allowedRoles,
        current: member.role,
      })
      return
    }

    next()
  }
}
