import type { WorkosOrgService } from "@threa/backend-common"
import type { WorkspacePermissionScope } from "@threa/types"
import type { Pool } from "pg"
import { UserRepository, type User } from "./features/workspaces"
import { logger } from "./lib/logger"
import { resolveWorkspaceAuthorization } from "./middleware/workspace-authz-resolver"

export async function authorizeWorkspaceSocket(params: {
  pool: Pool
  workosOrgService: WorkosOrgService
  workspaceId: string
  workosUserId: string
  requiredPermission?: WorkspacePermissionScope
}): Promise<{ ok: true; workspaceUser: User } | { ok: false }> {
  const workspaceUser = await UserRepository.findByWorkosUserIdInWorkspace(
    params.pool,
    params.workspaceId,
    params.workosUserId
  )
  if (!workspaceUser) {
    return { ok: false }
  }

  const authz = await resolveWorkspaceAuthorization({
    pool: params.pool,
    workosOrgService: params.workosOrgService,
    workspaceId: params.workspaceId,
    workosUserId: params.workosUserId,
    userId: workspaceUser.id,
    source: "session",
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
    return { ok: false }
  }

  if (params.requiredPermission && !authz.value.permissions.has(params.requiredPermission)) {
    return { ok: false }
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
