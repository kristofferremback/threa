import type { Request, Response } from "express"
import { z } from "zod/v4"
import {
  HttpError,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_CONFIG,
  displayNameFromWorkos,
  type AuthService,
} from "@threa/backend-common"
import type { InvitationShadowService } from "../invitation-shadows/service"

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
})

interface Dependencies {
  authService: AuthService
  shadowService: InvitationShadowService
}

export function createControlPlaneAuthHandlers({ authService, shadowService }: Dependencies) {
  return {
    async login(req: Request, res: Response) {
      const redirectTo = req.query.redirect_to as string | undefined
      const url = authService.getAuthorizationUrl(redirectTo)
      res.redirect(url)
    },

    async callback(req: Request, res: Response) {
      const raw = { code: req.query.code || req.body?.code, state: req.query.state || req.body?.state }
      const parsed = callbackSchema.safeParse(raw)
      if (!parsed.success) {
        throw new HttpError("Missing or invalid authorization code", { status: 400, code: "INVALID_CALLBACK" })
      }

      const { code, state } = parsed.data
      const result = await authService.authenticateWithCode(code)

      if (!result.success || !result.user || !result.sealedSession) {
        throw new HttpError("Authentication failed", { status: 401, code: "AUTH_FAILED" })
      }

      const user = result.user

      const redirectUrl = await shadowService.acceptPendingAndGetRedirect({
        user,
        state,
      })

      res.cookie(SESSION_COOKIE_NAME, result.sealedSession, SESSION_COOKIE_CONFIG)
      res.redirect(redirectUrl)
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
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }

      const name = displayNameFromWorkos(authUser)
      res.json({
        id: authUser.id,
        email: authUser.email,
        name,
      })
    },
  }
}
