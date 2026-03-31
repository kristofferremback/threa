import { z } from "zod"
import type { Request, Response } from "express"
import type { Pool } from "pg"
import type { SearchService } from "../search"
import { serializeSearchResult, resolveUserAccessibleStreamIds } from "../search"
import type { BotChannelService } from "../api-keys"
import type { EventService } from "../messaging"
import {
  StreamRepository,
  StreamMemberRepository,
  getEffectiveDisplayName,
  type Stream,
  type DisplayNameContext,
  type StreamService,
} from "../streams"
import { UserRepository } from "../workspaces"
import { PersonaRepository } from "../agents"
import { BotRepository, type Bot } from "./bot-repository"
import { AuthorTypes, sentViaApiKey, type AuthorType } from "@threa/types"
import type { Bot as WireBot } from "@threa/types"
import { HttpError } from "@threa/backend-common"
import { normalizeMessage, toEmoji } from "../emoji"
import { parseMarkdown } from "@threa/prosemirror"
import { botId } from "../../lib/id"
import { withTransaction } from "../../db"
import { OutboxRepository } from "../../lib/outbox"
import { encodeCursor, decodeCursor } from "./cursor"
import type { WireStream, WireMessage, WireSearchResult, WireUser, WireMember } from "./routes"
import {
  publicSearchSchema,
  listStreamsSchema,
  listMessagesSchema,
  sendMessageSchema,
  updateMessageSchema,
  listMembersSchema,
  listUsersSchema,
} from "./schemas"

function serializeStream(stream: Stream, context?: DisplayNameContext): WireStream {
  const effective = getEffectiveDisplayName(stream, context)
  const displayName = stream.type === "channel" ? `#${effective.displayName}` : effective.displayName

  return {
    id: stream.id,
    type: stream.type,
    displayName,
    ...(stream.slug != null && { slug: stream.slug }),
    ...(stream.description != null && { description: stream.description }),
    visibility: stream.visibility,
    ...(stream.parentStreamId != null && { parentStreamId: stream.parentStreamId }),
    ...(stream.rootStreamId != null && { rootStreamId: stream.rootStreamId }),
    ...(stream.parentMessageId != null && { parentMessageId: stream.parentMessageId }),
    createdAt: stream.createdAt.toISOString(),
    ...(stream.archivedAt != null && { archivedAt: stream.archivedAt.toISOString() }),
  }
}

function serializeMessage(
  message: {
    id: string
    streamId: string
    sequence: bigint
    authorId: string
    authorType: AuthorType
    contentMarkdown: string
    replyCount: number
    clientMessageId?: string | null
    sentVia?: string | null
    editedAt: Date | null
    createdAt: Date
  },
  opts?: { authorDisplayName?: string | null; threadStreamId?: string | null }
): WireMessage {
  return {
    id: message.id,
    streamId: message.streamId,
    sequence: message.sequence.toString(),
    authorId: message.authorId,
    authorType: message.authorType,
    ...(opts?.authorDisplayName != null && { authorDisplayName: opts.authorDisplayName }),
    content: message.contentMarkdown,
    replyCount: message.replyCount,
    ...(opts?.threadStreamId != null && { threadStreamId: opts.threadStreamId }),
    ...(message.clientMessageId != null && { clientMessageId: message.clientMessageId }),
    ...(message.sentVia != null && { sentVia: message.sentVia }),
    ...(message.editedAt != null && { editedAt: message.editedAt.toISOString() }),
    createdAt: message.createdAt.toISOString(),
  }
}

export function serializeBot(bot: Bot): WireBot {
  return {
    id: bot.id,
    workspaceId: bot.workspaceId,
    slug: bot.slug,
    name: bot.name,
    description: bot.description,
    avatarEmoji: bot.avatarEmoji,
    avatarUrl: bot.avatarUrl,
    archivedAt: bot.archivedAt?.toISOString() ?? null,
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
}): WireUser {
  return {
    id: user.id,
    name: user.name,
    slug: user.slug,
    email: user.email,
    ...(user.avatarUrl != null && { avatarUrl: user.avatarUrl }),
    role: user.role,
  }
}

/**
 * Batch-fetch parent streams for threads that need display name context.
 * Only fetches when there are unnamed threads in the result set.
 */
async function resolveParentStreams(pool: Pool, streams: Stream[]): Promise<Map<string, Stream>> {
  const parentIds = [
    ...new Set(
      streams
        .filter((s) => s.type === "thread" && s.displayName === null && s.parentStreamId)
        .map((s) => s.parentStreamId!)
    ),
  ]
  if (parentIds.length === 0) return new Map()
  const parents = await StreamRepository.findByIds(pool, parentIds)
  return new Map(parents.map((p) => [p.id, p]))
}

/**
 * Batch-resolve display names for message authors across all author types.
 */
async function resolveAuthorDisplayNames(
  pool: Pool,
  workspaceId: string,
  messages: { authorId: string; authorType: string }[]
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>()
  const byType = { user: new Set<string>(), bot: new Set<string>(), persona: new Set<string>() }

  for (const m of messages) {
    if (m.authorType === "user") byType.user.add(m.authorId)
    else if (m.authorType === "bot") byType.bot.add(m.authorId)
    else if (m.authorType === "persona") byType.persona.add(m.authorId)
    // System messages: authorDisplayName stays null — clients use authorType to format
  }

  const fetches: Promise<void>[] = []

  if (byType.user.size > 0) {
    fetches.push(
      UserRepository.findByIds(pool, workspaceId, [...byType.user]).then((users) => {
        for (const u of users) nameMap.set(u.id, u.name)
      })
    )
  }
  if (byType.bot.size > 0) {
    fetches.push(
      BotRepository.findByIds(pool, [...byType.bot]).then((bots) => {
        for (const b of bots) nameMap.set(b.id, b.name)
      })
    )
  }
  if (byType.persona.size > 0) {
    fetches.push(
      PersonaRepository.findByIds(pool, [...byType.persona]).then((personas) => {
        for (const p of personas) nameMap.set(p.id, p.name)
      })
    )
  }

  await Promise.all(fetches)
  return nameMap
}

export interface PublicApiDeps {
  searchService: SearchService
  botChannelService: BotChannelService
  streamService: StreamService
  eventService: EventService
  pool: Pool
}

export function createPublicApiHandlers({
  searchService,
  botChannelService,
  streamService,
  eventService,
  pool,
}: PublicApiDeps) {
  /** Resolve accessible stream IDs for the current key (user-scoped or bot) */
  async function getAccessibleStreamIds(req: Request): Promise<string[]> {
    if (req.userApiKey) {
      return resolveUserAccessibleStreamIds(pool, req.workspaceId!, req.user!.id, {})
    }
    if (req.botApiKey) {
      return botChannelService.getAccessibleStreamIdsForBot(req.workspaceId!, req.botApiKey.botId)
    }
    throw new HttpError("No API key context", { status: 401, code: "UNAUTHORIZED" })
  }

  /** Check if a single stream is accessible for the current key */
  async function assertStreamAccessible(req: Request, streamId: string): Promise<void> {
    if (req.userApiKey) {
      const stream = await streamService.tryAccess(streamId, req.workspaceId!, req.user!.id)
      if (!stream) {
        throw new HttpError("Stream not accessible", { status: 403, code: "FORBIDDEN" })
      }
      return
    }
    if (req.botApiKey) {
      const accessible = await botChannelService.isStreamAccessibleForBot(
        req.workspaceId!,
        req.botApiKey.botId,
        streamId
      )
      if (!accessible) {
        throw new HttpError("Stream not accessible", { status: 403, code: "FORBIDDEN" })
      }
      return
    }
    throw new HttpError("No API key context", { status: 401, code: "UNAUTHORIZED" })
  }

  /** Find a message, verify stream access, and verify ownership. Used by update/delete. */
  async function resolveOwnedMessage(messageId: string, req: Request) {
    const message = await eventService.getMessageById(messageId)
    if (!message || message.deletedAt) {
      throw new HttpError("Message not found", { status: 404, code: "NOT_FOUND" })
    }

    await assertStreamAccessible(req, message.streamId)

    // User-scoped key: can modify own messages (regardless of how they were sent)
    if (req.userApiKey) {
      if (message.authorId !== req.user!.id) {
        throw new HttpError("Cannot modify another user's messages", {
          status: 403,
          code: "FORBIDDEN",
        })
      }
      return { message, actorId: req.user!.id, actorType: AuthorTypes.USER as AuthorType, displayName: req.user!.name }
    }

    // Bot-scoped key: verify the message was authored by the bot this key belongs to
    if (req.botApiKey) {
      if (message.authorType !== AuthorTypes.BOT || message.authorId !== req.botApiKey.botId) {
        throw new HttpError("Cannot modify messages created by another bot", { status: 403, code: "FORBIDDEN" })
      }
      const bot = await BotRepository.findById(pool, message.authorId)
      if (!bot) {
        throw new HttpError("Bot not found", { status: 404, code: "NOT_FOUND" })
      }
      return { message, actorId: bot.id, actorType: AuthorTypes.BOT as AuthorType, displayName: bot.name }
    }

    throw new HttpError("No API key context", { status: 401, code: "UNAUTHORIZED" })
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

      // Resolve author display names for search results
      const authorNames = await resolveAuthorDisplayNames(pool, workspaceId, results)
      const serialized: WireSearchResult[] = results.map((r) => {
        const name = authorNames.get(r.authorId)
        return {
          ...serializeSearchResult(r),
          ...(name != null && { authorDisplayName: name }),
        }
      })

      res.json({ data: serialized })
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

      const { type, query, after: afterCursor, limit } = result.data
      const accessibleStreamIds = await getAccessibleStreamIds(req)

      if (accessibleStreamIds.length === 0) {
        return res.json({ data: [], hasMore: false, cursor: null })
      }

      // Cursor pagination disabled when query is provided (relevance ordering)
      const cursor = !query && afterCursor ? decodeCursor(afterCursor) : undefined

      const streams = await StreamRepository.listByIds(pool, req.workspaceId!, accessibleStreamIds, {
        types: type,
        query,
        limit: limit + 1,
        cursorCreatedAt: cursor?.sortKey,
        cursorId: cursor?.id,
      })

      const hasMore = streams.length > limit
      const page = hasMore ? streams.slice(0, limit) : streams

      // Batch-fetch parent streams for unnamed threads to compute display names
      const parentStreamMap = await resolveParentStreams(pool, page)

      const lastStream = page[page.length - 1]
      res.json({
        data: page.map((s) => {
          const parentStream = s.parentStreamId ? parentStreamMap.get(s.parentStreamId) : undefined
          return serializeStream(s, parentStream ? { parentStream } : undefined)
        }),
        hasMore,
        cursor: !query && lastStream ? encodeCursor(lastStream.createdAt, lastStream.id) : null,
      })
    },

    /**
     * Get a single stream by ID.
     *
     * GET /api/v1/workspaces/:workspaceId/streams/:streamId
     */
    async getStream(req: Request, res: Response) {
      const streamId = req.params.streamId

      await assertStreamAccessible(req, streamId)

      const stream = await StreamRepository.findById(pool, streamId)
      if (!stream || stream.archivedAt) {
        throw new HttpError("Stream not found", { status: 404, code: "NOT_FOUND" })
      }

      // Resolve parent stream for unnamed thread display names
      let context: DisplayNameContext | undefined
      if (stream.type === "thread" && stream.displayName === null && stream.parentStreamId) {
        const parent = await StreamRepository.findById(pool, stream.parentStreamId)
        if (parent) context = { parentStream: parent }
      }

      res.json({ data: serializeStream(stream, context) })
    },

    /**
     * List members of a stream.
     *
     * GET /api/v1/workspaces/:workspaceId/streams/:streamId/members
     */
    async listMembers(req: Request, res: Response) {
      const streamId = req.params.streamId
      const workspaceId = req.workspaceId!

      const result = listMembersSchema.safeParse(req.query)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { after: afterCursor, limit } = result.data

      await assertStreamAccessible(req, streamId)

      const cursor = afterCursor ? decodeCursor(afterCursor) : undefined

      const members = await StreamMemberRepository.listPaginated(pool, streamId, {
        limit: limit + 1,
        cursorJoinedAt: cursor?.sortKey,
        cursorMemberId: cursor?.id,
      })

      const hasMore = members.length > limit
      const page = hasMore ? members.slice(0, limit) : members

      const memberIds = page.map((m) => m.memberId)
      const users = memberIds.length > 0 ? await UserRepository.findByIds(pool, workspaceId, memberIds) : []
      const userMap = new Map(users.map((u) => [u.id, u]))

      const data: WireMember[] = page
        .filter((m) => userMap.has(m.memberId))
        .map((m) => {
          const user = userMap.get(m.memberId)!
          return {
            userId: m.memberId,
            name: user.name,
            slug: user.slug,
            ...(user.avatarUrl != null && { avatarUrl: user.avatarUrl }),
            joinedAt: m.joinedAt.toISOString(),
          }
        })

      const lastMember = page[page.length - 1]
      res.json({
        data,
        hasMore,
        cursor: lastMember ? encodeCursor(lastMember.joinedAt, lastMember.memberId) : null,
      })
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
      await assertStreamAccessible(req, streamId)

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

      // Resolve author display names and thread stream IDs
      const pageMessageIds = page.map((m) => m.id)
      const [authorNames, threadMap] = await Promise.all([
        resolveAuthorDisplayNames(pool, req.workspaceId!, page),
        StreamRepository.findThreadsForMessageIds(pool, streamId, pageMessageIds),
      ])

      res.json({
        data: page.map((m) =>
          serializeMessage(m, {
            authorDisplayName: authorNames.get(m.authorId) ?? null,
            threadStreamId: threadMap.get(m.id) ?? null,
          })
        ),
        hasMore,
      })
    },

    /**
     * Send a message. User-scoped keys send as the user (with sentVia indicator);
     * workspace-scoped keys send as a bot entity.
     *
     * POST /api/v1/workspaces/:workspaceId/streams/:streamId/messages
     */
    async sendMessage(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const streamId = req.params.streamId

      const result = sendMessageSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { content, clientMessageId } = result.data

      // Verify stream access
      await assertStreamAccessible(req, streamId)

      // Normalize and parse content
      const contentMarkdown = normalizeMessage(content)
      const contentJson = parseMarkdown(contentMarkdown, undefined, toEmoji)

      // User-scoped key: send as the user with "api" indicator
      if (req.userApiKey) {
        const user = req.user!

        const message = await eventService.createMessage({
          workspaceId,
          streamId,
          authorId: user.id,
          authorType: AuthorTypes.USER,
          contentJson,
          contentMarkdown,
          clientMessageId,
          sentVia: sentViaApiKey(req.userApiKey.id),
        })

        res.status(201).json({ data: serializeMessage(message, { authorDisplayName: user.name }) })
        return
      }

      // Bot-scoped key: send as the bot directly (no upsert needed)
      if (req.botApiKey) {
        const bot = await BotRepository.findById(pool, req.botApiKey.botId)
        if (!bot || bot.archivedAt) {
          throw new HttpError("Bot not found or archived", { status: 404, code: "NOT_FOUND" })
        }

        const message = await eventService.createMessage({
          workspaceId,
          streamId,
          authorId: bot.id,
          authorType: AuthorTypes.BOT,
          contentJson,
          contentMarkdown,
          clientMessageId,
        })

        res.status(201).json({ data: serializeMessage(message, { authorDisplayName: bot.name }) })
        return
      }

      throw new HttpError("No API key context", { status: 401, code: "UNAUTHORIZED" })
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
      const { message: existing, actorId, actorType, displayName } = await resolveOwnedMessage(messageId, req)

      // Normalize and parse content
      const contentMarkdown = normalizeMessage(content)
      const contentJson = parseMarkdown(contentMarkdown, undefined, toEmoji)

      const updated = await eventService.editMessage({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        contentJson,
        contentMarkdown,
        actorId,
        actorType,
      })

      if (!updated) {
        throw new HttpError("Message not found or was deleted", { status: 404, code: "NOT_FOUND" })
      }

      // Look up thread for this message
      const thread = await StreamRepository.findByParentMessage(pool, existing.streamId, messageId)
      res.json({
        data: serializeMessage(updated, {
          authorDisplayName: displayName,
          threadStreamId: thread?.id ?? null,
        }),
      })
    },

    /**
     * Delete an API-created message.
     *
     * DELETE /api/v1/workspaces/:workspaceId/messages/:messageId
     */
    async deleteMessage(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const messageId = req.params.messageId

      const { message: existing, actorId, actorType } = await resolveOwnedMessage(messageId, req)

      const deleted = await eventService.deleteMessage({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        actorId,
        actorType,
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

      const { query, after: afterCursor, limit } = result.data

      // Cursor pagination disabled when query is provided (relevance ordering)
      const cursor = !query && afterCursor ? decodeCursor(afterCursor) : undefined

      const users = await UserRepository.listByWorkspace(pool, workspaceId, {
        query,
        limit: limit + 1,
        cursorJoinedAt: cursor?.sortKey,
        cursorId: cursor?.id,
      })

      const hasMore = users.length > limit
      const page = hasMore ? users.slice(0, limit) : users

      const lastUser = page[page.length - 1]
      res.json({
        data: page.map(serializeUser),
        hasMore,
        cursor: !query && lastUser ? encodeCursor(lastUser.joinedAt, lastUser.id) : null,
      })
    },
  }
}
