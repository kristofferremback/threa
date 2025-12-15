import { z } from "zod"
import type { Request, Response } from "express"
import type { StreamService } from "../services/stream-service"
import type { EventService } from "../services/event-service"
import type { EventType, StreamEvent } from "../repositories"
import { DuplicateSlugError, StreamNotFoundError } from "../lib/errors"
import { serializeBigInt } from "../lib/serialization"

const createStreamSchema = z.object({
  type: z.enum(["scratchpad", "channel"]),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: "Slug must be lowercase alphanumeric with hyphens (no leading/trailing hyphens)",
  }).optional(),
  description: z.string().optional(),
  visibility: z.enum(["public", "private"]).optional(),
  companionMode: z.enum(["off", "on", "next_message_only"]).optional(),
  companionPersonaId: z.string().optional(),
}).refine(
  (data) => data.type !== "channel" || data.slug,
  { message: "Slug is required for channels", path: ["slug"] },
)

const updateCompanionModeSchema = z.object({
  companionMode: z.enum(["off", "on", "next_message_only"]),
  companionPersonaId: z.string().nullable().optional(),
})

const pinSchema = z.object({
  pinned: z.boolean(),
})

const muteSchema = z.object({
  muted: z.boolean(),
})

export { createStreamSchema, updateCompanionModeSchema, pinSchema, muteSchema }

interface Dependencies {
  streamService: StreamService
  eventService: EventService
}

function serializeEvent(event: StreamEvent) {
  return serializeBigInt(event)
}

export function createStreamHandlers({ streamService, eventService }: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!
      const { stream_type } = req.query

      const types = stream_type
        ? (Array.isArray(stream_type) ? stream_type : [stream_type]) as ("scratchpad" | "channel")[]
        : undefined

      const streams = await streamService.list(workspaceId, userId, { types })
      res.json({ streams })
    },

    async create(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!

      const result = createStreamSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: result.error.flatten().fieldErrors,
        })
      }

      const { type, slug, description, visibility, companionMode, companionPersonaId } = result.data

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
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      try {
        const stream = await streamService.validateStreamAccess(streamId, workspaceId, userId)
        res.json({ stream })
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return res.status(404).json({ error: "Stream not found" })
        }
        throw error
      }
    },

    async listEvents(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!
      const { streamId } = req.params
      const { type, limit, after } = req.query

      try {
        await streamService.validateStreamAccess(streamId, workspaceId, userId)
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return res.status(404).json({ error: "Stream not found" })
        }
        throw error
      }

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
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = updateCompanionModeSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: result.error.flatten().fieldErrors,
        })
      }

      const { companionMode, companionPersonaId } = result.data

      try {
        await streamService.validateStreamAccess(streamId, workspaceId, userId)
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return res.status(404).json({ error: "Stream not found" })
        }
        throw error
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
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = pinSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: result.error.flatten().fieldErrors,
        })
      }

      try {
        await streamService.validateStreamAccess(streamId, workspaceId, userId)
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return res.status(404).json({ error: "Stream not found" })
        }
        throw error
      }

      const membership = await streamService.pinStream(streamId, userId, result.data.pinned)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      res.json({ membership })
    },

    async mute(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = muteSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: result.error.flatten().fieldErrors,
        })
      }

      try {
        await streamService.validateStreamAccess(streamId, workspaceId, userId)
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return res.status(404).json({ error: "Stream not found" })
        }
        throw error
      }

      const membership = await streamService.muteStream(streamId, userId, result.data.muted)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      res.json({ membership })
    },

    async archive(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      let stream
      try {
        stream = await streamService.validateStreamAccess(streamId, workspaceId, userId)
      } catch (error) {
        if (error instanceof StreamNotFoundError) {
          return res.status(404).json({ error: "Stream not found" })
        }
        throw error
      }

      if (stream.createdBy !== userId) {
        return res.status(403).json({ error: "Only the creator can archive this stream" })
      }

      const archived = await streamService.archiveStream(streamId)
      res.json({ stream: archived })
    },
  }
}
