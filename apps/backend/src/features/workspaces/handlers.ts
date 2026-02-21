import { z } from "zod"
import type { Request, Response } from "express"
import type { WorkspaceService } from "./service"
import type { StreamService } from "../streams"
import type { UserPreferencesService } from "../user-preferences"
import type { InvitationService } from "../invitations"
import type { ActivityService } from "../activity"
import type { CommandRegistry } from "../commands"
import type { AvatarService } from "./avatar-service"
import { getEmojiList } from "../emoji"
import { getEffectiveLevel } from "../streams"

const createWorkspaceSchema = z.object({
  name: z.string().min(1, "name is required"),
})

const completeUserSetupSchema = z.object({
  name: z.string().min(1, "name is required").optional(),
  slug: z.string().optional(),
  timezone: z.string().min(1, "timezone is required"),
  locale: z.string().min(1, "locale is required"),
})

const updateProfileSchema = z.object({
  name: z.string().min(1, "name is required").max(100).optional(),
  description: z.string().max(500).nullable().optional(),
})

const checkSlugAvailableSchema = z.object({
  slug: z.string().min(1, "slug query parameter is required"),
})

export { createWorkspaceSchema }

interface Dependencies {
  workspaceService: WorkspaceService
  streamService: StreamService
  userPreferencesService: UserPreferencesService
  invitationService: InvitationService
  activityService?: ActivityService
  commandRegistry: CommandRegistry
  avatarService: AvatarService
}

export function createWorkspaceHandlers({
  workspaceService,
  streamService,
  userPreferencesService,
  invitationService,
  activityService,
  commandRegistry,
  avatarService,
}: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      // Pre-workspace route: uses userId (no member context yet)
      const workosUserId = req.userId!
      const workspaces = await workspaceService.getWorkspacesByWorkosUserId(workosUserId)
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
      const workosUserId = req.userId!
      const authUser = req.authUser

      const result = createWorkspaceSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      if (!authUser) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const userName = [authUser.firstName, authUser.lastName].filter(Boolean).join(" ") || authUser.email
      const workspace = await workspaceService.createWorkspace({
        name: result.data.name,
        workosUserId,
        email: authUser.email,
        userName,
      })

      res.status(201).json({ workspace })
    },

    async getUsers(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const users = await workspaceService.getUsers(workspaceId)
      res.json({ users, members: users })
    },

    async bootstrap(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const [workspace, users, streams, personas, emojiWeights, userPreferences, dmPeers] = await Promise.all([
        workspaceService.getWorkspaceById(workspaceId),
        workspaceService.getUsers(workspaceId),
        streamService.listWithPreviews(workspaceId, userId),
        workspaceService.getPersonasForWorkspace(workspaceId),
        workspaceService.getEmojiWeights(workspaceId, userId),
        userPreferencesService.getPreferences(workspaceId, userId),
        streamService.listDmPeers(workspaceId, userId),
      ])

      if (!workspace) {
        return res.status(404).json({ error: "Workspace not found" })
      }

      // Resolve DM display names — viewer-dependent, so computed at bootstrap time
      const resolvedStreams = await streamService.resolveDmDisplayNames(streams, users, userId)

      const streamMemberships = await streamService.getMembershipsBatch(
        resolvedStreams.map((s) => s.id),
        userId
      )

      // Calculate unread counts for all streams based on memberships
      const [unreadCountsMap, activityCounts] = await Promise.all([
        streamService.getUnreadCounts(
          streamMemberships.map((m) => ({ streamId: m.streamId, lastReadEventId: m.lastReadEventId }))
        ),
        activityService?.getUnreadCounts(userId, workspaceId),
      ])
      const unreadCounts: Record<string, number> = {}
      for (const [streamId, count] of unreadCountsMap) {
        unreadCounts[streamId] = count
      }

      const mentionCounts: Record<string, number> = {}
      const activityCountsPerStream: Record<string, number> = {}
      if (activityCounts) {
        for (const [streamId, count] of activityCounts.mentionsByStream) {
          mentionCounts[streamId] = count
        }
        for (const [streamId, count] of activityCounts.totalByStream) {
          activityCountsPerStream[streamId] = count
        }
      }

      const commands = commandRegistry.getCommandNames().map((name) => {
        const cmd = commandRegistry.get(name)!
        return { name, description: cmd.description }
      })

      // Compute muted stream IDs: streams where effective notification level is "muted".
      // Uses explicit level + stream-type default (no ancestor inheritance — acceptable
      // approximation for bootstrap since ancestor-inherited mutes are rare).
      const streamTypeMap = new Map(resolvedStreams.map((s) => [s.id, s.type]))
      const mutedStreamIds = streamMemberships
        .filter((m) => {
          const type = streamTypeMap.get(m.streamId)
          return type && getEffectiveLevel(m.notificationLevel, type) === "muted"
        })
        .map((m) => m.streamId)

      // Include invitations for admin+ members
      const userRole = req.user!.role
      const isAdmin = userRole === "admin" || userRole === "owner"
      const invitations = isAdmin ? await invitationService.listInvitations(workspaceId) : undefined

      res.json({
        data: {
          workspace,
          users,
          members: users,
          streams: resolvedStreams,
          streamMemberships,
          personas,
          emojis: getEmojiList(),
          emojiWeights,
          commands,
          unreadCounts,
          mentionCounts,
          activityCounts: activityCountsPerStream,
          unreadActivityCount: activityCounts?.total ?? 0,
          mutedStreamIds,
          dmPeers,
          userPreferences,
          invitations,
        },
      })
    },

    async markAllAsRead(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const updatedStreamIds = await streamService.markAllAsRead(workspaceId, userId)

      // Clear all mention badges
      await activityService?.markAllAsRead(userId, workspaceId)

      res.json({ updatedStreamIds })
    },

    async completeUserSetup(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const result = completeUserSetupSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const user = await workspaceService.completeUserSetup(userId, workspaceId, result.data)

      res.json({ user, member: user })
    },

    async checkSlugAvailability(req: Request, res: Response) {
      const workspaceId = req.workspaceId!

      const result = checkSlugAvailableSchema.safeParse(req.query)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const available = await workspaceService.isSlugAvailable(workspaceId, result.data.slug)
      res.json({ available })
    },

    async updateProfile(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const result = updateProfileSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const user = await workspaceService.updateUserProfile(userId, workspaceId, result.data)
      res.json({ user, member: user })
    },

    async uploadAvatar(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      if (!req.file?.buffer) {
        return res.status(400).json({ error: "No file uploaded" })
      }

      const user = await workspaceService.uploadAvatar(userId, workspaceId, req.file.buffer)
      res.json({ user, member: user })
    },

    async removeAvatar(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const user = await workspaceService.removeUserAvatar(userId, workspaceId)
      res.json({ user, member: user })
    },

    async serveAvatarFile(req: Request, res: Response) {
      const { workspaceId, userId, file } = req.params
      if (!workspaceId || !userId || !file) {
        return res.status(404).end()
      }

      try {
        const stream = await avatarService.streamAvatarFile({ workspaceId, memberId: userId, file })
        if (!stream) return res.status(404).end()

        res.set("Content-Type", "image/webp")
        res.set("Cache-Control", "public, max-age=31536000, immutable")
        stream.on("error", () => {
          if (!res.headersSent) {
            res.status(500).end()
          } else {
            res.end()
          }
        })
        stream.pipe(res)
      } catch {
        res.status(404).end()
      }
    },
  }
}
