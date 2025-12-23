import { Pool } from "pg"
import { withClient } from "../db"
import { ConversationRepository, type Conversation } from "../repositories/conversation-repository"
import type { ConversationStatus } from "@threa/types"

export interface ConversationWithStaleness extends Conversation {
  temporalStaleness: number
  effectiveCompleteness: number
}

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
      return this.addStaleness(conversation)
    })
  }

  async listByStream(streamId: string, options?: ListConversationsOptions): Promise<ConversationWithStaleness[]> {
    return withClient(this.pool, async (client) => {
      const conversations = await ConversationRepository.findByStream(client, streamId, options)
      return conversations.map((c) => this.addStaleness(c))
    })
  }

  async listByMessage(messageId: string): Promise<ConversationWithStaleness[]> {
    return withClient(this.pool, async (client) => {
      const conversations = await ConversationRepository.findByMessageId(client, messageId)
      return conversations.map((c) => this.addStaleness(c))
    })
  }

  private addStaleness(conversation: Conversation): ConversationWithStaleness {
    const staleness = this.computeStaleness(conversation.lastActivityAt)
    return {
      ...conversation,
      temporalStaleness: staleness,
      effectiveCompleteness: this.combineCompleteness(conversation.completenessScore, staleness),
    }
  }

  private computeStaleness(lastActivityAt: Date): number {
    const hours = (Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60)
    if (hours < 1) return 0
    if (hours < 4) return 1
    if (hours < 12) return 2
    if (hours < 24) return 3
    return 4
  }

  private combineCompleteness(contentScore: number, staleness: number): number {
    return Math.min(7, contentScore + staleness)
  }
}
