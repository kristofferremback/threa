import { z } from "zod"
import type { Request, Response } from "express"
import type { WorkspaceService } from "./service"
import type { StreamService } from "../streams"
import type { UserPreferencesService } from "../user-preferences"
import type { CommandRegistry } from "../commands"
import { getEmojiList } from "../emoji"

const createWorkspaceSchema = z.object({
  name: z.string().min(1, "name is required"),
})

export { createWorkspaceSchema }

interface Dependencies {
  workspaceService: WorkspaceService
  streamService: StreamService
  userPreferencesService: UserPreferencesService
  commandRegistry: CommandRegistry
}

export function createWorkspaceHandlers({
  workspaceService,
  streamService,
  userPreferencesService,
  commandRegistry,
}: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      // Pre-workspace route: uses userId (no member context yet)
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
      // Pre-workspace route: uses userId (no member context yet)
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
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!

      const [workspace, members, streams, personas, emojiWeights, userPreferences] = await Promise.all([
        workspaceService.getWorkspaceById(workspaceId),
        workspaceService.getMembers(workspaceId),
        streamService.listWithPreviews(workspaceId, memberId),
        workspaceService.getPersonasForWorkspace(workspaceId),
        workspaceService.getEmojiWeights(workspaceId, memberId),
        userPreferencesService.getPreferences(workspaceId, memberId),
      ])

      if (!workspace) {
        return res.status(404).json({ error: "Workspace not found" })
      }

      const [streamMemberships, users] = await Promise.all([
        streamService.getMembershipsBatch(
          streams.map((s) => s.id),
          memberId
        ),
        workspaceService.getUsersForMembers(members),
      ])

      // Calculate unread counts for all streams based on memberships
      const unreadCountsMap = await streamService.getUnreadCounts(
        streamMemberships.map((m) => ({ streamId: m.streamId, lastReadEventId: m.lastReadEventId }))
      )
      const unreadCounts: Record<string, number> = {}
      for (const [streamId, count] of unreadCountsMap) {
        unreadCounts[streamId] = count
      }

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
          emojiWeights,
          commands,
          unreadCounts,
          userPreferences,
        },
      })
    },

    async markAllAsRead(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!

      const updatedStreamIds = await streamService.markAllAsRead(workspaceId, memberId)

      res.json({ updatedStreamIds })
    },
  }
}
