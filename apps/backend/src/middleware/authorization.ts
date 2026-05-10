import type { NextFunction, Request, RequestHandler, Response } from "express"
import { WORKSPACE_PERMISSION_SCOPES, type WorkspacePermissionSlug, type WorkspaceRoleSlug } from "@threa/types"
import { HttpError } from "../lib/errors"
import type { RequireWorkspacePermission } from "./workspace-permission"

function roleGate(role: WorkspaceRoleSlug): WorkspacePermissionSlug {
  switch (role) {
    case "owner":
      return WORKSPACE_PERMISSION_SCOPES.WORKSPACE_OWNER
    case "admin":
      return WORKSPACE_PERMISSION_SCOPES.WORKSPACE_ADMIN
    case "member":
      // messages:read is granted to every recognized role, so it passes for any active member.
      return WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ
  }
}

interface Dependencies {
  requireWorkspacePermission: RequireWorkspacePermission
}

/**
 * Transitional role-only gate retained until route call sites migrate to
 * `requireWorkspacePermission(slug)`. Unlike the underlying permission
 * middleware, this rejects API-key credentials — old `requireRole` behavior
 * was session-only, and silently accepting user/bot keys here would be a
 * scope expansion. Deleted in PR-4 once all callers are migrated.
 */
export function createRequireRole({ requireWorkspacePermission }: Dependencies) {
  const sessionOnly = (handler: RequestHandler): RequestHandler => {
    return async function (req: Request, _res: Response, next: NextFunction) {
      if (req.userApiKey || req.botApiKey) {
        next(new HttpError("Role-gated route is not accessible via API key", { status: 401, code: "UNAUTHENTICATED" }))
        return
      }
      return handler(req, _res, next)
    }
  }
  return function requireRole(minimumRole: WorkspaceRoleSlug): RequestHandler {
    return sessionOnly(requireWorkspacePermission(roleGate(minimumRole)))
  }
}
