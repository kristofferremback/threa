import type { AuthSessionClaims } from "@threa/backend-common"
import type { WorkspacePermissionScope } from "@threa/types"
import type { Pool } from "pg"
import { UserRepository, type User } from "./features/workspaces"
import { logger } from "./lib/logger"
import { resolveWorkspaceAuthorization } from "./middleware/workspace-authz-resolver"

export async function authorizeWorkspaceSocket(params: {
  pool: Pool
  workspaceId: string
  workosUserId: string
  session?: AuthSessionClaims
  requiredPermission?: WorkspacePermissionScope
}): Promise<{ ok: true; workspaceUser: User } | { ok: false; reason: "unauthorized" | "org_mismatch" }> {
  const workspaceUser = await UserRepository.findByWorkosUserIdInWorkspace(
    params.pool,
    params.workspaceId,
    params.workosUserId
  )
  if (!workspaceUser) {
    return { ok: false, reason: "unauthorized" }
  }

  const authz = await resolveWorkspaceAuthorization({
    pool: params.pool,
    workspaceId: params.workspaceId,
    userId: workspaceUser.id,
    source: "session",
    session: params.session,
  })
  if (authz.status !== "ok") {
    logger.warn(
      {
        workspaceId: params.workspaceId,
        workosUserId: params.workosUserId,
        status: authz.status,
      },
      "Socket authorization failed"
    )
    return { ok: false, reason: authz.status === "org_mismatch" ? "org_mismatch" : "unauthorized" }
  }

  if (params.requiredPermission && !authz.value.permissions.has(params.requiredPermission)) {
    return { ok: false, reason: "unauthorized" }
  }

  if (workspaceUser.role !== authz.value.compatibilityRole) {
    const updated = await UserRepository.update(params.pool, params.workspaceId, workspaceUser.id, {
      role: authz.value.compatibilityRole,
    })
    if (updated) {
      return { ok: true, workspaceUser: updated }
    }
  }

  return { ok: true, workspaceUser }
}
