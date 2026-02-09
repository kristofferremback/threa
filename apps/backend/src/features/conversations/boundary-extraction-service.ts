import type { Pool, PoolClient } from "pg"
import { sql, withTransaction, withClient } from "../../db"
import { ConversationRepository, type Conversation } from "./repository"
import { MessageRepository, type Message } from "../../repositories"
import { StreamRepository, type Stream } from "../streams"
import { OutboxRepository } from "../../lib/outbox"
import type { BoundaryExtractor, ExtractionContext, ConversationSummary } from "./boundary-extraction/types"
import type { CompletenessUpdate } from "./boundary-extraction/types"
import { addStalenessFields } from "./staleness"
import { conversationId } from "../../lib/id"
import { ConversationStatuses, StreamTypes } from "@threa/types"
import { logger } from "../../lib/logger"

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

  /**
   * Process a message for boundary extraction.
   *
   * IMPORTANT: This method uses the three-phase pattern (INV-41) to avoid holding
   * database connections during AI calls (which can take 1-5+ seconds):
   *
   * Phase 1: Fetch all data with withClient (~100-200ms)
   * Phase 2: AI extraction with no database connection held (1-5+ seconds for channels/threads)
   * Phase 3: Save result with withTransaction, re-checking state for scratchpads (~100ms)
   *
   * For scratchpads: No AI call needed, simple find-or-create logic
   * For channels/threads: AI extraction determines conversation boundaries
   */
  async processMessage(messageId: string, streamId: string, workspaceId: string): Promise<Conversation | null> {
    // Phase 1: Fetch all data with withClient (no transaction, fast reads ~100-200ms)
    const fetchedData = await withClient(this.pool, async (client) => {
      const message = await MessageRepository.findById(client, messageId)
      if (!message) {
        return { message: null, stream: null, extractionContext: null }
      }

      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        return { message: null, stream: null, extractionContext: null }
      }

      // For scratchpads: Just fetch existing conversations (no AI needed)
      if (stream.type === StreamTypes.SCRATCHPAD) {
        const existingConversations = await ConversationRepository.findByStream(client, stream.id)
        return {
          message,
          stream,
          extractionContext: null,
          scratchpadConversations: existingConversations,
        }
      }

      // For channels/threads: Fetch all context needed for AI extraction
      const surroundingMessages = await MessageRepository.findSurrounding(
        client,
        message.id,
        stream.id,
        MESSAGES_BEFORE,
        MESSAGES_AFTER
      )

      const threadRootIds = surroundingMessages.filter((m) => m.replyCount > 0).map((m) => m.id)
      const threadMessagesByParent = await MessageRepository.findThreadMessages(client, threadRootIds)
      const allThreadMessages = Array.from(threadMessagesByParent.values()).flat()

      const allContextMessages = [...surroundingMessages, ...allThreadMessages]
      const allContextMessageIds = allContextMessages.map((m) => m.id)

      const relevantConversations = await ConversationRepository.findByMessageIds(client, allContextMessageIds)

      let parentMessageConversations: Conversation[] = []
      if (stream.type === StreamTypes.THREAD && stream.parentMessageId) {
        parentMessageConversations = await ConversationRepository.findByMessageId(client, stream.parentMessageId)
      }

      // Build conversation summaries
      const activeConversations = await this.buildConversationSummaries(
        client,
        relevantConversations,
        allContextMessages
      )
      const parentConversations =
        parentMessageConversations.length > 0
          ? await this.buildConversationSummaries(client, parentMessageConversations, [])
          : undefined

      const extractionContext: ExtractionContext = {
        newMessage: message,
        recentMessages: allContextMessages,
        activeConversations,
        streamType: stream.type,
        parentMessageConversations: parentConversations,
        workspaceId: stream.workspaceId,
      }

      return {
        message,
        stream,
        extractionContext,
        validUpdateTargets: new Set(relevantConversations.map((c) => c.id)),
      }
    })

    // Early exit if message or stream not found
    if (!fetchedData.message || !fetchedData.stream) {
      logger.warn({ messageId, streamId }, "Message or stream not found for boundary extraction")
      return null
    }

    const { message, stream, extractionContext, scratchpadConversations, validUpdateTargets } = fetchedData

    // Phase 2: Determine conversation (AI call only for channels/threads, 1-5+ seconds!)
    let decision: ConversationDecision

    if (stream.type === StreamTypes.SCRATCHPAD) {
      // Scratchpads: Simple logic, no AI call
      const activeConversation = scratchpadConversations?.find((c) => c.status === ConversationStatuses.ACTIVE)
      decision = activeConversation
        ? { conversationId: activeConversation.id, confidence: 1.0 }
        : {
            conversationId: null,
            newTopic: stream.displayName ?? "Scratchpad",
            confidence: 1.0,
          }
    } else {
      // Channels/threads: AI extraction (1-5+ seconds, no DB connection held!)
      if (!extractionContext) {
        logger.error({ messageId, streamId }, "Missing extraction context for channel/thread")
        return null
      }

      const result = await this.extractor.extract(extractionContext)
      decision = {
        conversationId: result.conversationId,
        newTopic: result.newConversationTopic ?? undefined,
        confidence: result.confidence,
        completenessUpdates: result.completenessUpdates,
        validUpdateTargets,
      }
    }

    // Phase 3: Save result in ONE transaction (fast, ~100ms)
    return withTransaction(this.pool, async (client) => {
      // For scratchpads: Re-check conversation exists (another process may have created it)
      // Lock the stream row to prevent race conditions (INV-20)
      if (stream.type === StreamTypes.SCRATCHPAD && !decision.conversationId) {
        await client.query(sql`SELECT id FROM streams WHERE id = ${stream.id} FOR UPDATE`)

        const existingConversations = await ConversationRepository.findByStream(client, stream.id)
        const activeConversation = existingConversations.find((c) => c.status === ConversationStatuses.ACTIVE)

        if (activeConversation) {
          // Another process created the conversation while we were processing
          decision.conversationId = activeConversation.id
        }
      }

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
