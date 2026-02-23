import type { Request, Response, NextFunction } from "express"
import type { Pool } from "pg"
import { UserRepository, type User } from "../features/workspaces"

declare global {
  namespace Express {
    interface Request {
      workspaceId?: string
      user?: User
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

    const workosUserId = req.workosUserId
    if (!workosUserId) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    const access = await UserRepository.findWorkspaceUserAccess(pool, workspaceId, workosUserId)
    if (!access.workspaceExists) {
      return res.status(404).json({ error: "Workspace not found" })
    }

    const user = access.user
    if (!user) {
      return res.status(403).json({ error: "Not a user in this workspace" })
    }

    req.workspaceId = workspaceId
    req.user = user
    next()
  }
}
