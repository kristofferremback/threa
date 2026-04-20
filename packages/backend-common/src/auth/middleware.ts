import type { Request, Response, NextFunction } from "express"
import type { AuthService } from "./auth-service"
import { SESSION_COOKIE_NAME, SESSION_COOKIE_CONFIG } from "../cookies"

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
      // Pass domain/path from SESSION_COOKIE_CONFIG so the browser actually
      // drops the cookie when COOKIE_DOMAIN is set — clearCookie needs the
      // same attributes that set it.
      const { maxAge: _, ...clearOpts } = SESSION_COOKIE_CONFIG
      res.clearCookie(SESSION_COOKIE_NAME, clearOpts)
      return res.status(401).json({ error: "Session expired" })
    }

    if (result.refreshed && result.sealedSession) {
      res.cookie(SESSION_COOKIE_NAME, result.sealedSession, SESSION_COOKIE_CONFIG)
    }

    req.workosUserId = result.user.id
    req.authUser = result.user
    next()
  }
}
