import type { NextFunction, Request, RequestHandler, Response } from "express"
import type { WorkspacePermissionScope } from "@threa/types"

export type WorkspaceAuthzSource = "session" | "user_api_key" | "bot_api_key"

export interface WorkspaceAuthorizationContext {
  source: WorkspaceAuthzSource
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

export const ADMIN_COMPATIBILITY_PERMISSIONS: ReadonlySet<WorkspacePermissionScope> = new Set([
  "members:write",
  "workspace:admin",
])

export function getWorkspacePermissions(req: Request): WorkspacePermissionScope[] {
  return [...(req.authz?.permissions ?? new Set<WorkspacePermissionScope>())]
}

export function hasWorkspacePermission(req: Request, permission: WorkspacePermissionScope): boolean {
  return req.authz?.permissions.has(permission) ?? false
}

export function compatibilityRoleFromPermissions(permissions: Iterable<WorkspacePermissionScope>): "admin" | "user" {
  const granted = permissions instanceof Set ? permissions : new Set(permissions)
  for (const permission of ADMIN_COMPATIBILITY_PERMISSIONS) {
    if (granted.has(permission)) {
      return "admin"
    }
  }
  return "user"
}

export function storedCompatibilityRole(
  currentRole: "owner" | "admin" | "user",
  nextRole: "admin" | "user",
  isOwner: boolean
): "owner" | "admin" | "user" {
  return currentRole === "owner" && isOwner ? "owner" : nextRole
}

export function workosRoleSlugFromCompatibilityRole(role: "owner" | "admin" | "user"): "admin" | "member" {
  return role === "admin" || role === "owner" ? "admin" : "member"
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
