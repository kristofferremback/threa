import type { Request, Response, NextFunction, RequestHandler } from "express"
import { type AuthService } from "../services/auth-service"
import { SESSION_COOKIE_CONFIG } from "../lib/cookies"
import { logger } from "../lib/logger"
import { User } from "@workos-inc/node"

export interface AuthDeps {
  authService: AuthService
}

export function createAuthMiddleware(
  authService: AuthService,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction) => {
    const sealedSession = req.cookies["wos_session"]

    const result = await authService.authenticateSession(sealedSession || "")

    if (result.success && result.user) {
      if (result.refreshed && result.sealedSession) {
        res.cookie("wos_session", result.sealedSession, SESSION_COOKIE_CONFIG)
      }

      // @ts-expect-error - user is not typed in express request
      req.user = result.user
      return next()
    }

    logger.debug({ reason: result.reason }, "Session authentication failed, redirecting to login")
    res.clearCookie("wos_session")
    return res.redirect("/api/auth/login")
  }
}

export function createAuthHandlers({ authService }: AuthDeps) {
  const login: RequestHandler = (req, res) => {
    if (req.cookies["wos_session"]) {
      logger.debug("Session cookie found, clearing for fresh login")
      res.clearCookie("wos_session")
    }

    const redirectTo = req.query.redirect as string | undefined
    const authorizationUrl = authService.getAuthorizationUrl(redirectTo)
    res.redirect(authorizationUrl)
  }

  const callback: RequestHandler = async (req, res) => {
    const code = req.query.code as string
    const state = req.query.state as string | undefined

    if (!code) {
      res.status(400).json({ error: "No code provided" })
      return
    }

    const result = await authService.authenticateWithCode(code)

    if (result.success && result.sealedSession) {
      res.cookie("wos_session", result.sealedSession, SESSION_COOKIE_CONFIG)

      let redirectUrl = "/"
      if (state) {
        try {
          const decoded = Buffer.from(state, "base64").toString("utf-8")
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
  }

  const logout: RequestHandler = async (req, res) => {
    const sealedSession = req.cookies["wos_session"]
    if (!sealedSession) {
      res.status(400).json({ error: "No session found" })
      return
    }

    const logoutUrl = await authService.getLogoutUrl(sealedSession)
    res.clearCookie("wos_session")

    if (logoutUrl) {
      res.redirect(logoutUrl)
    } else {
      res.status(500).json({ error: "Failed to get logout URL" })
    }
  }

  const me: RequestHandler = async (req, res) => {
    const user = req.user as User

    if (!user) {
      res.status(401).json({ error: "Not authenticated" })
      return
    }

    res.json(user)
  }

  return { login, callback, logout, me }
}
