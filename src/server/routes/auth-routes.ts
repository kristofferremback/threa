import { Router, type Request, type Response, type NextFunction } from "express"
import { AuthService } from "../services/auth-service"
import { UserService } from "../services/user-service"
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
  userService?: UserService,
): Router {
  const routes = Router()

  routes.get("/login", (req: Request, res: Response) => {
    if (req.cookies["wos_session"]) {
      logger.debug("Session cookie found, clearing for fresh login")
      res.clearCookie("wos_session")
    }

    // Support redirect URL via query param (e.g., /api/auth/login?redirect=/invite/abc123)
    const redirectTo = req.query.redirect as string | undefined
    const authorizationUrl = authService.getAuthorizationUrl(redirectTo)
    res.redirect(authorizationUrl)
  })

  routes.all("/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string
    const state = req.query.state as string | undefined

    if (!code) {
      return res.status(400).json({ error: "No code provided" })
    }

    const result = await authService.authenticateWithCode(code)

    if (result.success && result.sealedSession) {
      res.cookie("wos_session", result.sealedSession, SESSION_COOKIE_CONFIG)

      // Decode redirect URL from state if present
      let redirectUrl = "/"
      if (state) {
        try {
          const decoded = Buffer.from(state, "base64").toString("utf-8")
          // Only allow relative paths or same-origin URLs for security
          if (decoded.startsWith("/")) {
            redirectUrl = decoded
          }
        } catch {
          // Invalid state, ignore
        }
      }

      res.redirect(redirectUrl)
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
