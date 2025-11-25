import { Router, type Request, type Response, type NextFunction } from "express"
import { AuthService } from "../services/auth-service"
import { SESSION_COOKIE_CONFIG } from "../lib/cookies"
import { logger } from "../lib/logger"
import { User } from "@workos-inc/node"

export function createAuthMiddleware(
  authService: AuthService,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction) => {
    const sealedSession = req.cookies["wos_session"]

    const result = await authService.authenticateSession(sealedSession || "")

    if (result.success && result.user) {
      // If session was refreshed, update the cookie
      if (result.refreshed && result.sealedSession) {
        res.cookie("wos_session", result.sealedSession, SESSION_COOKIE_CONFIG)
      }

      // @ts-expect-error - user is not typed in express request
      req.user = result.user
      return next()
    }

    // Authentication failed
    logger.debug({ reason: result.reason }, "Session authentication failed, redirecting to login")
    res.clearCookie("wos_session")
    return res.redirect("/api/auth/login")
  }
}

export function createAuthRoutes(
  authService: AuthService,
  authMiddleware: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): Router {
  const routes = Router()

  routes.get("/login", (req: Request, res: Response) => {
    if (req.cookies["wos_session"]) {
      logger.debug("Session cookie found, clearing for fresh login")
      res.clearCookie("wos_session")
    }

    const authorizationUrl = authService.getAuthorizationUrl()
    res.redirect(authorizationUrl)
  })

  routes.all("/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string

    if (!code) {
      return res.status(400).json({ error: "No code provided" })
    }

    const result = await authService.authenticateWithCode(code)

    if (result.success && result.sealedSession) {
      res.cookie("wos_session", result.sealedSession, SESSION_COOKIE_CONFIG)
      res.redirect("/")
    } else {
      logger.error({ reason: result.reason }, "Authentication failed")
      res.status(401).json({ error: "Authentication failed" })
    }
  })

  routes.get("/logout", async (req: Request, res: Response) => {
    const sealedSession = req.cookies["wos_session"]
    if (!sealedSession) {
      return res.status(400).json({ error: "No session found" })
    }

    const logoutUrl = await authService.getLogoutUrl(sealedSession)
    res.clearCookie("wos_session")

    if (logoutUrl) {
      res.redirect(logoutUrl)
    } else {
      res.status(500).json({ error: "Failed to get logout URL" })
    }
  })

  routes.get("/me", authMiddleware, async (req: Request, res: Response) => {
    const user = req.user as User

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    res.json(user)
  })

  return routes
}
