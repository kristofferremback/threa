import type { Request, Response, NextFunction } from "express"
import type { AuthService, AuthenticatedUser, AuthSessionClaims } from "./auth-service"
import { SESSION_COOKIE_NAME, SESSION_COOKIE_CONFIG, SESSION_COOKIE_CLEAR_CONFIG } from "../cookies"

declare global {
  namespace Express {
    interface Request {
      /** WorkOS user ID from authenticated session */
      workosUserId?: string
      /** Full WorkOS identity from authenticated session */
      authUser?: AuthenticatedUser
      /** Active sealed session plus org-scoped claims from WorkOS. */
      authSession?: AuthSessionClaims & { sealedSession: string }
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
      res.clearCookie(SESSION_COOKIE_NAME, SESSION_COOKIE_CLEAR_CONFIG)
      return res.status(401).json({ error: "Session expired" })
    }

    if (result.refreshed && result.sealedSession) {
      res.cookie(SESSION_COOKIE_NAME, result.sealedSession, SESSION_COOKIE_CONFIG)
    }

    req.workosUserId = result.user.id
    req.authUser = result.user
    req.authSession = {
      sealedSession: result.sealedSession ?? session,
      organizationId: result.session?.organizationId ?? null,
      role: result.session?.role ?? null,
      roles: [...(result.session?.roles ?? [])],
      permissions: [...(result.session?.permissions ?? [])],
    }
    next()
  }
}
