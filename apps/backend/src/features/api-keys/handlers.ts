import { z } from "zod"
import type { Request, Response } from "express"
import type { Pool } from "pg"
import type { SearchService } from "../search"
import { serializeSearchResult } from "../search"
import type { ApiKeyChannelService } from "./service"
import type { EventService } from "../messaging"
import { MessageRepository } from "../messaging"
import { StreamRepository } from "../streams"
import { UserRepository } from "../workspaces"
import { STREAM_TYPES, AuthorTypes } from "@threa/types"
import { HttpError } from "@threa/backend-common"
import { normalizeMessage, toEmoji } from "../emoji"
import { parseMarkdown } from "@threa/prosemirror"

const PUBLIC_SEARCH_MAX_LIMIT = 50

const publicSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  semantic: z.boolean().optional().default(false),
  streams: z.array(z.string()).optional(),
  from: z.string().optional(),
  type: z.array(z.enum(STREAM_TYPES)).optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(PUBLIC_SEARCH_MAX_LIMIT).optional().default(20),
})

const listStreamsSchema = z.object({
  type: z
    .union([z.enum(STREAM_TYPES), z.array(z.enum(STREAM_TYPES))])
    .optional()
    .transform((v) => (typeof v === "string" ? [v] : v)),
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
})

const listMessagesSchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})

const sendMessageSchema = z.object({
  content: z.string().min(1, "content is required"),
  displayName: z.string().min(1, "displayName is required").max(100),
})

const updateMessageSchema = z.object({
  content: z.string().min(1, "content is required"),
})

const listUsersSchema = z.object({
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
})

function serializeStream(stream: {
  id: string
  type: string
  displayName: string | null
  slug: string | null
  description: string | null
  visibility: string
  createdAt: Date
  archivedAt: Date | null
}) {
  return {
    id: stream.id,
    type: stream.type,
    displayName: stream.displayName,
    slug: stream.slug,
    description: stream.description,
    visibility: stream.visibility,
    createdAt: stream.createdAt.toISOString(),
    archivedAt: stream.archivedAt?.toISOString() ?? null,
  }
}

function serializeMessage(message: {
  id: string
  streamId: string
  sequence: bigint
  authorId: string
  authorType: string
  authorDisplayName: string | null
  contentMarkdown: string
  replyCount: number
  editedAt: Date | null
  createdAt: Date
}) {
  return {
    id: message.id,
    streamId: message.streamId,
    sequence: message.sequence.toString(),
    authorId: message.authorId,
    authorType: message.authorType,
    authorDisplayName: message.authorDisplayName,
    content: message.contentMarkdown,
    replyCount: message.replyCount,
    editedAt: message.editedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  }
}

function serializeUser(user: {
  id: string
  name: string
  slug: string
  email: string
  avatarUrl: string | null
  role: string
}) {
  return {
    id: user.id,
    name: user.name,
    slug: user.slug,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: user.role,
  }
}

export interface PublicApiDeps {
  searchService: SearchService
  apiKeyChannelService: ApiKeyChannelService
  eventService: EventService
  pool: Pool
}

export function createPublicApiHandlers({ searchService, apiKeyChannelService, eventService, pool }: PublicApiDeps) {
  /** Resolve accessible stream IDs for the current API key */
  async function getAccessibleStreamIds(req: Request): Promise<string[]> {
    return apiKeyChannelService.getAccessibleStreamIdsForApiKey(req.workspaceId!, req.apiKey!.id)
  }

  return {
    /**
     * Search messages via public API.
     *
     * POST /api/v1/workspaces/:workspaceId/messages/search
     */
    async searchMessages(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const apiKey = req.apiKey!

      const result = publicSearchSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { query, semantic, streams, from, type, before, after, limit } = result.data

      const accessibleStreamIds = await apiKeyChannelService.getAccessibleStreamIdsForApiKey(workspaceId, apiKey.id)

      if (accessibleStreamIds.length === 0) {
        return res.json({ data: [] })
      }

      const results = await searchService.search({
        workspaceId,
        permissions: { accessibleStreamIds },
        query,
        filters: {
          streamIds: streams,
          authorId: from,
          streamTypes: type,
          before: before ? new Date(before) : undefined,
          after: after ? new Date(after) : undefined,
        },
        limit,
        skipEmbedding: !semantic,
      })

      res.json({
        data: results.map(serializeSearchResult),
      })
    },

    /**
     * List accessible streams.
     *
     * GET /api/v1/workspaces/:workspaceId/streams
     */
    async listStreams(req: Request, res: Response) {
      const result = listStreamsSchema.safeParse(req.query)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { type, query, limit } = result.data
      const accessibleStreamIds = await getAccessibleStreamIds(req)

      if (accessibleStreamIds.length === 0) {
        return res.json({ data: [] })
      }

      const streams = await StreamRepository.listByIds(pool, accessibleStreamIds, {
        types: type,
        query,
        limit,
      })

      res.json({ data: streams.map(serializeStream) })
    },

    /**
     * List messages in a stream.
     *
     * GET /api/v1/workspaces/:workspaceId/streams/:streamId/messages
     */
    async listMessages(req: Request, res: Response) {
      const streamId = req.params.streamId

      const result = listMessagesSchema.safeParse(req.query)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { before, after, limit } = result.data

      // Verify stream access
      const accessibleStreamIds = await getAccessibleStreamIds(req)
      if (!accessibleStreamIds.includes(streamId)) {
        throw new HttpError("Stream not accessible", { status: 403, code: "FORBIDDEN" })
      }

      const messages = await MessageRepository.list(pool, streamId, {
        limit: limit + 1, // Fetch one extra to determine hasMore
        beforeSequence: before ? BigInt(before) : undefined,
        afterSequence: after ? BigInt(after) : undefined,
      })

      const hasMore = messages.length > limit
      const page = hasMore ? messages.slice(0, limit) : messages

      res.json({
        data: page.map(serializeMessage),
        hasMore,
      })
    },

    /**
     * Send a message as a bot.
     *
     * POST /api/v1/workspaces/:workspaceId/streams/:streamId/messages
     */
    async sendMessage(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const streamId = req.params.streamId
      const apiKey = req.apiKey!

      const result = sendMessageSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { content, displayName } = result.data

      // Verify stream access
      const accessibleStreamIds = await getAccessibleStreamIds(req)
      if (!accessibleStreamIds.includes(streamId)) {
        throw new HttpError("Stream not accessible", { status: 403, code: "FORBIDDEN" })
      }

      // Normalize and parse content
      const contentMarkdown = normalizeMessage(content)
      const contentJson = parseMarkdown(contentMarkdown, undefined, toEmoji)

      const message = await eventService.createMessage({
        workspaceId,
        streamId,
        authorId: apiKey.id,
        authorType: AuthorTypes.BOT,
        contentJson,
        contentMarkdown,
        authorDisplayName: displayName,
        apiKeyId: apiKey.id,
      })

      res.status(201).json({ data: serializeMessage(message) })
    },

    /**
     * Update an API-created message.
     *
     * PATCH /api/v1/workspaces/:workspaceId/messages/:messageId
     */
    async updateMessage(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const messageId = req.params.messageId
      const apiKey = req.apiKey!

      const result = updateMessageSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { content } = result.data

      // Find message and verify ownership
      const existing = await MessageRepository.findById(pool, messageId)
      if (!existing) {
        throw new HttpError("Message not found", { status: 404, code: "NOT_FOUND" })
      }

      if (existing.apiKeyId !== apiKey.id) {
        throw new HttpError("Cannot update messages created by another API key", {
          status: 403,
          code: "FORBIDDEN",
        })
      }

      // Verify stream access
      const accessibleStreamIds = await getAccessibleStreamIds(req)
      if (!accessibleStreamIds.includes(existing.streamId)) {
        throw new HttpError("Stream not accessible", { status: 403, code: "FORBIDDEN" })
      }

      // Normalize and parse content
      const contentMarkdown = normalizeMessage(content)
      const contentJson = parseMarkdown(contentMarkdown, undefined, toEmoji)

      const updated = await eventService.editMessage({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        contentJson,
        contentMarkdown,
        actorId: apiKey.id,
        actorType: AuthorTypes.BOT,
      })

      if (!updated) {
        throw new HttpError("Message not found or was deleted", { status: 404, code: "NOT_FOUND" })
      }

      res.json({ data: serializeMessage(updated) })
    },

    /**
     * Delete an API-created message.
     *
     * DELETE /api/v1/workspaces/:workspaceId/messages/:messageId
     */
    async deleteMessage(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const messageId = req.params.messageId
      const apiKey = req.apiKey!

      // Find message and verify ownership
      const existing = await MessageRepository.findById(pool, messageId)
      if (!existing) {
        throw new HttpError("Message not found", { status: 404, code: "NOT_FOUND" })
      }

      if (existing.apiKeyId !== apiKey.id) {
        throw new HttpError("Cannot delete messages created by another API key", {
          status: 403,
          code: "FORBIDDEN",
        })
      }

      // Verify stream access
      const accessibleStreamIds = await getAccessibleStreamIds(req)
      if (!accessibleStreamIds.includes(existing.streamId)) {
        throw new HttpError("Stream not accessible", { status: 403, code: "FORBIDDEN" })
      }

      await eventService.deleteMessage({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        actorId: apiKey.id,
        actorType: AuthorTypes.BOT,
      })

      res.status(204).send()
    },

    /**
     * List workspace users.
     *
     * GET /api/v1/workspaces/:workspaceId/users
     */
    async listUsers(req: Request, res: Response) {
      const workspaceId = req.workspaceId!

      const result = listUsersSchema.safeParse(req.query)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { query, limit } = result.data

      const users = await UserRepository.listByWorkspace(pool, workspaceId, { query, limit })

      res.json({ data: users.map(serializeUser) })
    },
  }
}
