import type { Request, Response } from "express"
import type { WorkspaceService } from "../services/workspace-service"

interface Dependencies {
  workspaceService: WorkspaceService
}

export function createWorkspaceHandlers({ workspaceService }: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      const userId = req.userId!
      const workspaces = await workspaceService.getWorkspacesByUserId(userId)
      res.json({ workspaces })
    },

    async get(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId } = req.params
      const workspace = await workspaceService.getWorkspaceById(workspaceId)

      if (!workspace) {
        return res.status(404).json({ error: "Workspace not found" })
      }

      const isMember = await workspaceService.isMember(workspaceId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      res.json({ workspace })
    },

    async create(req: Request, res: Response) {
      const userId = req.userId!
      const { name } = req.body
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Name is required" })
      }

      const workspace = await workspaceService.createWorkspace({
        name,
        createdBy: userId,
      })

      res.status(201).json({ workspace })
    },

    async getMembers(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId } = req.params
      const isMember = await workspaceService.isMember(workspaceId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const members = await workspaceService.getMembers(workspaceId)
      res.json({ members })
    },
  }
}
