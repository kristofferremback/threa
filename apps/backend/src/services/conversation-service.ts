import { Pool } from "pg"
import { withClient } from "../db"
import { ConversationRepository } from "../repositories/conversation-repository"
import { MessageRepository, type Message } from "../repositories/message-repository"
import { addStalenessFields, type ConversationWithStaleness } from "../lib/conversation-staleness"
import type { ConversationStatus } from "@threa/types"

export { ConversationWithStaleness }

export interface ListConversationsOptions {
  status?: ConversationStatus
  limit?: number
}

/**
 * Public interface for querying conversations.
 * Computes temporal staleness on read.
 */
export class ConversationService {
  constructor(private pool: Pool) {}

  async getById(conversationId: string): Promise<ConversationWithStaleness | null> {
    return withClient(this.pool, async (client) => {
      const conversation = await ConversationRepository.findById(client, conversationId)
      if (!conversation) return null
      return addStalenessFields(conversation)
    })
  }

  async listByStream(streamId: string, options?: ListConversationsOptions): Promise<ConversationWithStaleness[]> {
    return withClient(this.pool, async (client) => {
      // Include conversations from child threads - for discoverability
      const conversations = await ConversationRepository.findByStreamIncludingThreads(client, streamId, options)
      return conversations.map(addStalenessFields)
    })
  }

  async listByMessage(messageId: string): Promise<ConversationWithStaleness[]> {
    return withClient(this.pool, async (client) => {
      const conversations = await ConversationRepository.findByMessageId(client, messageId)
      return conversations.map(addStalenessFields)
    })
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return withClient(this.pool, async (client) => {
      const conversation = await ConversationRepository.findById(client, conversationId)
      if (!conversation || conversation.messageIds.length === 0) return []

      const messagesMap = await MessageRepository.findByIds(client, conversation.messageIds)

      // Return messages in the order they appear in the conversation
      return conversation.messageIds.map((id) => messagesMap.get(id)).filter((m): m is Message => m !== undefined)
    })
  }
}
