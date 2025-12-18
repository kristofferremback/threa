import type { Request, Response, NextFunction } from "express"
import type { AuthService } from "../services/auth-service"
import type { UserService } from "../services/user-service"
import { SESSION_COOKIE_CONFIG } from "../lib/cookies"

const SESSION_COOKIE_NAME = "wos_session"

declare global {
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

interface Dependencies {
  authService: AuthService
  userService: UserService
}

export function createAuthMiddleware({ authService, userService }: Dependencies) {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const session = req.cookies[SESSION_COOKIE_NAME]

    if (!session) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    const result = await authService.authenticateSession(session)

    if (!result.success || !result.user) {
      res.clearCookie(SESSION_COOKIE_NAME)
      return res.status(401).json({ error: "Session expired" })
    }

    if (result.refreshed && result.sealedSession) {
      res.cookie(SESSION_COOKIE_NAME, result.sealedSession, SESSION_COOKIE_CONFIG)
    }

    // Try WorkOS ID first (production), fall back to internal ID (stub auth)
    let user = await userService.getUserByWorkosUserId(result.user.id)
    if (!user) {
      user = await userService.getUserById(result.user.id)
    }
    if (!user) {
      return res.status(401).json({ error: "User not found" })
    }

    req.userId = user.id
    next()
  }
}
