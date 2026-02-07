import type { Request, Response, NextFunction, RequestHandler } from "express"
import type { Pool } from "pg"
import { MemberRepository, type Member } from "../repositories/member-repository"
import { WorkspaceRepository } from "../repositories/workspace-repository"

type MemberRole = Member["role"]

const ROLE_HIERARCHY: Record<MemberRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
}

/**
 * Requires the authenticated member to have at least the given role.
 * Must be used after workspaceMember middleware (which sets req.member).
 */
export function requireRole(minimumRole: MemberRole): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const member = req.member
    if (!member) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    if (ROLE_HIERARCHY[member.role] < ROLE_HIERARCHY[minimumRole]) {
      return res.status(403).json({ error: "Insufficient permissions" })
    }

    next()
  }
}

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
