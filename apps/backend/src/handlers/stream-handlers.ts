import type { Request, Response } from "express"
import type { StreamService } from "../services/stream-service"
import type { WorkspaceService } from "../services/workspace-service"
import type { CompanionMode } from "../repositories"

interface Dependencies {
  streamService: StreamService
  workspaceService: WorkspaceService
}

export function createStreamHandlers({ streamService, workspaceService }: Dependencies) {
  return {
    async get(req: Request, res: Response) {
      const userId = req.userId
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const { streamId } = req.params
      const stream = await streamService.getStreamById(streamId)

      if (!stream) {
        return res.status(404).json({ error: "Stream not found" })
      }

      // Check access via workspace or stream membership
      const isWorkspaceMember = await workspaceService.isMember(stream.workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not authorized" })
      }

      res.json({ stream })
    },

    async listScratchpads(req: Request, res: Response) {
      const userId = req.userId
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const { workspaceId } = req.params
      const isMember = await workspaceService.isMember(workspaceId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const scratchpads = await streamService.getScratchpadsByUser(workspaceId, userId)
      res.json({ streams: scratchpads })
    },

    async createScratchpad(req: Request, res: Response) {
      const userId = req.userId
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const { workspaceId } = req.params
      const { name, description, companionMode, companionPersonaId } = req.body

      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Name is required" })
      }

      const isMember = await workspaceService.isMember(workspaceId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const stream = await streamService.createScratchpad({
        workspaceId,
        name,
        description,
        companionMode,
        companionPersonaId,
        createdBy: userId,
      })

      res.status(201).json({ stream })
    },

    async createChannel(req: Request, res: Response) {
      const userId = req.userId
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const { workspaceId } = req.params
      const { name, description, visibility } = req.body

      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Name is required" })
      }

      const isMember = await workspaceService.isMember(workspaceId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const stream = await streamService.createChannel({
        workspaceId,
        name,
        description,
        visibility,
        createdBy: userId,
      })

      res.status(201).json({ stream })
    },

    async updateCompanionMode(req: Request, res: Response) {
      const userId = req.userId
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const { streamId } = req.params
      const { companionMode, companionPersonaId } = req.body as {
        companionMode: CompanionMode
        companionPersonaId?: string | null
      }

      if (!companionMode || !["off", "on", "next_message_only"].includes(companionMode)) {
        return res.status(400).json({ error: "Valid companionMode is required" })
      }

      const stream = await streamService.getStreamById(streamId)
      if (!stream) {
        return res.status(404).json({ error: "Stream not found" })
      }

      const isMember = await streamService.isMember(streamId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const updated = await streamService.updateCompanionMode(
        streamId,
        companionMode,
        companionPersonaId,
      )

      res.json({ stream: updated })
    },

    async pin(req: Request, res: Response) {
      const userId = req.userId
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const { streamId } = req.params
      const { pinned } = req.body

      if (typeof pinned !== "boolean") {
        return res.status(400).json({ error: "pinned must be a boolean" })
      }

      const membership = await streamService.pinStream(streamId, userId, pinned)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      res.json({ membership })
    },

    async mute(req: Request, res: Response) {
      const userId = req.userId
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const { streamId } = req.params
      const { muted } = req.body

      if (typeof muted !== "boolean") {
        return res.status(400).json({ error: "muted must be a boolean" })
      }

      const membership = await streamService.muteStream(streamId, userId, muted)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      res.json({ membership })
    },

    async archive(req: Request, res: Response) {
      const userId = req.userId
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" })
      }

      const { streamId } = req.params
      const stream = await streamService.getStreamById(streamId)

      if (!stream) {
        return res.status(404).json({ error: "Stream not found" })
      }

      // Only creator can archive (for now)
      if (stream.createdBy !== userId) {
        return res.status(403).json({ error: "Only the creator can archive this stream" })
      }

      const archived = await streamService.archiveStream(streamId)
      res.json({ stream: archived })
    },
  }
}
