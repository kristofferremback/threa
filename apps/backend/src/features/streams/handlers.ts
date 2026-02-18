import { z } from "zod"
import type { Request, Response } from "express"
import type { StreamService } from "./service"
import type { EventService } from "../messaging"
import type { ActivityService } from "../activity"
import type { StreamEvent } from "./event-repository"
import type { EventType, StreamType } from "@threa/types"
import { StreamTypes, SLUG_PATTERN } from "@threa/types"
import { serializeBigInt } from "../../lib/serialization"
import { HttpError } from "../../lib/errors"
import { streamTypeSchema, visibilitySchema, companionModeSchema, notificationLevelSchema } from "../../lib/schemas"

const createStreamSchema = z
  .object({
    type: streamTypeSchema.extract(["scratchpad", "channel", "thread"]),
    slug: z
      .string()
      .regex(SLUG_PATTERN, {
        message: "Slug must start with a letter and contain only lowercase letters, numbers, hyphens, or underscores",
      })
      .optional(),
    displayName: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    visibility: visibilitySchema.optional(),
    companionMode: companionModeSchema.optional(),
    companionPersonaId: z.string().optional(),
    parentStreamId: z.string().optional(),
    parentMessageId: z.string().optional(),
  })
  .refine((data) => data.type !== "channel" || data.slug, {
    message: "Slug is required for channels",
    path: ["slug"],
  })
  .refine((data) => data.type !== "thread" || (data.parentStreamId && data.parentMessageId), {
    message: "parentStreamId and parentMessageId are required for threads",
    path: ["parentStreamId"],
  })

const updateStreamSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .regex(SLUG_PATTERN, {
      message: "Slug must start with a letter and contain only lowercase letters, numbers, hyphens, or underscores",
    })
    .optional(),
  description: z.string().max(500).optional(),
  visibility: visibilitySchema.optional(),
})

const updateCompanionModeSchema = z.object({
  companionMode: companionModeSchema,
  companionPersonaId: z.string().nullable().optional(),
})

const pinSchema = z.object({
  pinned: z.boolean(),
})

const setNotificationLevelSchema = z.object({
  notificationLevel: notificationLevelSchema.nullable(),
})

const markAsReadSchema = z.object({
  lastEventId: z.string(),
})

const checkSlugAvailableSchema = z.object({
  slug: z.string().min(1, "slug query parameter is required"),
  exclude: z.string().optional(),
})

const addMemberSchema = z.object({
  memberId: z.string().min(1, "memberId is required"),
})

// Exhaustive: adding a StreamType forces a decision here
const addMemberAllowed: Record<StreamType, boolean> = {
  [StreamTypes.CHANNEL]: true,
  [StreamTypes.THREAD]: true,
  [StreamTypes.SCRATCHPAD]: false,
  [StreamTypes.DM]: false,
  [StreamTypes.SYSTEM]: false,
}

const disallowedUpdateFields: Record<StreamType, Record<string, string> | null> = {
  [StreamTypes.CHANNEL]: { displayName: "Channels cannot set displayName — use slug" },
  [StreamTypes.SCRATCHPAD]: { slug: "Scratchpads do not have slugs", visibility: "Scratchpads are always private" },
  [StreamTypes.THREAD]: {
    slug: "Threads inherit slug and visibility from parent",
    visibility: "Threads inherit slug and visibility from parent",
  },
  [StreamTypes.DM]: null,
  [StreamTypes.SYSTEM]: null,
}

function updateSchemaForType(streamType: StreamType) {
  const disallowed = disallowedUpdateFields[streamType]
  if (disallowed === null) return null

  return updateStreamSchema.superRefine((data, ctx) => {
    for (const [field, message] of Object.entries(disallowed)) {
      if (data[field as keyof typeof data] !== undefined) {
        ctx.addIssue({ code: "custom", path: [field], message })
      }
    }
  })
}

export {
  createStreamSchema,
  updateStreamSchema,
  updateCompanionModeSchema,
  pinSchema,
  setNotificationLevelSchema,
  markAsReadSchema,
}

interface Dependencies {
  streamService: StreamService
  eventService: EventService
  activityService?: ActivityService
}

function serializeEvent(event: StreamEvent) {
  return serializeBigInt(event)
}

export function createStreamHandlers({ streamService, eventService, activityService }: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { stream_type, status } = req.query

      const types = stream_type
        ? ((Array.isArray(stream_type) ? stream_type : [stream_type]) as ("scratchpad" | "channel")[])
        : undefined

      const archiveStatus = status
        ? ((Array.isArray(status) ? status : [status]) as ("active" | "archived")[])
        : undefined

      const streams = await streamService.list(workspaceId, memberId, { types, archiveStatus })
      res.json({ streams })
    },

    async create(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!

      const result = createStreamSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const {
        type,
        slug,
        displayName,
        description,
        visibility,
        companionMode,
        companionPersonaId,
        parentStreamId,
        parentMessageId,
      } = result.data

      const stream = await streamService.create({
        workspaceId,
        type,
        slug,
        displayName,
        description,
        visibility,
        companionMode,
        companionPersonaId,
        parentStreamId,
        parentMessageId,
        createdBy: memberId,
      })

      res.status(201).json({ stream })
    },

    async get(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, memberId)
      res.json({ stream })
    },

    async update(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, memberId)

      const schema = updateSchemaForType(stream.type)
      if (!schema) {
        throw new HttpError("Cannot update this stream type", { status: 403, code: "STREAM_IMMUTABLE" })
      }

      const result = schema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { displayName, slug, description, visibility } = result.data

      const updated = await streamService.updateStream(streamId, { displayName, slug, description, visibility })
      res.json({ stream: updated })
    },

    async listEvents(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params
      const { type, limit, after } = req.query

      await streamService.validateStreamAccess(streamId, workspaceId, memberId)

      const types = type ? ((Array.isArray(type) ? type : [type]) as EventType[]) : undefined

      const events = await eventService.listEvents(streamId, {
        types,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        afterSequence: after ? BigInt(after as string) : undefined,
        viewerId: memberId,
      })

      res.json({ events: events.map(serializeEvent) })
    },

    async updateCompanionMode(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = updateCompanionModeSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { companionMode, companionPersonaId } = result.data

      await streamService.validateStreamAccess(streamId, workspaceId, memberId)

      const isMember = await streamService.isMember(streamId, memberId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const updated = await streamService.updateCompanionMode(streamId, companionMode, companionPersonaId)

      res.json({ stream: updated })
    },

    async pin(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = pinSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      await streamService.validateStreamAccess(streamId, workspaceId, memberId)

      const membership = await streamService.pinStream(streamId, memberId, result.data.pinned)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      res.json({ membership })
    },

    async setNotificationLevel(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = setNotificationLevelSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      await streamService.validateStreamAccess(streamId, workspaceId, memberId)

      const membership = await streamService.setNotificationLevel(streamId, memberId, result.data.notificationLevel)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      res.json({ membership })
    },

    async markAsRead(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = markAsReadSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      await streamService.validateStreamAccess(streamId, workspaceId, memberId)

      const membership = await streamService.markAsRead(workspaceId, streamId, memberId, result.data.lastEventId)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      // Clear mention badges for this stream
      await activityService?.markStreamActivityAsRead(memberId, streamId)

      res.json({ membership })
    },

    async archive(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, memberId)

      if (stream.createdBy !== memberId) {
        return res.status(403).json({ error: "Only the creator can archive this stream" })
      }

      const archived = await streamService.archiveStream(streamId, memberId)
      res.json({ stream: archived })
    },

    async unarchive(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, memberId)

      if (stream.createdBy !== memberId) {
        return res.status(403).json({ error: "Only the creator can unarchive this stream" })
      }

      const unarchived = await streamService.unarchiveStream(streamId, memberId)
      res.json({ stream: unarchived })
    },

    async join(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const membership = await streamService.joinPublicChannel(streamId, workspaceId, memberId)
      res.json({ data: { membership } })
    },

    async bootstrap(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, memberId)

      // Fetch all data in parallel - threads with counts is a single optimized query
      const [events, members, membership, threadDataMap] = await Promise.all([
        eventService.listEvents(streamId, { limit: 50, viewerId: memberId }),
        streamService.getMembers(streamId),
        streamService.getMembership(streamId, memberId),
        streamService.getThreadsWithReplyCounts(streamId),
      ])

      const enrichedEvents = await eventService.enrichBootstrapEvents(events, threadDataMap)

      // Get the latest sequence number from the most recent event
      const latestSequence = events.length > 0 ? events[events.length - 1].sequence : "0"

      res.json({
        data: {
          stream,
          events: enrichedEvents.map(serializeEvent),
          members,
          membership,
          latestSequence: latestSequence.toString(),
        },
      })
    },

    async checkSlugAvailable(req: Request, res: Response) {
      const workspaceId = req.workspaceId!

      const result = checkSlugAvailableSchema.safeParse(req.query)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const available = await streamService.checkSlugAvailable(workspaceId, result.data.slug, result.data.exclude)
      res.json({ available })
    },

    async addMember(req: Request, res: Response) {
      const actorId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = addMemberSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, actorId)

      if (!addMemberAllowed[stream.type]) {
        throw new HttpError("Cannot add members to this stream type", { status: 400, code: "ADD_MEMBER_NOT_ALLOWED" })
      }

      const membership = await streamService.addMember(streamId, result.data.memberId, workspaceId)
      res.status(201).json({ membership })
    },

    async removeMember(req: Request, res: Response) {
      const actor = req.member!
      const workspaceId = req.workspaceId!
      const { streamId, memberId } = req.params

      if (actor.role !== "owner" && actor.role !== "admin") {
        throw new HttpError("Only workspace owners and admins can remove members", { status: 403, code: "FORBIDDEN" })
      }

      await streamService.validateStreamAccess(streamId, workspaceId, actor.id)
      await streamService.removeMember(streamId, memberId)
      res.status(204).send()
    },
  }
}
