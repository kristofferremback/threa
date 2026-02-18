import { z } from "zod"
import type { Request, Response } from "express"
import type { Pool } from "pg"
import { withTransaction } from "../../db"
import type { EventService } from "./event-service"
import type { StreamService } from "../streams"
import type { Message } from "./repository"
import { StreamEventRepository } from "../streams"
import { OutboxRepository } from "../../lib/outbox"
import type { CommandRegistry, CommandDispatchedPayload } from "../commands"
import { serializeBigInt } from "../../lib/serialization"
import { eventId, commandId as generateCommandId } from "../../lib/id"
import { toShortcode, normalizeMessage, toEmoji } from "../emoji"
import { parseMarkdown, serializeToMarkdown } from "@threa/prosemirror"
import type { JSONContent } from "@threa/types"

// Schema for JSON input to an existing stream (from rich clients)
const createMessageJsonToStreamSchema = z.object({
  streamId: z.string().min(1, "streamId is required"),
  contentJson: z.object({
    type: z.literal("doc"),
    content: z.array(z.any()),
  }),
  contentMarkdown: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
})

// Schema for markdown input to an existing stream (from AI/external)
const createMessageMarkdownToStreamSchema = z.object({
  streamId: z.string().min(1, "streamId is required"),
  content: z.string().min(1, "content is required"),
  attachmentIds: z.array(z.string()).optional(),
})

// Schema for JSON input to a DM target member (lazy stream creation on first message)
const createMessageJsonToDmSchema = z.object({
  dmMemberId: z.string().min(1, "dmMemberId is required"),
  contentJson: z.object({
    type: z.literal("doc"),
    content: z.array(z.any()),
  }),
  contentMarkdown: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
})

// Schema for markdown input to a DM target member (lazy stream creation on first message)
const createMessageMarkdownToDmSchema = z.object({
  dmMemberId: z.string().min(1, "dmMemberId is required"),
  content: z.string().min(1, "content is required"),
  attachmentIds: z.array(z.string()).optional(),
})

// Union schema - accepts either format
const createMessageSchema = z.union([
  createMessageJsonToStreamSchema,
  createMessageMarkdownToStreamSchema,
  createMessageJsonToDmSchema,
  createMessageMarkdownToDmSchema,
])

// Update can also be either format
const updateMessageJsonSchema = z.object({
  contentJson: z.object({
    type: z.literal("doc"),
    content: z.array(z.any()),
  }),
  contentMarkdown: z.string().optional(),
})

const updateMessageMarkdownSchema = z.object({
  content: z.string().min(1, "content is required"),
})

const updateMessageSchema = z.union([updateMessageJsonSchema, updateMessageMarkdownSchema])

const addReactionSchema = z.object({
  emoji: z.string().min(1, "emoji is required"),
})

export { createMessageSchema, updateMessageSchema, addReactionSchema }

/**
 * Normalize input to both JSON and markdown formats.
 * - If JSON provided: serialize to markdown
 * - If markdown provided: normalize emoji, parse to JSON
 * Emoji normalization converts raw emoji (👍) to shortcodes (:+1:).
 */
function normalizeContent(input: z.infer<typeof createMessageSchema> | z.infer<typeof updateMessageSchema>): {
  contentJson: JSONContent
  contentMarkdown: string
} {
  if ("contentJson" in input) {
    // Rich client: JSON provided, trust it and derive markdown
    const contentMarkdown = input.contentMarkdown ?? serializeToMarkdown(input.contentJson)
    return { contentJson: input.contentJson, contentMarkdown }
  } else {
    // AI/external: Markdown provided, normalize and parse to JSON
    const normalizedMarkdown = normalizeMessage(input.content)
    const contentJson = parseMarkdown(normalizedMarkdown, undefined, toEmoji)
    return { contentJson, contentMarkdown: normalizedMarkdown }
  }
}

function serializeMessage(msg: Message) {
  return serializeBigInt(msg)
}

interface DetectedCommand {
  name: string
  args: string
}

/**
 * Detect if the first inline node is a command.
 * Currently only checks the very first element - function name allows future expansion.
 */
function detectCommand(contentJson: JSONContent): DetectedCommand | null {
  const firstBlock = contentJson.content?.[0]
  if (firstBlock?.type !== "paragraph") return null

  const firstInline = firstBlock.content?.[0]
  if (firstInline?.type !== "command") return null

  const attrs = firstInline.attrs as { name: string; args?: string } | undefined
  if (!attrs?.name) return null

  return {
    name: attrs.name,
    args: attrs.args ?? "",
  }
}

interface Dependencies {
  pool: Pool
  eventService: EventService
  streamService: StreamService
  commandRegistry: CommandRegistry
}

export function createMessageHandlers({ pool, eventService, streamService, commandRegistry }: Dependencies) {
  return {
    async create(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!

      const result = createMessageSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const data = result.data
      const attachmentIds = data.attachmentIds

      const stream = await streamService.resolveWritableMessageStream({
        workspaceId,
        memberId,
        target: "dmMemberId" in data ? { dmMemberId: data.dmMemberId } : { streamId: data.streamId },
      })
      const streamId = stream.id

      // Check for slash command in first node BEFORE normalization (normalization loses command nodes)
      const originalContentJson = "contentJson" in data ? data.contentJson : undefined
      const detectedCommand = originalContentJson ? detectCommand(originalContentJson) : null

      if (detectedCommand && commandRegistry.has(detectedCommand.name)) {
        // Route to command dispatch instead of message creation
        const cmdId = generateCommandId()
        const evtId = eventId()

        const event = await withTransaction(pool, async (client) => {
          const evt = await StreamEventRepository.insert(client, {
            id: evtId,
            streamId,
            eventType: "command_dispatched",
            payload: {
              commandId: cmdId,
              name: detectedCommand.name,
              args: detectedCommand.args,
              status: "dispatched",
            } satisfies CommandDispatchedPayload,
            actorId: memberId,
            actorType: "member",
          })

          await OutboxRepository.insert(client, "command:dispatched", {
            workspaceId,
            streamId,
            event: serializeBigInt(evt),
            authorId: memberId,
          })

          return evt
        })

        return res.status(202).json({
          command: {
            id: cmdId,
            name: detectedCommand.name,
            args: detectedCommand.args,
            status: "dispatched",
          },
          event: serializeBigInt(event),
        })
      }

      // Normalize to both JSON and markdown formats for normal message creation
      const { contentJson, contentMarkdown } = normalizeContent(data)

      // Normal message creation
      const message = await eventService.createMessage({
        workspaceId,
        streamId,
        authorId: memberId,
        authorType: "member",
        contentJson,
        contentMarkdown,
        attachmentIds,
      })

      res.status(201).json({ message: serializeMessage(message) })
    },

    async update(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { messageId } = req.params

      const result = updateMessageSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (existing.deletedAt) {
        return res.status(410).json({ error: "Cannot edit a deleted message" })
      }

      const [stream, isMember] = await Promise.all([
        streamService.getStreamById(existing.streamId),
        streamService.isMember(existing.streamId, memberId),
      ])

      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      if (existing.authorId !== memberId) {
        return res.status(403).json({ error: "Can only edit your own messages" })
      }

      // Normalize to both JSON and markdown formats
      const { contentJson, contentMarkdown } = normalizeContent(result.data)

      const message = await eventService.editMessage({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        contentJson,
        contentMarkdown,
        actorId: memberId,
      })

      if (!message) {
        return res.status(404).json({ error: "Message not found" })
      }

      res.json({ message: serializeMessage(message) })
    },

    async delete(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { messageId } = req.params

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (existing.deletedAt) {
        return res.status(204).send()
      }

      const [stream, isMember] = await Promise.all([
        streamService.getStreamById(existing.streamId),
        streamService.isMember(existing.streamId, memberId),
      ])

      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      if (existing.authorId !== memberId) {
        return res.status(403).json({ error: "Can only delete your own messages" })
      }

      await eventService.deleteMessage({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        actorId: memberId,
      })

      res.status(204).send()
    },

    async addReaction(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { messageId } = req.params

      const result = addReactionSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const shortcode = toShortcode(result.data.emoji)
      if (!shortcode) {
        return res.status(400).json({ error: "Invalid emoji" })
      }

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      const [stream, isMember] = await Promise.all([
        streamService.getStreamById(existing.streamId),
        streamService.isMember(existing.streamId, memberId),
      ])

      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const message = await eventService.addReaction({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        emoji: shortcode,
        memberId,
      })

      if (!message) {
        return res.status(404).json({ error: "Message not found" })
      }

      res.json({ message: serializeMessage(message) })
    },

    async removeReaction(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { messageId, emoji } = req.params

      const shortcode = toShortcode(emoji)
      if (!shortcode) {
        return res.status(400).json({ error: "Invalid emoji" })
      }

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      const [stream, isMember] = await Promise.all([
        streamService.getStreamById(existing.streamId),
        streamService.isMember(existing.streamId, memberId),
      ])

      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const message = await eventService.removeReaction({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        emoji: shortcode,
        memberId,
      })

      if (!message) {
        return res.status(404).json({ error: "Message not found" })
      }

      res.json({ message: serializeMessage(message) })
    },

    async getHistory(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { messageId } = req.params

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      const [stream, isMember] = await Promise.all([
        streamService.getStreamById(existing.streamId),
        streamService.isMember(existing.streamId, memberId),
      ])

      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const versions = await eventService.getMessageVersions(messageId)
      res.json({ versions: versions.map(serializeBigInt) })
    },
  }
}
