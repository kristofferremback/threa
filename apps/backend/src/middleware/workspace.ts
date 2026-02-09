import type { Request, Response, NextFunction } from "express"
import type { Pool } from "pg"
import { MemberRepository, type Member, WorkspaceRepository } from "../features/workspaces"

declare global {
  namespace Express {
    interface Request {
      workspaceId?: string
      member?: Member
    }
  }
}

interface Dependencies {
  pool: Pool
}

export function createWorkspaceMemberMiddleware({ pool }: Dependencies) {
  return async function workspaceMemberMiddleware(req: Request, res: Response, next: NextFunction) {
    const { workspaceId } = req.params

    if (!workspaceId) {
      return next()
    }

    const userId = req.userId
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    const workspace = await WorkspaceRepository.findById(pool, workspaceId)
    if (!workspace) {
      return res.status(404).json({ error: "Workspace not found" })
    }

    const member = await MemberRepository.findByUserIdInWorkspace(pool, workspaceId, userId)
    if (!member) {
      return res.status(403).json({ error: "Not a member of this workspace" })
    }

    req.workspaceId = workspaceId
    req.member = member
    next()
  }
}
