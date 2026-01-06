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

const MESSAGES_BEFORE = 5
const MESSAGES_AFTER = 2

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

      // For scratchpads, treat the entire stream as one conversation
      // Skip boundary detection entirely - all messages belong to the same conversation
      if (stream.type === StreamTypes.SCRATCHPAD) {
        return this.processScratchpadMessage(client, message, streamId, workspaceId)
      }

      // Get messages surrounding the target message (not just recent)
      // This ensures correct behavior for queue catch-up, replays, and historic processing
      const surroundingMessages = await MessageRepository.findSurrounding(
        client,
        messageId,
        streamId,
        MESSAGES_BEFORE,
        MESSAGES_AFTER
      )

      // For surrounding messages that are thread roots, also fetch their thread messages
      // This handles cases where someone replies flat in channel when others are in a thread
      const threadRootIds = surroundingMessages.filter((m) => m.replyCount > 0).map((m) => m.id)
      const threadMessagesByParent = await MessageRepository.findThreadMessages(client, threadRootIds)
      const allThreadMessages = Array.from(threadMessagesByParent.values()).flat()

      // Combine surrounding + thread messages for conversation lookup
      const allContextMessages = [...surroundingMessages, ...allThreadMessages]
      const allContextMessageIds = allContextMessages.map((m) => m.id)

      // Find conversations based on all context messages (not all active in stream)
      // This scopes context to temporally relevant conversations
      const relevantConversations = await ConversationRepository.findByMessageIds(client, allContextMessageIds)

      // For threads, look up conversations containing the parent message
      let parentMessageConversations: Conversation[] = []
      if (stream.type === StreamTypes.THREAD && stream.parentMessageId) {
        parentMessageConversations = await ConversationRepository.findByMessageId(client, stream.parentMessageId)
      }

      const context: ExtractionContext = {
        newMessage: message,
        recentMessages: allContextMessages,
        activeConversations: await this.buildConversationSummaries(client, relevantConversations, allContextMessages),
        streamType: stream.type,
        parentMessageConversations:
          parentMessageConversations.length > 0
            ? await this.buildConversationSummaries(client, parentMessageConversations, [])
            : undefined,
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
        // Security: Only allow updates to conversations found via surrounding messages
        // LLM output could potentially contain IDs from other streams/workspaces
        const validConvIds = new Set(relevantConversations.map((c) => c.id))

        for (const update of result.completenessUpdates) {
          if (!validConvIds.has(update.conversationId)) {
            logger.warn(
              { conversationId: update.conversationId, streamId },
              "LLM attempted to update conversation not in active set - skipping"
            )
            continue
          }

          await ConversationRepository.update(client, update.conversationId, {
            completenessScore: update.score,
            status: update.status,
          })
        }
      }

      // For thread conversations, include parent channel's stream ID for discoverability
      let parentStreamId: string | undefined
      if (stream.type === StreamTypes.THREAD && stream.parentMessageId) {
        const parentMessage = await MessageRepository.findById(client, stream.parentMessageId)
        parentStreamId = parentMessage?.streamId
      }

      if (isNew) {
        await OutboxRepository.insert(client, "conversation:created", {
          workspaceId,
          streamId,
          conversationId: conversation.id,
          conversation: addStalenessFields(conversation),
          parentStreamId,
        })
      } else {
        await OutboxRepository.insert(client, "conversation:updated", {
          workspaceId,
          streamId,
          conversationId: conversation.id,
          conversation: addStalenessFields(conversation),
          parentStreamId,
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

  /**
   * For scratchpads, all messages belong to a single conversation.
   * Find or create the stream's conversation and add the message to it.
   */
  private async processScratchpadMessage(
    client: PoolClient,
    message: Message,
    streamId: string,
    workspaceId: string
  ): Promise<Conversation> {
    // Find existing conversation for this scratchpad
    const existingConversations = await ConversationRepository.findByStream(client, streamId)
    const existingConversation = existingConversations.find((c) => c.status === ConversationStatuses.ACTIVE)

    let conversation: Conversation
    let isNew = false

    if (existingConversation) {
      // Add message to existing conversation
      const withMessage = await ConversationRepository.addMessage(client, existingConversation.id, message.id)
      if (!withMessage) {
        logger.warn({ conversationId: existingConversation.id }, "Failed to add message to scratchpad conversation")
        return existingConversation
      }
      const withParticipant = await ConversationRepository.addParticipant(
        client,
        existingConversation.id,
        message.authorId
      )
      conversation = withParticipant ?? withMessage
    } else {
      // Create new conversation for this scratchpad
      conversation = await ConversationRepository.insert(client, {
        id: conversationId(),
        streamId,
        workspaceId,
        messageIds: [message.id],
        participantIds: [message.authorId],
        topicSummary: "Scratchpad",
        confidence: 1.0,
        status: ConversationStatuses.ACTIVE,
      })
      isNew = true
    }

    if (isNew) {
      await OutboxRepository.insert(client, "conversation:created", {
        workspaceId,
        streamId,
        conversationId: conversation.id,
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

    logger.debug({ messageId: message.id, conversationId: conversation.id, isNew }, "Scratchpad message processed")

    return conversation
  }

  private async buildConversationSummaries(
    client: PoolClient,
    conversations: Conversation[],
    recentMessages: Message[]
  ): Promise<ConversationSummary[]> {
    const recentMessageMap = new Map(recentMessages.map((m) => [m.id, m]))

    // Collect message IDs that need fetching (not in recent window)
    const missingIds: string[] = []
    for (const c of conversations) {
      const lastMessageId = c.messageIds[c.messageIds.length - 1]
      if (lastMessageId && !recentMessageMap.has(lastMessageId)) {
        missingIds.push(lastMessageId)
      }
    }

    // Batch fetch missing messages
    const fetchedMessages = missingIds.length > 0 ? await MessageRepository.findByIds(client, missingIds) : new Map()

    return conversations.map((c) => {
      const lastMessageId = c.messageIds[c.messageIds.length - 1]
      const lastMessage = recentMessageMap.get(lastMessageId) ?? fetchedMessages.get(lastMessageId)

      return {
        id: c.id,
        topicSummary: c.topicSummary,
        messageCount: c.messageIds.length,
        lastMessagePreview: lastMessage?.content.slice(0, 100) ?? "",
        participantIds: c.participantIds,
        completenessScore: c.completenessScore,
      }
    })
  }
}
