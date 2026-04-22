import { z } from "zod"
import type { Request, Response } from "express"
import type { StreamService } from "./service"
import type { EventService } from "../messaging"
import type { ActivityService } from "../activity"
import type { LinkPreviewService } from "../link-previews"
import type { StreamEvent } from "./event-repository"
import type { EventType, LinkPreviewSummary, StreamType, ContextIntent, ContextRefKind } from "@threa/types"
import { StreamTypes, SLUG_PATTERN, ContextIntents, ContextRefKinds, CompanionModes } from "@threa/types"
import type { Pool } from "pg"
import { PersonaRepository, getResolver } from "../agents"
import { serializeBigInt } from "@threa/backend-common"
import { HttpError } from "../../lib/errors"
import { streamTypeSchema, visibilitySchema, companionModeSchema, notificationLevelSchema } from "../../lib/schemas"

// Typed narrowings for the Zod enum: keep the parsed value as the concrete
// union (`ContextIntent` / `ContextRefKind`) instead of a bare `string` so
// downstream code doesn't have to re-cast at every call site.
const contextIntentSchema = z.enum(Object.values(ContextIntents) as [ContextIntent, ...ContextIntent[]])
const contextRefKindSchema = z.enum(Object.values(ContextRefKinds) as [ContextRefKind, ...ContextRefKind[]])

const contextBagSchema = z.object({
  intent: contextIntentSchema,
  refs: z
    .array(
      z.object({
        kind: contextRefKindSchema,
        streamId: z.string().min(1),
        fromMessageId: z.string().optional(),
        toMessageId: z.string().optional(),
      })
    )
    .min(1)
    .max(10),
})

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
    memberIds: z.array(z.string().min(1)).max(50).optional(),
    /**
     * Optional context-bag attached at creation time. Powers "Discuss with
     * Ariadne": when present on a scratchpad, the orientation handler fires
     * a kickoff message that has the referenced context pre-loaded.
     */
    contextBag: contextBagSchema.optional(),
  })
  .refine((data) => data.type !== "channel" || data.slug, {
    message: "Slug is required for channels",
    path: ["slug"],
  })
  .refine((data) => data.type !== "thread" || (data.parentStreamId && data.parentMessageId), {
    message: "parentStreamId and parentMessageId are required for threads",
    path: ["parentStreamId"],
  })
  .refine((data) => !data.contextBag || data.type === "scratchpad", {
    message: "contextBag is only supported on scratchpad creation",
    path: ["contextBag"],
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

/** Default number of events returned in bootstrap and event list queries. */
const EVENTS_DEFAULT_LIMIT = 50

const numericString = z.string().regex(/^\d+$/, "must be a numeric string")

const listEventsQuerySchema = z
  .object({
    type: z.union([z.string(), z.array(z.string())]).optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    after: numericString.optional(),
    before: numericString.optional(),
  })
  .refine((d) => !(d.after && d.before), {
    message: "after and before are mutually exclusive",
    path: ["after"],
  })

const listEventsAroundQuerySchema = z
  .object({
    eventId: z.string().optional(),
    messageId: z.string().optional(),
    limit: z.coerce.number().int().min(2).max(100).optional(),
  })
  .refine((d) => d.eventId ?? d.messageId, {
    message: "eventId or messageId is required",
    path: ["eventId"],
  })
  .refine((d) => !(d.eventId && d.messageId), {
    message: "provide eventId or messageId, not both",
    path: ["eventId"],
  })

const streamBootstrapQuerySchema = z.object({
  after: numericString.optional(),
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
  pool: Pool
  streamService: StreamService
  eventService: EventService
  activityService?: ActivityService
  linkPreviewService: LinkPreviewService
}

function serializeEvent(event: StreamEvent) {
  return serializeBigInt(event)
}

function areLinkPreviewArraysEqual(current: LinkPreviewSummary[] | undefined, next: LinkPreviewSummary[]): boolean {
  if (!current) return next.length === 0
  if (current.length !== next.length) return false

  return current.every((preview, index) => {
    const nextPreview = next[index]
    return (
      preview.id === nextPreview.id &&
      preview.url === nextPreview.url &&
      preview.title === nextPreview.title &&
      preview.description === nextPreview.description &&
      preview.imageUrl === nextPreview.imageUrl &&
      preview.faviconUrl === nextPreview.faviconUrl &&
      preview.siteName === nextPreview.siteName &&
      preview.contentType === nextPreview.contentType &&
      preview.position === nextPreview.position
    )
  })
}

export function applyLinkPreviewStateToEvents(
  events: StreamEvent[],
  previewMap: Map<string, LinkPreviewSummary[]>,
  dismissals: Set<string>
): StreamEvent[] {
  if (previewMap.size === 0 && dismissals.size === 0) return events

  let changed = false
  const nextEvents = events.map((event) => {
    if (event.eventType !== "message_created") return event

    const payload = event.payload as { messageId?: string; linkPreviews?: LinkPreviewSummary[] }
    if (!payload.messageId) return event

    const previews = previewMap.get(payload.messageId) ?? payload.linkPreviews
    if (!previews) return event

    const visiblePreviews = previews.filter((preview) => !dismissals.has(`${payload.messageId}:${preview.id}`))
    if (areLinkPreviewArraysEqual(payload.linkPreviews, visiblePreviews)) {
      return event
    }

    changed = true
    return {
      ...event,
      payload: {
        ...payload,
        linkPreviews: visiblePreviews,
      },
    }
  })

  return changed ? nextEvents : events
}

async function enrichEventsWithLinkPreviews(
  linkPreviewService: LinkPreviewService,
  workspaceId: string,
  userId: string,
  events: StreamEvent[]
): Promise<StreamEvent[]> {
  const messageIds = events
    .filter((event) => event.eventType === "message_created")
    .map((event) => (event.payload as { messageId?: string }).messageId)
    .filter((messageId): messageId is string => !!messageId)

  if (messageIds.length === 0) return events

  const [previewMap, dismissals] = await Promise.all([
    linkPreviewService.getPreviewsForMessages(workspaceId, messageIds),
    linkPreviewService.getDismissals(workspaceId, userId, messageIds),
  ])

  return applyLinkPreviewStateToEvents(events, previewMap, dismissals)
}

export function createStreamHandlers({
  pool,
  streamService,
  eventService,
  activityService,
  linkPreviewService,
}: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { stream_type, status } = req.query

      const types = stream_type
        ? ((Array.isArray(stream_type) ? stream_type : [stream_type]) as ("scratchpad" | "channel")[])
        : undefined

      const archiveStatus = status
        ? ((Array.isArray(status) ? status : [status]) as ("active" | "archived")[])
        : undefined

      const streams = await streamService.list(workspaceId, userId, { types, archiveStatus })
      res.json({ streams })
    },

    async create(req: Request, res: Response) {
      const userId = req.user!.id
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
        memberIds,
        contextBag,
      } = result.data

      // When a contextBag is attached, the stream must be a companion-mode
      // scratchpad with Ariadne as the persona — otherwise the orientation
      // handler has no persona to respond as. The client never sends Ariadne's
      // id directly; we resolve it server-side so the persona id stays an
      // implementation detail. INV-33: persona slug is the source of truth.
      let resolvedCompanionMode = companionMode
      let resolvedPersonaId = companionPersonaId
      if (contextBag) {
        // Verify the caller can read every referenced ref BEFORE we persist
        // the bag. INV-8 workspace scoping plus per-kind access checks
        // (membership / visibility) — bag creators can only point at streams
        // they could already see. Bag resolution at render time re-enforces
        // the check, but rejecting at create time gives the user a crisp
        // error instead of a silent empty-context scratchpad.
        for (const ref of contextBag.refs) {
          const resolver = getResolver(ref.kind)
          await resolver.assertAccess(pool, ref, userId, workspaceId)
        }

        const ariadne = await PersonaRepository.findBySlug(pool, "ariadne", workspaceId)
        if (!ariadne) {
          return res.status(500).json({ error: "Ariadne persona not available in this workspace" })
        }
        resolvedCompanionMode = CompanionModes.ON
        resolvedPersonaId = ariadne.id
      }

      const stream = await streamService.create({
        workspaceId,
        type,
        slug,
        displayName,
        description,
        visibility,
        companionMode: resolvedCompanionMode,
        companionPersonaId: resolvedPersonaId,
        parentStreamId,
        parentMessageId,
        memberIds,
        createdBy: userId,
        contextBag,
      })

      res.status(201).json({ stream })
    },

    async get(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, userId)
      res.json({ stream })
    },

    async update(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, userId)

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
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = listEventsQuerySchema.safeParse(req.query)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }
      const { type, limit, after, before } = result.data

      await streamService.validateStreamAccess(streamId, workspaceId, userId)

      const types = type ? ((Array.isArray(type) ? type : [type]) as EventType[]) : undefined

      const events = await eventService.listEvents(streamId, {
        types,
        limit,
        afterSequence: after ? BigInt(after) : undefined,
        beforeSequence: before ? BigInt(before) : undefined,
        viewerId: userId,
      })

      const eventsWithLinkPreviews = await enrichEventsWithLinkPreviews(linkPreviewService, workspaceId, userId, events)

      res.json({ events: eventsWithLinkPreviews.map(serializeEvent) })
    },

    async listEventsAround(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const parsed = listEventsAroundQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(parsed.error).fieldErrors,
        })
      }
      const { eventId, messageId, limit } = parsed.data
      const targetId = (eventId ?? messageId)!

      await streamService.validateStreamAccess(streamId, workspaceId, userId)

      const result = await eventService.listEventsAround(streamId, targetId, {
        idType: eventId ? "event" : "message",
        limit,
        viewerId: userId,
      })

      const enrichedEvents = await eventService.enrichBootstrapEvents(result.events, new Map())
      const eventsWithLinkPreviews = await enrichEventsWithLinkPreviews(
        linkPreviewService,
        workspaceId,
        userId,
        enrichedEvents
      )

      res.json({
        events: eventsWithLinkPreviews.map(serializeEvent),
        hasOlder: result.hasOlder,
        hasNewer: result.hasNewer,
      })
    },

    async updateCompanionMode(req: Request, res: Response) {
      const userId = req.user!.id
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

      await streamService.validateStreamAccess(streamId, workspaceId, userId)

      const isMember = await streamService.isMember(streamId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const updated = await streamService.updateCompanionMode(streamId, companionMode, companionPersonaId)

      res.json({ stream: updated })
    },

    async pin(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = pinSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      await streamService.validateStreamAccess(streamId, workspaceId, userId)

      const membership = await streamService.pinStream(streamId, userId, result.data.pinned)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      res.json({ membership })
    },

    async setNotificationLevel(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = setNotificationLevelSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      await streamService.validateStreamAccess(streamId, workspaceId, userId)

      const membership = await streamService.setNotificationLevel(streamId, userId, result.data.notificationLevel)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      res.json({ membership })
    },

    async markAsRead(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = markAsReadSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      await streamService.validateStreamAccess(streamId, workspaceId, userId)

      const membership = await streamService.markAsRead(workspaceId, streamId, userId, result.data.lastEventId)
      if (!membership) {
        return res.status(404).json({ error: "Not a member of this stream" })
      }

      // Clear mention badges for this stream
      await activityService?.markStreamActivityAsRead(userId, streamId)

      res.json({ membership })
    },

    async archive(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, userId)

      if (stream.createdBy !== userId) {
        return res.status(403).json({ error: "Only the creator can archive this stream" })
      }

      const archived = await streamService.archiveStream(streamId, userId)
      res.json({ stream: archived })
    },

    async unarchive(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, userId)

      if (stream.createdBy !== userId) {
        return res.status(403).json({ error: "Only the creator can unarchive this stream" })
      }

      const unarchived = await streamService.unarchiveStream(streamId, userId)
      res.json({ stream: unarchived })
    },

    async join(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const membership = await streamService.joinPublicChannel(streamId, workspaceId, userId)
      res.json({ data: { membership } })
    },

    async bootstrap(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params
      const parsed = streamBootstrapQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(parsed.error).fieldErrors,
        })
      }
      const afterSequence = parsed.data.after ? BigInt(parsed.data.after) : undefined

      const stream = await streamService.validateStreamAccess(streamId, workspaceId, userId)

      const [members, botMemberIds, membership, threadDataMap, threadSummaryMap, latestSequence, activityCounts] =
        await Promise.all([
          streamService.getMembers(streamId),
          streamService.getBotMemberIds(workspaceId, streamId),
          streamService.getMembership(streamId, userId),
          streamService.getThreadsWithReplyCounts(streamId),
          streamService.getThreadSummaries(streamId),
          eventService.getLatestSequence(streamId),
          activityService?.getUnreadCountsForStream(userId, workspaceId, streamId),
        ])

      const unreadCount = membership ? await streamService.getUnreadCount(streamId, membership.lastReadEventId) : 0

      let events = await eventService.listEvents(streamId, {
        limit: afterSequence !== undefined ? EVENTS_DEFAULT_LIMIT + 1 : EVENTS_DEFAULT_LIMIT,
        afterSequence,
        viewerId: userId,
      })
      let syncMode: "append" | "replace" = afterSequence !== undefined ? "append" : "replace"
      let hasOlderEvents = false

      if (afterSequence !== undefined && events.length > EVENTS_DEFAULT_LIMIT) {
        syncMode = "replace"
        events = await eventService.listEvents(streamId, { limit: EVENTS_DEFAULT_LIMIT, viewerId: userId })
        hasOlderEvents = true
      } else if (afterSequence === undefined) {
        hasOlderEvents = events.length === EVENTS_DEFAULT_LIMIT
      }

      const enrichedEvents = await eventService.enrichBootstrapEvents(events, threadDataMap, threadSummaryMap)
      const eventsWithLinkPreviews = await enrichEventsWithLinkPreviews(
        linkPreviewService,
        workspaceId,
        userId,
        enrichedEvents
      )

      res.json({
        data: {
          stream,
          events: eventsWithLinkPreviews.map(serializeEvent),
          members,
          botMemberIds,
          membership,
          latestSequence: (latestSequence ?? 0n).toString(),
          hasOlderEvents,
          syncMode,
          unreadCount,
          mentionCount: activityCounts?.mentionCount ?? 0,
          activityCount: activityCounts?.totalCount ?? 0,
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
      const actorId = req.user!.id
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

      const membership = await streamService.addMember(streamId, result.data.memberId, workspaceId, actorId)
      res.status(201).json({ membership })
    },

    async removeMember(req: Request, res: Response) {
      const actor = req.user!
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
