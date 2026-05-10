import type { RequestHandler } from "express"
import { WORKSPACE_PERMISSION_SCOPES, type WorkspacePermissionSlug, type WorkspaceRoleSlug } from "@threa/types"
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

export function createRequireRole({ requireWorkspacePermission }: Dependencies) {
  return function requireRole(minimumRole: WorkspaceRoleSlug): RequestHandler {
    return requireWorkspacePermission(roleGate(minimumRole))
  }
}
