import type { Request, Response, NextFunction } from "express"
import type { AuthService } from "./auth-service"
import { SESSION_COOKIE_NAME, clearSessionCookie, setSessionCookie } from "../cookies"

interface AuthenticatedUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

declare global {
  namespace Express {
    interface Request {
      /** WorkOS user ID from authenticated session */
      workosUserId?: string
      /** Full WorkOS identity from authenticated session */
      authUser?: AuthenticatedUser
      /**
       * Workspace permissions claim from the WorkOS session JWT. Empty when
       * the token predates the rollout. Phase 2 PR-2 surfaces this for
       * downstream `requireWorkspacePermission` (PR-3); nothing reads it yet.
       */
      workosPermissions?: Set<string>
    }
  }
}

interface Dependencies {
  authService: AuthService
}

export function createAuthMiddleware({ authService }: Dependencies) {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const session = req.cookies[SESSION_COOKIE_NAME]

    if (!session) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    const result = await authService.authenticateSession(session)

    if (!result.success || !result.user) {
      clearSessionCookie(res)
      return res.status(401).json({ error: "Session expired" })
    }

    if (result.refreshed && result.sealedSession) {
      setSessionCookie(res, result.sealedSession)
    }

    req.workosUserId = result.user.id
    req.authUser = result.user
    req.workosPermissions = new Set(result.user.permissions)
    next()
  }
}
