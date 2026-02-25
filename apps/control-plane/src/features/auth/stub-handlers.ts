import type { Request, Response } from "express"
import { z } from "zod/v4"
import {
  HttpError,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_CONFIG,
  renderLoginPage,
  type StubAuthService,
} from "@threa/backend-common"
import type { InvitationShadowService } from "../invitation-shadows/service"

const stubLoginSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
  state: z.string().optional(),
})

const devLoginSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
})

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
      const parsed = stubLoginSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid login parameters", { status: 400, code: "INVALID_LOGIN" })
      }
      const { email, name, state } = parsed.data
      const result = await authStubService.devLogin({ email, name })

      const redirectUrl = await shadowService.acceptPendingAndGetRedirect({
        user: { id: result.user.id, email: result.user.email, name: result.user.name },
        state,
      })

      res.cookie(SESSION_COOKIE_NAME, result.session, SESSION_COOKIE_CONFIG)
      res.redirect(redirectUrl)
    },

    async handleDevLogin(req: Request, res: Response) {
      const parsed = devLoginSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid login parameters", { status: 400, code: "INVALID_LOGIN" })
      }
      const result = await authStubService.devLogin(parsed.data)
      res.cookie(SESSION_COOKIE_NAME, result.session, SESSION_COOKIE_CONFIG)
      res.json({ user: result.user })
    },
  }
}
