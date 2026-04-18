import type { NextFunction, Request, RequestHandler, Response } from "express"
import type { WorkspacePermissionScope } from "@threa/types"

export interface WorkspaceAuthorizationContext {
  source: "session" | "user_api_key" | "bot_api_key"
  organizationId: string | null
  organizationMembershipId: string | null
  permissions: Set<WorkspacePermissionScope>
  assignedRoles: Array<{ slug: string; name: string }>
  canEditRole: boolean
}

declare global {
  namespace Express {
    interface Request {
      authz?: WorkspaceAuthorizationContext
    }
  }
}

const ADMIN_COMPATIBILITY_PERMISSIONS: WorkspacePermissionScope[] = ["members:write", "workspace:admin"]

export function getWorkspacePermissions(req: Request): WorkspacePermissionScope[] {
  return [...(req.authz?.permissions ?? new Set<WorkspacePermissionScope>())]
}

export function hasWorkspacePermission(req: Request, permission: WorkspacePermissionScope): boolean {
  return req.authz?.permissions.has(permission) ?? false
}

export function compatibilityRoleFromPermissions(permissions: Iterable<WorkspacePermissionScope>): "admin" | "user" {
  const granted = permissions instanceof Set ? permissions : new Set(permissions)
  return ADMIN_COMPATIBILITY_PERMISSIONS.some((permission) => granted.has(permission)) ? "admin" : "user"
}

export function requireWorkspacePermission(...permissions: WorkspacePermissionScope[]): RequestHandler {
  return function requireWorkspacePermissionMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!req.authz) {
      res.status(401).json({ error: "Not authenticated" })
      return
    }

    const missing = permissions.find((permission) => !req.authz!.permissions.has(permission))
    if (missing) {
      res.status(403).json({ error: `Missing required permission: ${missing}` })
      return
    }

    next()
  }
}
