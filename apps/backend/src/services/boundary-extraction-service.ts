import type { Pool, PoolClient } from "pg"
import { withTransaction } from "../db"
import { ConversationRepository, type Conversation } from "../repositories/conversation-repository"
import { MessageRepository, type Message } from "../repositories/message-repository"
import { StreamRepository } from "../repositories/stream-repository"
import { OutboxRepository } from "../repositories/outbox-repository"
import type { BoundaryExtractor, ExtractionContext, ConversationSummary } from "../lib/boundary-extraction/types"
import { addStalenessFields } from "../lib/conversation-staleness"
import { conversationId } from "../lib/id"
import { ConversationStatuses, StreamTypes } from "@threa/types"
import { logger } from "../lib/logger"

const WINDOW_SIZE = 5

export class BoundaryExtractionService {
  constructor(
    private pool: Pool,
    private extractor: BoundaryExtractor
  ) {}

  async processMessage(messageId: string, streamId: string, workspaceId: string): Promise<Conversation | null> {
    return withTransaction(this.pool, async (client) => {
      const message = await MessageRepository.findById(client, messageId)
      if (!message) {
        logger.warn({ messageId }, "Message not found for boundary extraction")
        return null
      }

      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        logger.warn({ streamId }, "Stream not found for boundary extraction")
        return null
      }

      const recentMessages = await MessageRepository.list(client, streamId, { limit: WINDOW_SIZE })
      const activeConversations = await ConversationRepository.findActiveByStream(client, streamId)

      const context: ExtractionContext = {
        newMessage: message,
        recentMessages,
        activeConversations: await this.buildConversationSummaries(client, activeConversations, recentMessages),
        streamType: stream.type,
        isThread: stream.type === StreamTypes.THREAD,
      }

      const result = await this.extractor.extract(context)

      let conversation: Conversation
      let isNew = false

      if (result.conversationId) {
        const withMessage = await ConversationRepository.addMessage(client, result.conversationId, messageId)
        if (!withMessage) {
          logger.warn({ conversationId: result.conversationId }, "Failed to add message to conversation")
          return null
        }
        const withParticipant = await ConversationRepository.addParticipant(
          client,
          result.conversationId,
          message.authorId
        )
        conversation = withParticipant ?? withMessage
      } else {
        conversation = await ConversationRepository.insert(client, {
          id: conversationId(),
          streamId,
          workspaceId,
          messageIds: [messageId],
          participantIds: [message.authorId],
          topicSummary: result.newConversationTopic,
          confidence: result.confidence,
          status: ConversationStatuses.ACTIVE,
        })
        isNew = true
      }

      if (result.completenessUpdates) {
        for (const update of result.completenessUpdates) {
          await ConversationRepository.update(client, update.conversationId, {
            completenessScore: update.score,
            status: update.status,
          })
        }
      }

      if (isNew) {
        await OutboxRepository.insert(client, "conversation:created", {
          workspaceId,
          streamId,
          conversation: addStalenessFields(conversation),
        })
      } else {
        await OutboxRepository.insert(client, "conversation:updated", {
          workspaceId,
          streamId,
          conversationId: conversation.id,
          conversation: addStalenessFields(conversation),
        })
      }

      logger.info(
        {
          messageId,
          conversationId: conversation.id,
          isNew,
          confidence: result.confidence,
        },
        "Boundary extraction complete"
      )

      return conversation
    })
  }

  private async buildConversationSummaries(
    client: PoolClient,
    conversations: Conversation[],
    recentMessages: Message[]
  ): Promise<ConversationSummary[]> {
    const recentMessageMap = new Map(recentMessages.map((m) => [m.id, m]))

    return Promise.all(
      conversations.map(async (c) => {
        const lastMessageId = c.messageIds[c.messageIds.length - 1]
        let lastMessage = recentMessageMap.get(lastMessageId)

        // Fetch the last message if not in the recent window
        if (!lastMessage && lastMessageId) {
          lastMessage = (await MessageRepository.findById(client, lastMessageId)) ?? undefined
        }

        return {
          id: c.id,
          topicSummary: c.topicSummary,
          messageCount: c.messageIds.length,
          lastMessagePreview: lastMessage?.content.slice(0, 100) ?? "",
          participantIds: c.participantIds,
          completenessScore: c.completenessScore,
        }
      })
    )
  }
}
