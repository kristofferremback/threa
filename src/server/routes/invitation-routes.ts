import { Router, Request, Response, NextFunction, RequestHandler } from "express"
import { WorkspaceService } from "../services/workspace-service"
import { logger } from "../lib/logger"

export function createInvitationRoutes(
  workspaceService: WorkspaceService,
  authMiddleware?: RequestHandler,
): Router {
  const router = Router()

  // Get invitation details by token (public - no auth required)
  router.get("/:token", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.params

      const invitation = await workspaceService.getInvitationByToken(token)

      if (!invitation) {
        res.status(404).json({ error: "Invitation not found" })
        return
      }

      // Check if expired
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
  })

  // Accept invitation (requires auth)
  const acceptHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.params
      const user = req.user

      if (!user?.id || !user?.email) {
        res.status(401).json({ error: "Please log in to accept this invitation" })
        return
      }

      const result = await workspaceService.acceptInvitation(
        token,
        user.id,
        user.email,
        user.firstName,
        user.lastName,
      )

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

  if (authMiddleware) {
    router.post("/:token/accept", authMiddleware, acceptHandler)
  } else {
    router.post("/:token/accept", acceptHandler)
  }

  return router
}

