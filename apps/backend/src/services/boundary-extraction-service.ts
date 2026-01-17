import type { Pool, PoolClient } from "pg"
import { sql, withTransaction } from "../db"
import { ConversationRepository, type Conversation } from "../repositories/conversation-repository"
import { MessageRepository, type Message } from "../repositories/message-repository"
import { StreamRepository, type Stream } from "../repositories/stream-repository"
import { OutboxRepository } from "../repositories/outbox-repository"
import type { BoundaryExtractor, ExtractionContext, ConversationSummary } from "../lib/boundary-extraction/types"
import type { CompletenessUpdate } from "../lib/boundary-extraction/types"
import { addStalenessFields } from "../lib/conversation-staleness"
import { conversationId } from "../lib/id"
import { ConversationStatuses, StreamTypes } from "@threa/types"
import { logger } from "../lib/logger"

const MESSAGES_BEFORE = 5
const MESSAGES_AFTER = 2

interface ConversationDecision {
  conversationId: string | null
  newTopic?: string
  confidence: number
  completenessUpdates?: CompletenessUpdate[]
  /** IDs of conversations that are valid targets for completeness updates (security) */
  validUpdateTargets?: Set<string>
}

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

      // Determine which conversation this message belongs to
      const decision =
        stream.type === StreamTypes.SCRATCHPAD
          ? await this.determineScratchpadConversation(client, stream)
          : await this.determineConversationViaExtractor(client, message, stream)

      // Create or update the conversation
      let conversation: Conversation
      let isNew = false

      if (decision.conversationId) {
        const withMessage = await ConversationRepository.addMessage(client, decision.conversationId, messageId)
        if (!withMessage) {
          logger.warn({ conversationId: decision.conversationId }, "Failed to add message to conversation")
          return null
        }
        const withParticipant = await ConversationRepository.addParticipant(
          client,
          decision.conversationId,
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
          topicSummary: decision.newTopic,
          confidence: decision.confidence,
          status: ConversationStatuses.ACTIVE,
        })
        isNew = true
      }

      // Apply completeness updates (if any)
      if (decision.completenessUpdates && decision.validUpdateTargets) {
        for (const update of decision.completenessUpdates) {
          if (!decision.validUpdateTargets.has(update.conversationId)) {
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

      // Publish outbox event
      const eventType = isNew ? "conversation:created" : "conversation:updated"
      await OutboxRepository.insert(client, eventType, {
        workspaceId,
        streamId,
        conversationId: conversation.id,
        conversation: addStalenessFields(conversation),
        parentStreamId,
      })

      logger.info(
        {
          messageId,
          conversationId: conversation.id,
          isNew,
          confidence: decision.confidence,
        },
        "Boundary extraction complete"
      )

      return conversation
    })
  }

  /**
   * Scratchpads have one conversation - find it or signal to create one.
   */
  private async determineScratchpadConversation(client: PoolClient, stream: Stream): Promise<ConversationDecision> {
    // Lock the stream row to prevent race conditions when multiple messages
    // arrive simultaneously for the same scratchpad (INV-20)
    await client.query(sql`SELECT id FROM streams WHERE id = ${stream.id} FOR UPDATE`)

    const existingConversations = await ConversationRepository.findByStream(client, stream.id)
    const activeConversation = existingConversations.find((c) => c.status === ConversationStatuses.ACTIVE)

    if (activeConversation) {
      return {
        conversationId: activeConversation.id,
        confidence: 1.0,
      }
    }

    return {
      conversationId: null,
      newTopic: stream.displayName ?? "Scratchpad",
      confidence: 1.0,
    }
  }

  /**
   * Channels/threads use LLM extraction to determine conversation boundaries.
   */
  private async determineConversationViaExtractor(
    client: PoolClient,
    message: Message,
    stream: Stream
  ): Promise<ConversationDecision> {
    // Get messages surrounding the target message (not just recent)
    // This ensures correct behavior for queue catch-up, replays, and historic processing
    const surroundingMessages = await MessageRepository.findSurrounding(
      client,
      message.id,
      stream.id,
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
      workspaceId: stream.workspaceId,
    }

    const result = await this.extractor.extract(context)

    return {
      conversationId: result.conversationId,
      newTopic: result.newConversationTopic ?? undefined,
      confidence: result.confidence,
      completenessUpdates: result.completenessUpdates,
      validUpdateTargets: new Set(relevantConversations.map((c) => c.id)),
    }
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
        lastMessagePreview: lastMessage?.contentMarkdown.slice(0, 100) ?? "",
        participantIds: c.participantIds,
        completenessScore: c.completenessScore,
      }
    })
  }
}
