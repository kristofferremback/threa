import { z } from "zod"
import type { Request, Response } from "express"
import type { WorkspaceService } from "../services/workspace-service"

const createWorkspaceSchema = z.object({
  name: z.string().min(1, "name is required"),
})

export { createWorkspaceSchema }

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
      const workspaceId = req.workspaceId!
      const workspace = await workspaceService.getWorkspaceById(workspaceId)

      if (!workspace) {
        return res.status(404).json({ error: "Workspace not found" })
      }

      res.json({ workspace })
    },

    async create(req: Request, res: Response) {
      const userId = req.userId!

      const result = createWorkspaceSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const workspace = await workspaceService.createWorkspace({
        name: result.data.name,
        createdBy: userId,
      })

      res.status(201).json({ workspace })
    },

    async getMembers(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const members = await workspaceService.getMembers(workspaceId)
      res.json({ members })
    },
  }
}
