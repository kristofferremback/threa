import type { RequestHandler } from "express"
import { WorkspaceService } from "../services/workspace-service"
import { logger } from "../lib/logger"

export interface InvitationDeps {
  workspaceService: WorkspaceService
}

export function createInvitationHandlers({ workspaceService }: InvitationDeps) {
  const getInvitation: RequestHandler = async (req, res, next) => {
    try {
      const { token } = req.params

      const invitation = await workspaceService.getInvitationByToken(token)

      if (!invitation) {
        res.status(404).json({ error: "Invitation not found" })
        return
      }

      if (new Date(invitation.expiresAt) < new Date()) {
        res.json({
          ...invitation,
          status: "expired",
        })
        return
      }

      res.json(invitation)
    } catch (error) {
      logger.error({ err: error }, "Failed to get invitation")
      next(error)
    }
  }

  const acceptInvitation: RequestHandler = async (req, res, next) => {
    try {
      const { token } = req.params
      const user = req.user

      if (!user?.id || !user?.email) {
        res.status(401).json({ error: "Please log in to accept this invitation" })
        return
      }

      const result = await workspaceService.acceptInvitation(token, user.id, user.email, user.firstName, user.lastName)

      res.json({
        success: true,
        workspaceId: result.workspaceId,
        message: "Invitation accepted! You are now a member of the workspace.",
      })
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        res.status(404).json({ error: error.message })
        return
      }
      if (error.message?.includes("expired")) {
        res.status(410).json({ error: error.message })
        return
      }
      if (error.message?.includes("different email")) {
        res.status(403).json({ error: error.message })
        return
      }
      if (error.message?.includes("already been")) {
        res.status(409).json({ error: error.message })
        return
      }
      if (error.message?.includes("seat limit")) {
        res.status(403).json({ error: error.message })
        return
      }
      logger.error({ err: error }, "Failed to accept invitation")
      next(error)
    }
  }

  return { getInvitation, acceptInvitation }
}
