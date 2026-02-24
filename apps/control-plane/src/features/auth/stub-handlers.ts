import type { Request, Response } from "express"
import { SESSION_COOKIE_CONFIG, decodeAndSanitizeRedirectState, type StubAuthService } from "@threa/backend-common"
import { renderLoginPage } from "./stub-login-page"
import type { InvitationShadowService } from "../invitation-shadows/service"

const SESSION_COOKIE_NAME = "wos_session"

interface Dependencies {
  authStubService: StubAuthService
  shadowService: InvitationShadowService
}

export function createAuthStubHandlers({ authStubService, shadowService }: Dependencies) {
  return {
    async getLoginPage(req: Request, res: Response) {
      const state = (req.query.state as string) || ""
      res.send(renderLoginPage(state))
    },

    async handleLogin(req: Request, res: Response) {
      const { email, name, state } = req.body
      const result = await authStubService.devLogin({ email, name })

      const acceptedWorkspaceIds = await shadowService.acceptPendingForUser({
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      })

      res.cookie(SESSION_COOKIE_NAME, result.session, SESSION_COOKIE_CONFIG)

      // If user was accepted into exactly one workspace, redirect to setup
      if (acceptedWorkspaceIds.length === 1) {
        return res.redirect(`/w/${acceptedWorkspaceIds[0]}/setup`)
      }

      if (state) {
        const redirectTo = decodeAndSanitizeRedirectState(state)
        return res.redirect(redirectTo)
      }
      res.redirect("/")
    },

    async handleDevLogin(req: Request, res: Response) {
      const { email, name } = req.body || {}
      const result = await authStubService.devLogin({ email, name })
      res.cookie(SESSION_COOKIE_NAME, result.session, SESSION_COOKIE_CONFIG)
      res.json({ user: result.user })
    },
  }
}
