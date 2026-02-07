import { z } from "zod"
import type { Request, Response } from "express"
import type { ConversationService } from "../services/conversation-service"
import type { StreamService } from "../services/stream-service"
import { CONVERSATION_STATUSES } from "@threa/types"

const listConversationsSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
})

interface Dependencies {
  conversationService: ConversationService
  streamService: StreamService
}

export function createConversationHandlers({ conversationService, streamService }: Dependencies) {
  return {
    async listByStream(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { streamId } = req.params

      const result = listConversationsSchema.safeParse(req.query)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      // Validate stream exists, belongs to workspace, and user has access
      const [stream, isMember] = await Promise.all([
        streamService.getStreamById(streamId),
        streamService.isMember(streamId, memberId),
      ])

      if (!stream || stream.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Stream not found" })
      }

      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const conversations = await conversationService.listByStream(streamId, result.data)
      res.json({ conversations })
    },

    async getById(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { conversationId } = req.params

      const conversation = await conversationService.getById(conversationId)
      if (!conversation || conversation.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Conversation not found" })
      }

      // Validate user has access to the conversation's stream
      const isMember = await streamService.isMember(conversation.streamId, memberId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      res.json({ conversation })
    },

    async getMessages(req: Request, res: Response) {
      const memberId = req.member!.id
      const workspaceId = req.workspaceId!
      const { conversationId } = req.params

      const conversation = await conversationService.getById(conversationId)
      if (!conversation || conversation.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Conversation not found" })
      }

      // Validate user has access to the conversation's stream
      const isMember = await streamService.isMember(conversation.streamId, memberId)
      if (!isMember) {
        return res.status(403).json({ error: "Not a member of this stream" })
      }

      const messages = await conversationService.getMessages(conversationId)
      res.json({ messages })
    },
  }
}
