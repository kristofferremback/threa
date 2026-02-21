import type { Request, Response } from "express"
import type { AuthService } from "./auth-service"
import type { InvitationService } from "../features/invitations"
import { SESSION_COOKIE_CONFIG } from "../lib/cookies"
import { decodeAndSanitizeRedirectState } from "./redirect"
import { logger } from "../lib/logger"

const SESSION_COOKIE_NAME = "wos_session"

interface Dependencies {
  authService: AuthService
  invitationService: InvitationService
}

export function createAuthHandlers({ authService, invitationService }: Dependencies) {
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

      const name = [result.user.firstName, result.user.lastName].filter(Boolean).join(" ") || result.user.email

      // Auto-accept any pending invitations for this email
      const { accepted: acceptedWorkspaceIds, failed } = await invitationService.acceptPendingForEmail(
        result.user.email,
        {
          workosUserId: result.user.id,
          email: result.user.email,
          name,
        }
      )

      if (failed.length > 0) {
        logger.warn(
          { workosUserId: result.user.id, email: result.user.email, failedCount: failed.length },
          "Some invitations failed to auto-accept during login"
        )
      }

      res.cookie(SESSION_COOKIE_NAME, result.sealedSession, SESSION_COOKIE_CONFIG)

      // If user was accepted into exactly one workspace, redirect to setup
      if (acceptedWorkspaceIds.length === 1) {
        return res.redirect(`/w/${acceptedWorkspaceIds[0]}/setup`)
      }

      const redirectTo = decodeAndSanitizeRedirectState(state)

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
      const authUser = req.authUser
      if (!authUser) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const name = [authUser.firstName, authUser.lastName].filter(Boolean).join(" ") || authUser.email
      res.json({
        id: authUser.id,
        email: authUser.email,
        name,
      })
    },
  }
}
