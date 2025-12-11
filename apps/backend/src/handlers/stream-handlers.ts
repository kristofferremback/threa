import type { Request, Response } from "express"
import type { StreamService } from "../services/stream-service"
import type { WorkspaceService } from "../services/workspace-service"
import type { CompanionMode } from "../repositories"
import { DuplicateSlugError } from "../lib/errors"

interface Dependencies {
  streamService: StreamService
  workspaceService: WorkspaceService
}

export function createStreamHandlers({ streamService, workspaceService }: Dependencies) {
  return {
    async get(req: Request, res: Response) {
      const userId = req.userId!
      const { streamId } = req.params
      const stream = await streamService.getStreamById(streamId)

      if (!stream) {
        return res.status(404).json({ error: "Stream not found" })
      }

      // Access control: public streams require workspace membership,
      // private streams (scratchpads, private channels, threads) require stream membership
      if (stream.visibility === "public") {
        const isWorkspaceMember = await workspaceService.isMember(stream.workspaceId, userId)
        if (!isWorkspaceMember) {
          return res.status(403).json({ error: "Not authorized" })
        }
      } else {
        const isStreamMember = await streamService.isMember(streamId, userId)
        if (!isStreamMember) {
          // Return 404 to avoid leaking existence of private streams
          return res.status(404).json({ error: "Stream not found" })
        }
      }

      res.json({ stream })
    },

    async listScratchpads(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId } = req.params
      const isMember = await workspaceService.isMember(workspaceId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const scratchpads = await streamService.getScratchpadsByUser(workspaceId, userId)
      res.json({ streams: scratchpads })
    },

    async createScratchpad(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId } = req.params
      const { description, companionMode, companionPersonaId } = req.body

      const isMember = await workspaceService.isMember(workspaceId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const stream = await streamService.createScratchpad({
        workspaceId,
        description,
        companionMode,
        companionPersonaId,
        createdBy: userId,
      })

      res.status(201).json({ stream })
    },

    async createChannel(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId } = req.params
      const { slug, description, visibility } = req.body

      if (!slug || typeof slug !== "string") {
        return res.status(400).json({ error: "Slug is required" })
      }

      // Validate slug format (lowercase, alphanumeric, hyphens - no leading/trailing hyphens)
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
        return res
          .status(400)
          .json({ error: "Slug must be lowercase alphanumeric with hyphens (no leading/trailing hyphens)" })
      }

      const isMember = await workspaceService.isMember(workspaceId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      try {
        const stream = await streamService.createChannel({
          workspaceId,
          slug,
          description,
          visibility,
          createdBy: userId,
        })

        res.status(201).json({ stream })
      } catch (error) {
        if (error instanceof DuplicateSlugError) {
          return res.status(409).json({ error: error.message })
        }
        throw error
      }
    },

    async updateCompanionMode(req: Request, res: Response) {
      const userId = req.userId!
      const { streamId } = req.params
      const { companionMode, companionPersonaId } = req.body as {
        companionMode: CompanionMode
        companionPersonaId?: string | null
      }

      if (!companionMode || !["off", "mentions", "on"].includes(companionMode)) {
        return res.status(400).json({ error: "Valid companionMode is required (off, mentions, on)" })
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
      const userId = req.userId!
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
      const userId = req.userId!
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
      const userId = req.userId!
      const { streamId } = req.params
      const stream = await streamService.getStreamById(streamId)

      if (!stream) {
        return res.status(404).json({ error: "Stream not found" })
      }

      // For private streams, check membership first to avoid leaking existence
      if (stream.visibility !== "public") {
        const isStreamMember = await streamService.isMember(streamId, userId)
        if (!isStreamMember) {
          return res.status(404).json({ error: "Stream not found" })
        }
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
