import type { Request, Response } from "express"
import type { EventService } from "../services/event-service"
import type { StreamService } from "../services/stream-service"
import type { Message } from "../repositories"
import { serializeBigInt } from "../lib/serialization"
import { toShortcode } from "../lib/emoji"

function serializeMessage(msg: Message) {
  return serializeBigInt(msg)
}

interface Dependencies {
  eventService: EventService
  streamService: StreamService
}

export function createMessageHandlers({ eventService, streamService }: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      const userId = req.userId!
      const { streamId } = req.params
      const { limit, before } = req.query

      const isMember = await streamService.isMember(streamId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const messages = await eventService.getMessages(streamId, {
        limit: limit ? parseInt(limit as string, 10) : undefined,
        beforeSequence: before ? BigInt(before as string) : undefined,
      })

      res.json({ messages: messages.map(serializeMessage) })
    },

    async create(req: Request, res: Response) {
      const userId = req.userId!
      const { streamId } = req.params
      const { content, contentFormat } = req.body

      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Content is required" })
      }

      const isMember = await streamService.isMember(streamId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const message = await eventService.createMessage({
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
      const { messageId } = req.params
      const { content } = req.body

      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Content is required" })
      }

      // Get message to check ownership and get streamId
      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (existing.authorId !== userId) {
        return res.status(403).json({ error: "Can only edit your own messages" })
      }

      const message = await eventService.editMessage({
        messageId,
        streamId: existing.streamId,
        content,
        actorId: userId,
      })

      if (!message) {
        return res.status(404).json({ error: "Message not found" })
      }

      res.json({ message: serializeMessage(message) })
    },

    async delete(req: Request, res: Response) {
      const userId = req.userId!
      const { messageId } = req.params

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      if (existing.authorId !== userId) {
        return res.status(403).json({ error: "Can only delete your own messages" })
      }

      await eventService.deleteMessage({
        messageId,
        streamId: existing.streamId,
        actorId: userId,
      })

      res.status(204).send()
    },

    async addReaction(req: Request, res: Response) {
      const userId = req.userId!
      const { messageId } = req.params
      const { emoji } = req.body

      if (!emoji || typeof emoji !== "string") {
        return res.status(400).json({ error: "Emoji is required" })
      }

      // Normalize to shortcode format (accepts both raw emoji and shortcodes)
      const shortcode = toShortcode(emoji)
      if (!shortcode) {
        return res.status(400).json({ error: "Invalid emoji" })
      }

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      const isMember = await streamService.isMember(existing.streamId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const message = await eventService.addReaction({
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
      const { messageId, emoji } = req.params

      // Normalize to shortcode format (accepts both raw emoji and shortcodes)
      const shortcode = toShortcode(emoji)
      if (!shortcode) {
        return res.status(400).json({ error: "Invalid emoji" })
      }

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      const isMember = await streamService.isMember(existing.streamId, userId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const message = await eventService.removeReaction({
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
