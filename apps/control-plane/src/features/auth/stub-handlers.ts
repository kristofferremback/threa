import type { Request, Response } from "express"
import {
  SESSION_COOKIE_CONFIG,
  decodeAndSanitizeRedirectState,
  withTransaction,
  logger,
  type StubAuthService,
} from "@threa/backend-common"
import { renderLoginPage } from "./stub-login-page"
import { InvitationShadowRepository } from "../invitation-shadows/repository"
import type { RegionalClient } from "../../lib/regional-client"
import { WorkspaceRegistryRepository } from "../workspaces/repository"
import type { Pool } from "pg"

const SESSION_COOKIE_NAME = "wos_session"

interface Dependencies {
  authStubService: StubAuthService
  regionalClient: RegionalClient
  pool: Pool
}

export function createAuthStubHandlers({ authStubService, regionalClient, pool }: Dependencies) {
  return {
    async getLoginPage(req: Request, res: Response) {
      const state = (req.query.state as string) || ""
      res.send(renderLoginPage(state))
    },

    async handleLogin(req: Request, res: Response) {
      const { email, name, state } = req.body
      const result = await authStubService.devLogin({ email, name })

      // Auto-accept pending invitation shadows (mirrors real callback flow).
      // Two-phase per shadow: (1) regional call (idempotent), (2) local DB transaction.
      const pendingShadows = await InvitationShadowRepository.findPendingByEmail(pool, result.user.email)
      const acceptedWorkspaceIds: string[] = []

      for (const shadow of pendingShadows) {
        try {
          await regionalClient.acceptInvitation(shadow.region, shadow.id, {
            workosUserId: result.user.id,
            email: result.user.email,
            name: result.user.name,
          })
          await withTransaction(pool, async (client) => {
            await InvitationShadowRepository.updateStatus(client, shadow.id, "accepted")
            await WorkspaceRegistryRepository.insertMembership(client, shadow.workspace_id, result.user.id)
          })
          acceptedWorkspaceIds.push(shadow.workspace_id)
        } catch (error) {
          logger.error(
            { err: error, shadowId: shadow.id, workspaceId: shadow.workspace_id },
            "Failed to auto-accept invitation shadow during stub login"
          )
        }
      }

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
