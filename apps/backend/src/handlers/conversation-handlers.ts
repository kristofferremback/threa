import { z } from "zod"
import type { Request, Response } from "express"
import type { ConversationService } from "../services/conversation-service"
import { CONVERSATION_STATUSES } from "@threa/types"

const listConversationsSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
})

interface Dependencies {
  conversationService: ConversationService
}

export function createConversationHandlers({ conversationService }: Dependencies) {
  return {
    async listByStream(req: Request, res: Response) {
      const { streamId } = req.params

      const result = listConversationsSchema.safeParse(req.query)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const conversations = await conversationService.listByStream(streamId, result.data)
      res.json({ conversations })
    },

    async getById(req: Request, res: Response) {
      const { conversationId } = req.params

      const conversation = await conversationService.getById(conversationId)
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" })
      }

      res.json({ conversation })
    },
  }
}
