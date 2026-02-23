import type { Request, Response } from "express"
import {
  HttpError,
  SESSION_COOKIE_CONFIG,
  decodeAndSanitizeRedirectState,
  displayNameFromWorkos,
  logger,
  type AuthService,
} from "@threa/backend-common"
import type { InvitationShadowService } from "../invitation-shadows/service"
import type { RegionalClient } from "../../lib/regional-client"
import { WorkspaceRegistryRepository } from "../workspaces/repository"
import type { Pool } from "pg"

const SESSION_COOKIE_NAME = "wos_session"

interface Dependencies {
  authService: AuthService
  shadowService: InvitationShadowService
  regionalClient: RegionalClient
  pool: Pool
}

export function createControlPlaneAuthHandlers({ authService, shadowService, regionalClient, pool }: Dependencies) {
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

      const name = displayNameFromWorkos(result.user)

      // Auto-accept pending invitation shadows
      const pendingShadows = await shadowService.findPendingByEmail(result.user.email)
      const acceptedWorkspaceIds: string[] = []

      for (const shadow of pendingShadows) {
        try {
          await regionalClient.acceptInvitation(shadow.region, shadow.id, {
            workosUserId: result.user.id,
            email: result.user.email,
            name,
          })
          await shadowService.updateStatus(shadow.id, "accepted")
          await WorkspaceRegistryRepository.insertMembership(pool, shadow.workspace_id, result.user.id)
          acceptedWorkspaceIds.push(shadow.workspace_id)
        } catch (error) {
          logger.error(
            { err: error, shadowId: shadow.id, workspaceId: shadow.workspace_id },
            "Failed to auto-accept invitation shadow"
          )
        }
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
