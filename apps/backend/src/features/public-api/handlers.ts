import { z } from "zod"
import type { Request, Response } from "express"
import type { Pool } from "pg"
import type { SearchService } from "../search"
import { serializeSearchResult } from "../search"
import type { ApiKeyChannelService } from "../api-keys"
import type { EventService } from "../messaging"
import { StreamRepository } from "../streams"
import { UserRepository } from "../workspaces"
import { BotRepository, type Bot } from "./bot-repository"
import { STREAM_TYPES, AuthorTypes } from "@threa/types"
import type { Bot as WireBot } from "@threa/types"
import { HttpError } from "@threa/backend-common"
import { normalizeMessage, toEmoji } from "../emoji"
import { parseMarkdown } from "@threa/prosemirror"
import { botId } from "../../lib/id"
import { withTransaction } from "../../db"
import { OutboxRepository } from "../../lib/outbox"

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

const listMessagesSchema = z
  .object({
    before: z.string().regex(/^\d+$/, "must be a numeric sequence").optional(),
    after: z.string().regex(/^\d+$/, "must be a numeric sequence").optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  })
  .refine((data) => !(data.before && data.after), {
    message: "Provide at most one of 'before' or 'after'",
  })

const sendMessageSchema = z.object({
  content: z.string().min(1, "content is required"),
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
    displayName: stream.type === "channel" && stream.slug ? `#${stream.slug}` : stream.displayName,
    slug: stream.slug,
    description: stream.description,
    visibility: stream.visibility,
    createdAt: stream.createdAt.toISOString(),
    archivedAt: stream.archivedAt?.toISOString() ?? null,
  }
}

function serializeMessage(
  message: {
    id: string
    streamId: string
    sequence: bigint
    authorId: string
    authorType: string
    contentMarkdown: string
    replyCount: number
    editedAt: Date | null
    createdAt: Date
  },
  authorDisplayName?: string | null
) {
  return {
    id: message.id,
    streamId: message.streamId,
    sequence: message.sequence.toString(),
    authorId: message.authorId,
    authorType: message.authorType,
    authorDisplayName: authorDisplayName ?? null,
    content: message.contentMarkdown,
    replyCount: message.replyCount,
    editedAt: message.editedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  }
}

export function serializeBot(bot: Bot): WireBot {
  return {
    id: bot.id,
    workspaceId: bot.workspaceId,
    name: bot.name,
    description: bot.description,
    avatarEmoji: bot.avatarEmoji,
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString(),
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

  /** Find a message, verify stream access, and verify bot ownership. Used by update/delete. */
  async function resolveApiKeyMessage(messageId: string, req: Request) {
    const message = await eventService.getMessageById(messageId)
    if (!message || message.deletedAt) {
      throw new HttpError("Message not found", { status: 404, code: "NOT_FOUND" })
    }

    const accessibleStreamIds = await getAccessibleStreamIds(req)
    if (!accessibleStreamIds.includes(message.streamId)) {
      throw new HttpError("Stream not accessible", { status: 403, code: "FORBIDDEN" })
    }

    // Verify bot ownership: message must be authored by a bot owned by this API key
    if (message.authorType !== AuthorTypes.BOT) {
      throw new HttpError("Cannot modify messages not created via API", { status: 403, code: "FORBIDDEN" })
    }

    const bot = await BotRepository.findById(pool, message.authorId)
    if (!bot || bot.apiKeyId !== req.apiKey!.id) {
      throw new HttpError("Cannot modify messages created by another API key", { status: 403, code: "FORBIDDEN" })
    }

    return { message, bot }
  }

  return {
    /**
     * Search messages via public API.
     *
     * POST /api/v1/workspaces/:workspaceId/messages/search
     */
    async searchMessages(req: Request, res: Response) {
      const workspaceId = req.workspaceId!

      const result = publicSearchSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { query, semantic, streams, from, type, before, after, limit } = result.data

      const accessibleStreamIds = await getAccessibleStreamIds(req)

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

      const streams = await StreamRepository.listByIds(pool, req.workspaceId!, accessibleStreamIds, {
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
        const flat = z.flattenError(result.error)
        return res.status(400).json({
          error: flat.formErrors.length > 0 ? flat.formErrors[0] : "Validation failed",
          details: flat.fieldErrors,
        })
      }

      const { before, after, limit } = result.data

      // Verify stream access
      const accessibleStreamIds = await getAccessibleStreamIds(req)
      if (!accessibleStreamIds.includes(streamId)) {
        throw new HttpError("Stream not accessible", { status: 403, code: "FORBIDDEN" })
      }

      const messages = await eventService.getMessages(streamId, {
        limit: limit + 1, // Fetch one extra to determine hasMore
        beforeSequence: before ? BigInt(before) : undefined,
        afterSequence: after ? BigInt(after) : undefined,
      })

      const hasMore = messages.length > limit
      // afterSequence returns ASC from DB — extra probe is at the tail.
      // beforeSequence/default return DESC then reverse to ASC — extra probe is at the head.
      let page = messages
      if (hasMore) {
        page = after ? messages.slice(0, limit) : messages.slice(-limit)
      }

      // Resolve bot display names for bot-authored messages
      const botAuthorIds = [...new Set(page.filter((m) => m.authorType === "bot").map((m) => m.authorId))]
      const bots = botAuthorIds.length > 0 ? await BotRepository.findByIds(pool, botAuthorIds) : []
      const botNameMap = new Map(bots.map((b) => [b.id, b.name]))

      res.json({
        data: page.map((m) =>
          serializeMessage(m, m.authorType === "bot" ? (botNameMap.get(m.authorId) ?? null) : null)
        ),
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

      const { content } = result.data
      const botName = apiKey.name

      // Verify stream access
      const accessibleStreamIds = await getAccessibleStreamIds(req)
      if (!accessibleStreamIds.includes(streamId)) {
        throw new HttpError("Stream not accessible", { status: 403, code: "FORBIDDEN" })
      }

      // Upsert bot entity and emit outbox event in a transaction.
      // Note: this commits separately from createMessage below. If createMessage
      // fails, clients may briefly see the bot identity without a message. This is
      // acceptable — the bot existing without messages is a benign state, and
      // merging both into one transaction would require eventService to accept a
      // Querier, which is a larger refactor deferred until needed.
      const { bot } = await withTransaction(pool, async (client) => {
        const { bot: upsertedBot, isInsert } = await BotRepository.upsert(client, {
          id: botId(),
          workspaceId,
          apiKeyId: apiKey.id,
          name: botName,
        })

        if (isInsert) {
          await OutboxRepository.insert(client, "bot:created", {
            workspaceId,
            bot: serializeBot(upsertedBot),
          })
        } else {
          // Always emit bot:updated on non-insert — the upsert overwrites the name
          // unconditionally, so skipping the event based on a pre-read would race
          // under concurrent requests (INV-20). Idempotent updates are harmless.
          await OutboxRepository.insert(client, "bot:updated", {
            workspaceId,
            bot: serializeBot(upsertedBot),
          })
        }

        return { bot: upsertedBot }
      })

      // Normalize and parse content
      const contentMarkdown = normalizeMessage(content)
      const contentJson = parseMarkdown(contentMarkdown, undefined, toEmoji)

      const message = await eventService.createMessage({
        workspaceId,
        streamId,
        authorId: bot.id,
        authorType: AuthorTypes.BOT,
        contentJson,
        contentMarkdown,
      })

      res.status(201).json({ data: serializeMessage(message, bot.name) })
    },

    /**
     * Update an API-created message.
     *
     * PATCH /api/v1/workspaces/:workspaceId/messages/:messageId
     */
    async updateMessage(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const messageId = req.params.messageId

      const result = updateMessageSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { content } = result.data
      const { message: existing, bot } = await resolveApiKeyMessage(messageId, req)

      // Normalize and parse content
      const contentMarkdown = normalizeMessage(content)
      const contentJson = parseMarkdown(contentMarkdown, undefined, toEmoji)

      const updated = await eventService.editMessage({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        contentJson,
        contentMarkdown,
        actorId: bot.id,
        actorType: AuthorTypes.BOT,
      })

      if (!updated) {
        throw new HttpError("Message not found or was deleted", { status: 404, code: "NOT_FOUND" })
      }

      res.json({ data: serializeMessage(updated, bot.name) })
    },

    /**
     * Delete an API-created message.
     *
     * DELETE /api/v1/workspaces/:workspaceId/messages/:messageId
     */
    async deleteMessage(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const messageId = req.params.messageId

      const { message: existing, bot } = await resolveApiKeyMessage(messageId, req)

      const deleted = await eventService.deleteMessage({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        actorId: bot.id,
        actorType: AuthorTypes.BOT,
      })

      if (!deleted) {
        throw new HttpError("Message not found or was deleted", { status: 404, code: "NOT_FOUND" })
      }

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
