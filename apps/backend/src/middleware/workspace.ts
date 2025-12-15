import type { Request, Response, NextFunction } from "express"
import type { WorkspaceService } from "../services/workspace-service"

declare global {
  namespace Express {
    interface Request {
      workspaceId?: string
    }
  }
}

interface Dependencies {
  workspaceService: WorkspaceService
}

export function createWorkspaceMemberMiddleware({ workspaceService }: Dependencies) {
  return async function workspaceMemberMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const { workspaceId } = req.params

    if (!workspaceId) {
      return next()
    }

    const userId = req.userId
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    const workspace = await workspaceService.getWorkspaceById(workspaceId)
    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" })
    }

    const isMember = await workspaceService.isMember(workspaceId, userId)
    if (!isMember) {
      return res.status(403).json({ error: "Not a member of this workspace" })
    }

    req.workspaceId = workspaceId
    next()
  }
}
