import type { Request, Response } from "express"
import type { AuthService } from "../services/auth-service"
import type { UserService } from "../services/user-service"
import { SESSION_COOKIE_CONFIG } from "../lib/cookies"

const SESSION_COOKIE_NAME = "wos_session"

interface Dependencies {
  authService: AuthService
  userService: UserService
}

export function createAuthHandlers({ authService, userService }: Dependencies) {
  return {
    async login(req: Request, res: Response) {
      const redirectTo = req.query.redirect_to as string | undefined
      const url = authService.getAuthorizationUrl(redirectTo)
      res.redirect(url)
    },

    async callback(req: Request, res: Response) {
      const code = (req.query.code || req.body?.code) as string | undefined
      const state = (req.query.state || req.body?.state) as string | undefined

      if (!code) {
        return res.status(400).json({ error: "Missing authorization code" })
      }

      const result = await authService.authenticateWithCode(code)

      if (!result.success || !result.user || !result.sealedSession) {
        return res.status(401).json({ error: "Authentication failed" })
      }

      await userService.ensureUser({
        email: result.user.email,
        name:
          [result.user.firstName, result.user.lastName]
            .filter(Boolean)
            .join(" ") || result.user.email,
        workosUserId: result.user.id,
      })

      res.cookie(SESSION_COOKIE_NAME, result.sealedSession, SESSION_COOKIE_CONFIG)

      const redirectTo = state
        ? Buffer.from(state, "base64").toString("utf-8")
        : "/"

      res.redirect(redirectTo)
    },

    async logout(req: Request, res: Response) {
      const session = req.cookies[SESSION_COOKIE_NAME]

      res.clearCookie(SESSION_COOKIE_NAME, {
        path: SESSION_COOKIE_CONFIG.path,
        httpOnly: SESSION_COOKIE_CONFIG.httpOnly,
        secure: SESSION_COOKIE_CONFIG.secure,
        sameSite: SESSION_COOKIE_CONFIG.sameSite,
      })

      if (session) {
        const logoutUrl = await authService.getLogoutUrl(session)
        if (logoutUrl) {
          return res.redirect(logoutUrl)
        }
      }

      res.redirect("/")
    },

    async me(req: Request, res: Response) {
      const userId = req.userId
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const user = await userService.getUserById(userId)
      if (!user) {
        return res.status(404).json({ error: "User not found" })
      }

      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
      })
    },
  }
}
