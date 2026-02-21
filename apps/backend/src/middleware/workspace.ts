import type { Request, Response, NextFunction } from "express"
import type { Pool } from "pg"
import { UserRepository, type User, WorkspaceRepository } from "../features/workspaces"

declare global {
  namespace Express {
    interface Request {
      workspaceId?: string
      user?: User
      // Backward-compatible alias while call sites migrate.
      member?: User
    }
  }
}

interface Dependencies {
  pool: Pool
}

export function createWorkspaceUserMiddleware({ pool }: Dependencies) {
  return async function workspaceUserMiddleware(req: Request, res: Response, next: NextFunction) {
    const { workspaceId } = req.params

    if (!workspaceId) {
      return next()
    }

    const workosUserId = req.userId
    if (!workosUserId) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    const workspace = await WorkspaceRepository.findById(pool, workspaceId)
    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" })
    }

    const user = await UserRepository.findByWorkosUserIdInWorkspace(pool, workspaceId, workosUserId)
    if (!user) {
      return res.status(403).json({ error: "Not a member of this workspace" })
    }

    req.workspaceId = workspaceId
    req.user = user
    req.member = user
    next()
  }
}

// Backward-compatible alias while imports migrate.
export const createWorkspaceMemberMiddleware = createWorkspaceUserMiddleware
