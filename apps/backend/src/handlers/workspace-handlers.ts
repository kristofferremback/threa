import { z } from "zod"
import type { Request, Response } from "express"
import type { WorkspaceService } from "../services/workspace-service"
import type { StreamService } from "../services/stream-service"
import type { CommandRegistry } from "../commands"
import { getEmojiList } from "../lib/emoji"

const createWorkspaceSchema = z.object({
  name: z.string().min(1, "name is required"),
})

export { createWorkspaceSchema }

interface Dependencies {
  workspaceService: WorkspaceService
  streamService: StreamService
  commandRegistry: CommandRegistry
}

export function createWorkspaceHandlers({ workspaceService, streamService, commandRegistry }: Dependencies) {
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

    async bootstrap(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!

      const [workspace, members, streams, personas] = await Promise.all([
        workspaceService.getWorkspaceById(workspaceId),
        workspaceService.getMembers(workspaceId),
        streamService.list(workspaceId, userId),
        workspaceService.getPersonasForWorkspace(workspaceId),
      ])

      if (!workspace) {
        return res.status(404).json({ error: "Workspace not found" })
      }

      const [streamMemberships, users] = await Promise.all([
        streamService.getMembershipsBatch(
          streams.map((s) => s.id),
          userId
        ),
        workspaceService.getUsersForMembers(members),
      ])

      const commands = commandRegistry.getCommandNames().map((name) => {
        const cmd = commandRegistry.get(name)!
        return { name, description: cmd.description }
      })

      res.json({
        data: {
          workspace,
          members,
          streams,
          streamMemberships,
          users,
          personas,
          emojis: getEmojiList(),
          commands,
        },
      })
    },
  }
}
