import { z } from "zod"
import type { Request, Response } from "express"
import type { EventService } from "../services/event-service"
import type { StreamService } from "../services/stream-service"
import type { Message } from "../repositories"
import { serializeBigInt } from "../lib/serialization"
import { toShortcode } from "../lib/emoji"
import { contentFormatSchema } from "../lib/schemas"

const createMessageSchema = z.object({
  streamId: z.string().min(1, "streamId is required"),
  content: z.string().min(1, "content is required"),
  contentFormat: contentFormatSchema.optional(),
})

const updateMessageSchema = z.object({
  content: z.string().min(1, "content is required"),
})

const addReactionSchema = z.object({
  emoji: z.string().min(1, "emoji is required"),
})

export { createMessageSchema, updateMessageSchema, addReactionSchema }

function serializeMessage(msg: Message) {
  return serializeBigInt(msg)
}

interface Dependencies {
  eventService: EventService
  streamService: StreamService
}

export function createMessageHandlers({ eventService, streamService }: Dependencies) {
  return {
    async create(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!

      const result = createMessageSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { streamId, content, contentFormat } = result.data

      const [stream, isStreamMember] = await Promise.all([
        streamService.getStreamById(streamId),
        streamService.isMember(streamId, userId),
      ])

      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Stream not found" })
      }

      if (!isStreamMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const message = await eventService.createMessage({
        workspaceId,
        streamId,
        authorId: userId,
        authorType: "user",
        content,
        contentFormat,
      })

      res.status(201).json({ message: serializeMessage(message) })
    },

    async update(req: Request, res: Response) {
      const userId = req.userId!
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

      const stream = await streamService.getStreamById(existing.streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (existing.authorId !== userId) {
        return res.status(403).json({ error: "Can only edit your own messages" })
      }

      const message = await eventService.editMessage({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        content: result.data.content,
        actorId: userId,
      })

      if (!message) {
        return res.status(404).json({ error: "Message not found" })
      }

      res.json({ message: serializeMessage(message) })
    },

    async delete(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!
      const { messageId } = req.params

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      const stream = await streamService.getStreamById(existing.streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (existing.authorId !== userId) {
        return res.status(403).json({ error: "Can only delete your own messages" })
      }

      await eventService.deleteMessage({
        workspaceId,
        messageId,
        streamId: existing.streamId,
        actorId: userId,
      })

      res.status(204).send()
    },

    async addReaction(req: Request, res: Response) {
      const userId = req.userId!
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
        streamService.isMember(existing.streamId, userId),
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
        userId,
      })

      if (!message) {
        return res.status(404).json({ error: "Message not found" })
      }

      res.json({ message: serializeMessage(message) })
    },

    async removeReaction(req: Request, res: Response) {
      const userId = req.userId!
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
        streamService.isMember(existing.streamId, userId),
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
        userId,
      })

      if (!message) {
        return res.status(404).json({ error: "Message not found" })
      }

      res.json({ message: serializeMessage(message) })
    },
  }
}
