import type { Request, Response } from "express"
import type { EventService } from "../services/event-service"
import type { StreamService } from "../services/stream-service"
import type { WorkspaceService } from "../services/workspace-service"
import type { Message } from "../repositories"
import { serializeBigInt } from "../lib/serialization"
import { toShortcode } from "../lib/emoji"

function serializeMessage(msg: Message) {
  return serializeBigInt(msg)
}

interface Dependencies {
  eventService: EventService
  streamService: StreamService
  workspaceService: WorkspaceService
}

export function createMessageHandlers({ eventService, streamService, workspaceService }: Dependencies) {
  return {
    async create(req: Request, res: Response) {
      const userId = req.userId!
      const { workspaceId } = req.params
      const { streamId, content, contentFormat } = req.body

      if (!streamId || typeof streamId !== "string") {
        return res.status(400).json({ error: "streamId is required" })
      }

      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Content is required" })
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

      // Verify user is member of stream
      const isStreamMember = await streamService.isMember(streamId, userId)
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
      const { workspaceId, messageId } = req.params
      const { content } = req.body

      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Content is required" })
      }

      // Verify workspace membership
      const isWorkspaceMember = await workspaceService.isMember(workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      // Get message to check ownership and verify stream belongs to workspace
      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      // Verify message's stream belongs to workspace
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
      const { workspaceId, messageId } = req.params

      // Verify workspace membership
      const isWorkspaceMember = await workspaceService.isMember(workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      // Verify message's stream belongs to workspace
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
      const { workspaceId, messageId } = req.params
      const { emoji } = req.body

      if (!emoji || typeof emoji !== "string") {
        return res.status(400).json({ error: "Emoji is required" })
      }

      // Normalize to shortcode format (accepts both raw emoji and shortcodes)
      const shortcode = toShortcode(emoji)
      if (!shortcode) {
        return res.status(400).json({ error: "Invalid emoji" })
      }

      // Verify workspace membership
      const isWorkspaceMember = await workspaceService.isMember(workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      // Verify message's stream belongs to workspace
      const stream = await streamService.getStreamById(existing.streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Message not found" })
      }

      const isMember = await streamService.isMember(existing.streamId, userId)
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
      const { workspaceId, messageId, emoji } = req.params

      // Normalize to shortcode format (accepts both raw emoji and shortcodes)
      const shortcode = toShortcode(emoji)
      if (!shortcode) {
        return res.status(400).json({ error: "Invalid emoji" })
      }

      // Verify workspace membership
      const isWorkspaceMember = await workspaceService.isMember(workspaceId, userId)
      if (!isWorkspaceMember) {
        return res.status(403).json({ error: "Not a member of this workspace" })
      }

      const existing = await eventService.getMessageById(messageId)
      if (!existing) {
        return res.status(404).json({ error: "Message not found" })
      }

      // Verify message's stream belongs to workspace
      const stream = await streamService.getStreamById(existing.streamId)
      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Message not found" })
      }

      const isMember = await streamService.isMember(existing.streamId, userId)
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
