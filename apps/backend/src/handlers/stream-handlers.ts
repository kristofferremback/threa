import type { Request, Response } from "express"
import type { StreamService } from "../services/stream-service"
import type { WorkspaceService } from "../services/workspace-service"
import type { EventService } from "../services/event-service"
import type { CompanionMode, StreamType, EventType, StreamEvent } from "../repositories"
import { DuplicateSlugError } from "../lib/errors"
import { serializeBigInt } from "../lib/serialization"

interface Dependencies {
  streamService: StreamService
  workspaceService: WorkspaceService
  eventService: EventService
}

function serializeEvent(event: StreamEvent) {
  return serializeBigInt(event)
}

export function createStreamHandlers({ streamService, workspaceService, eventService }: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId } = req.params
      const { stream_type } = req.query

      const isMember = await workspaceService.isMember(workspaceId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      // Parse stream_type query param - supports ?stream_type=scratchpad&stream_type=channel
      const types = stream_type
        ? (Array.isArray(stream_type) ? stream_type : [stream_type]) as StreamType[]
        : undefined

      const streams = await streamService.list(workspaceId, userId, { types })
      res.json({ streams })
    },

    async create(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId } = req.params
      const { type, slug, description, visibility, companionMode, companionPersonaId } = req.body

      if (!type || !["scratchpad", "channel"].includes(type)) {
        return res.status(400).json({ error: "Valid type is required (scratchpad or channel)" })
      }

      const isMember = await workspaceService.isMember(workspaceId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      // Channels require slug
      if (type === "channel") {
        if (!slug || typeof slug !== "string") {
          return res.status(400).json({ error: "Slug is required for channels" })
        }
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
          return res.status(400).json({
            error: "Slug must be lowercase alphanumeric with hyphens (no leading/trailing hyphens)",
          })
        }
      }

      try {
        const stream = await streamService.create({
          workspaceId,
          type,
          slug,
          description,
          visibility,
          companionMode,
          companionPersonaId,
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

    async get(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId, streamId } = req.params

      // First verify workspace membership
      const isWorkspaceMember = await workspaceService.isMember(workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const stream = await streamService.getStreamById(streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Stream not found" })
      }

      // For private streams, also check stream membership
      if (stream.visibility !== "public") {
        const isStreamMember = await streamService.isMember(streamId, userId)
        if (!isStreamMember) {
          return res.status(404).json({ error: "Stream not found" })
        }
      }

      res.json({ stream })
    },

    async listEvents(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId, streamId } = req.params
      const { type, limit, after } = req.query

      // Verify workspace membership
      const isWorkspaceMember = await workspaceService.isMember(workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      // Verify stream belongs to workspace and user has access
      const stream = await streamService.getStreamById(streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Stream not found" })
      }

      // Check stream membership for private streams
      if (stream.visibility !== "public") {
        const isStreamMember = await streamService.isMember(streamId, userId)
        if (!isStreamMember) {
          return res.status(404).json({ error: "Stream not found" })
        }
      }

      // Parse type filter - supports ?type=message_created&type=reaction_added
      const types = type
        ? (Array.isArray(type) ? type : [type]) as EventType[]
        : undefined

      const events = await eventService.listEvents(streamId, {
        types,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        afterSequence: after ? BigInt(after as string) : undefined,
      })

      res.json({ events: events.map(serializeEvent) })
    },

    async updateCompanionMode(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId, streamId } = req.params
      const { companionMode, companionPersonaId } = req.body as {
        companionMode: CompanionMode
        companionPersonaId?: string | null
      }

      if (!companionMode || !["off", "on", "next_message_only"].includes(companionMode)) {
        return res.status(400).json({ error: "Valid companionMode is required" })
      }

      // Verify workspace membership
      const isWorkspaceMember = await workspaceService.isMember(workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const stream = await streamService.getStreamById(streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
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
      const { workspaceId, streamId } = req.params
      const { pinned } = req.body

      if (typeof pinned !== "boolean") {
        return res.status(400).json({ error: "pinned must be a boolean" })
      }

      // Verify workspace membership
      const isWorkspaceMember = await workspaceService.isMember(workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      // Verify stream belongs to workspace
      const stream = await streamService.getStreamById(streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Stream not found" })
      }

      const membership = await streamService.pinStream(streamId, userId, pinned)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      res.json({ membership })
    },

    async mute(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId, streamId } = req.params
      const { muted } = req.body

      if (typeof muted !== "boolean") {
        return res.status(400).json({ error: "muted must be a boolean" })
      }

      // Verify workspace membership
      const isWorkspaceMember = await workspaceService.isMember(workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      // Verify stream belongs to workspace
      const stream = await streamService.getStreamById(streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Stream not found" })
      }

      const membership = await streamService.muteStream(streamId, userId, muted)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      res.json({ membership })
    },

    async archive(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId, streamId } = req.params

      // Verify workspace membership
      const isWorkspaceMember = await workspaceService.isMember(workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const stream = await streamService.getStreamById(streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
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
