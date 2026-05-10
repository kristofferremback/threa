import type { NextFunction, Request, RequestHandler, Response } from "express"
import { permissionsForRole, type WorkspacePermissionSlug } from "@threa/types"
import { HttpError } from "../lib/errors"

const unauthenticated = () => new HttpError("Not authenticated", { status: 401, code: "UNAUTHENTICATED" })
const insufficient = () => new HttpError("Insufficient permissions", { status: 403, code: "FORBIDDEN" })

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
 *  2. User-scoped API keys gate on `req.userApiKey.scopes`, which
 *     `public-api-auth.ts` already clamped against the owner's current
 *     `workspace_user_permissions` row at auth time (and rejected with
 *     `OWNER_INACTIVE` if the owner row was missing or inactive). The clamp
 *     happens once per request, so this middleware never re-reads the mirror.
 *  3. Bot-scoped API keys gate on the key's stored scopes only. Bots are
 *     workspace-owned in today's model; personal bots arrive in a later PR
 *     and will route through the user-key clamp path.
 */
export function createRequireWorkspacePermission() {
  return function requireWorkspacePermission(slug: WorkspacePermissionSlug): RequestHandler {
    return function handler(req: Request, _res: Response, next: NextFunction): void {
      if (req.authUser) {
        const claim = req.authUser.permissions
        if (claim != null) {
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
        if (req.userApiKey.scopes.has(slug)) {
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
