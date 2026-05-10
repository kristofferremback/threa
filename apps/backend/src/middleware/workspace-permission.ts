import type { NextFunction, Request, RequestHandler, Response } from "express"
import type { Pool } from "pg"
import { permissionsForRole, type WorkspacePermissionSlug } from "@threa/types"
import { HttpError } from "../lib/errors"
import { expandRoleSlugs, WorkspaceUserPermissionsRepository } from "../features/workspace-authz"

interface Dependencies {
  pool: Pool
}

const unauthenticated = () => new HttpError("Not authenticated", { status: 401, code: "UNAUTHENTICATED" })
const insufficient = () => new HttpError("Insufficient permissions", { status: 403, code: "FORBIDDEN" })
const ownerInactive = () =>
  new HttpError("API key owner is no longer an active workspace member", {
    status: 401,
    code: "OWNER_INACTIVE",
  })

/**
 * Gate a route on a workspace permission slug.
 *
 * Resolution order:
 *  1. Session paths read `req.authUser.permissions` from the WorkOS JWT — no
 *     DB lookup on the hot path. A demoted member loses access on next session
 *     refresh (≤ access-token TTL). When the claim is absent (`null`) the
 *     middleware falls back to expanding `req.user.role`; when the claim is
 *     present but empty (`[]`) it is honored verbatim (no fallback — an
 *     explicit empty grant must remain empty, or a just-demoted admin gets
 *     role-expanded permissions back).
 *  2. User-scoped API keys clamp the persisted scope set against the owner's
 *     current permissions in `workspace_user_permissions`. If the owner row is
 *     missing or `status !== "active"`, the credential is no longer usable
 *     and the request is rejected with 401, not 403.
 *  3. Bot-scoped API keys gate on the key's stored scopes only. Bots are
 *     workspace-owned in today's model; personal bots arrive in a later PR
 *     and will route through the user-key clamp path.
 */
export function createRequireWorkspacePermission({ pool }: Dependencies) {
  return function requireWorkspacePermission(slug: WorkspacePermissionSlug): RequestHandler {
    return async function handler(req: Request, _res: Response, next: NextFunction): Promise<void> {
      if (req.authUser) {
        const claim = req.authUser.permissions
        if (claim !== null) {
          if (claim.includes(slug)) {
            next()
            return
          }
        } else if (req.user) {
          const roleDerived: readonly string[] = permissionsForRole(req.user.role)
          if (roleDerived.includes(slug)) {
            next()
            return
          }
        }
      }

      if (req.userApiKey) {
        const ownerWorkosUserId = req.user?.workosUserId
        const workspaceId = req.workspaceId
        if (!ownerWorkosUserId || !workspaceId) {
          next(unauthenticated())
          return
        }

        const mirror = await WorkspaceUserPermissionsRepository.getByWorkspaceAndUser(
          pool,
          workspaceId,
          ownerWorkosUserId
        )
        if (!mirror || mirror.status !== "active") {
          next(ownerInactive())
          return
        }

        const ownerPermissions = expandRoleSlugs(mirror.roleSlugs)
        if (req.userApiKey.scopes.has(slug) && ownerPermissions.includes(slug)) {
          next()
          return
        }

        next(insufficient())
        return
      }

      if (req.botApiKey) {
        if (req.botApiKey.scopes.has(slug)) {
          next()
          return
        }
        next(insufficient())
        return
      }

      next(req.authUser ? insufficient() : unauthenticated())
    }
  }
}

export type RequireWorkspacePermission = ReturnType<typeof createRequireWorkspacePermission>
