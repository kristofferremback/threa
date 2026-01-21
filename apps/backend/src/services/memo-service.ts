import type { Pool, PoolClient } from "pg"
import { withTransaction, withClient } from "../db"
import {
  MemoRepository,
  PendingItemRepository,
  StreamStateRepository,
  ConversationRepository,
  MessageRepository,
  OutboxRepository,
  type Memo,
  type PendingMemoItem,
  type Message,
} from "../repositories"
import { MemoClassifier } from "../lib/memo/classifier"
import { Memorizer } from "../lib/memo/memorizer"
import { MessageFormatter } from "../lib/ai/message-formatter"
import type { EmbeddingServiceLike } from "./embedding-service"
import { memoId } from "../lib/id"
import { logger } from "../lib/logger"
import { MemoTypes, MemoStatuses } from "@threa/types"

const MEMORY_CONTEXT_LIMIT = 20
const MIN_CONVERSATION_MESSAGES = 2

export interface ProcessResult {
  processed: number
  memosCreated: number
  memosRevised: number
}

/** Data prepared for memo creation (before DB insert) */
interface MemoToCreate {
  id: string
  workspaceId: string
  memoType: import("@threa/types").MemoType
  sourceMessageId?: string
  sourceConversationId?: string
  title: string
  abstract: string
  keyPoints: string[]
  sourceMessageIds: string[]
  participantIds: string[]
  knowledgeType: import("@threa/types").KnowledgeType
  tags: string[]
  status: import("@threa/types").MemoStatus
  version?: number
  embedding: number[]
}

/** Outbox event to insert after memo creation */
interface OutboxEvent {
  eventType: "memo:created" | "memo:revised"
  payload: {
    workspaceId: string
    memoId: string
    previousMemoId?: string
    memo: import("@threa/types").Memo
    revisionReason?: string
  }
}

/** Memo supersession to perform */
interface MemoSupersession {
  memoId: string
  reason: string
}

/** Interface for memo service implementations */
export interface MemoServiceLike {
  processBatch(workspaceId: string, streamId: string): Promise<ProcessResult>
}

export interface MemoServiceConfig {
  pool: Pool
  classifier: MemoClassifier
  memorizer: Memorizer
  embeddingService: EmbeddingServiceLike
  messageFormatter: MessageFormatter
}

export class MemoService implements MemoServiceLike {
  private pool: Pool
  private classifier: MemoClassifier
  private memorizer: Memorizer
  private embeddingService: EmbeddingServiceLike
  private messageFormatter: MessageFormatter

  constructor(config: MemoServiceConfig) {
    this.pool = config.pool
    this.classifier = config.classifier
    this.memorizer = config.memorizer
    this.embeddingService = config.embeddingService
    this.messageFormatter = config.messageFormatter
  }

  /**
   * Process accumulated messages to extract knowledge-worthy memos.
   *
   * IMPORTANT: This method uses the three-phase pattern (INV-41) to avoid holding
   * database connections during AI calls (which can take 1-5+ seconds):
   *
   * Phase 1: Fetch messages with withClient (~100-200ms)
   * Phase 2: AI classification and memorization with no database connection held (1-5+ seconds)
   * Phase 3: Save memos with withTransaction (~100ms)
   */
  async processBatch(workspaceId: string, streamId: string): Promise<ProcessResult> {
    // Phase 1: Fetch all data with withClient (no transaction, fast reads)
    const fetchedData = await withClient(this.pool, async (client) => {
      const pending = await PendingItemRepository.findUnprocessed(client, workspaceId, streamId, {
        limit: 50,
      })

      if (pending.length === 0) {
        return null
      }

      const existingMemos = await MemoRepository.findByStream(client, streamId, {
        status: MemoStatuses.ACTIVE,
        limit: MEMORY_CONTEXT_LIMIT,
        orderBy: "createdAt",
      })

      const existingTags = await MemoRepository.getAllTags(client, workspaceId)

      // Fetch all messages for message items
      const messageItemIds = pending.filter((p) => p.itemType === "message").map((p) => p.itemId)
      const messages = messageItemIds.length > 0 ? await MessageRepository.findByIds(client, messageItemIds) : new Map()

      // Fetch all conversations and their messages for conversation items
      const conversationItemIds = pending.filter((p) => p.itemType === "conversation").map((p) => p.itemId)
      const conversations = new Map<string, NonNullable<Awaited<ReturnType<typeof ConversationRepository.findById>>>>()
      const conversationMessages = new Map<string, Map<string, Message | null>>()
      const existingConversationMemos = new Map<string, Memo | null>()

      for (const convId of conversationItemIds) {
        const conv = await ConversationRepository.findById(client, convId)
        if (conv) {
          conversations.set(convId, conv)
          const msgs = await MessageRepository.findByIds(client, conv.messageIds)
          conversationMessages.set(convId, msgs)
          const existingMemo = await MemoRepository.findActiveByConversation(client, convId)
          existingConversationMemos.set(convId, existingMemo)
        }
      }

      // Pre-format all messages while we have database access (INV-41)
      // Formatting requires resolving author names from the database
      const formattedConversations = new Map<string, string>()
      for (const [convId, msgs] of conversationMessages) {
        const messagesArray = Array.from(msgs.values()).filter((m): m is Message => m !== null)
        if (messagesArray.length > 0) {
          const formatted = await this.messageFormatter.formatMessages(client, messagesArray)
          formattedConversations.set(convId, formatted)
        }
      }

      return {
        pending,
        existingMemos,
        existingTags,
        messages,
        conversations,
        conversationMessages,
        existingConversationMemos,
        formattedConversations,
      }
    })

    if (!fetchedData) {
      return { processed: 0, memosCreated: 0, memosRevised: 0 }
    }

    // Phase 2: AI processing (no connection held, can take seconds/minutes)
    const memoryContext = fetchedData.existingMemos.map((m) => m.abstract)
    const memosToCreate: MemoToCreate[] = []
    const outboxEvents: OutboxEvent[] = []
    const supersessions: MemoSupersession[] = []
    let memosCreated = 0
    let memosRevised = 0
    let itemsFailed = 0

    // Process message items
    const messageItems = fetchedData.pending.filter((p) => p.itemType === "message")
    for (const item of messageItems) {
      try {
        const message = fetchedData.messages.get(item.itemId)
        if (!message) {
          logger.warn({ messageId: item.itemId }, "Message not found for memo processing")
          continue
        }

        if (message.authorType !== "user") {
          continue
        }

        // AI calls (no connection held)
        const classification = await this.classifier.classifyMessage(message, { workspaceId })
        if (!classification.isGem || !classification.knowledgeType) {
          continue
        }

        logger.debug(
          { messageId: message.id, knowledgeType: classification.knowledgeType, confidence: classification.confidence },
          "Message classified as gem"
        )

        const content = await this.memorizer.memorizeMessage({
          memoryContext,
          content: message,
          existingTags: fetchedData.existingTags,
          workspaceId,
        })

        const embedding = await this.embeddingService.embed(content.abstract, {
          workspaceId,
          functionId: "memo-embedding",
        })

        const memo: MemoToCreate = {
          id: memoId(),
          workspaceId,
          memoType: MemoTypes.MESSAGE,
          sourceMessageId: message.id,
          title: content.title,
          abstract: content.abstract,
          keyPoints: content.keyPoints,
          sourceMessageIds: content.sourceMessageIds,
          participantIds: [message.authorId],
          knowledgeType: classification.knowledgeType,
          tags: content.tags,
          status: MemoStatuses.ACTIVE,
          embedding,
        }

        memosToCreate.push(memo)
        outboxEvents.push({
          eventType: "memo:created",
          payload: {
            workspaceId,
            memoId: memo.id,
            memo: this.toWireMemoFromData(memo),
          },
        })
        memosCreated++
      } catch (error) {
        itemsFailed++
        logger.error({ error, messageId: item.itemId, workspaceId, streamId }, "Failed to process message for memo")
      }
    }

    // Process conversation items
    const convItems = fetchedData.pending.filter((p) => p.itemType === "conversation")
    for (const item of convItems) {
      try {
        const conversation = fetchedData.conversations.get(item.itemId)
        if (!conversation) {
          logger.warn({ conversationId: item.itemId }, "Conversation not found for memo processing")
          continue
        }

        if (conversation.messageIds.length < MIN_CONVERSATION_MESSAGES) {
          continue
        }

        const messages = fetchedData.conversationMessages.get(item.itemId)
        if (!messages) {
          logger.warn({ conversationId: conversation.id }, "No messages found for conversation")
          continue
        }

        const messagesArray = Array.from(messages.values()).filter((m): m is Message => m !== null)
        if (messagesArray.length === 0) {
          logger.warn({ conversationId: conversation.id }, "No messages found for conversation")
          continue
        }

        // Get pre-formatted messages from Phase 1 (formatted with database access)
        const formattedMessages = fetchedData.formattedConversations.get(item.itemId)
        if (!formattedMessages) {
          logger.warn({ conversationId: conversation.id }, "No formatted messages found")
          continue
        }

        const existingMemo = fetchedData.existingConversationMemos.get(item.itemId)

        // AI call (no connection held)
        const classification = await this.classifier.classifyConversation(
          conversation,
          formattedMessages,
          existingMemo ?? undefined,
          { workspaceId }
        )

        if (!classification.isKnowledgeWorthy || !classification.knowledgeType) {
          continue
        }

        if (existingMemo && classification.shouldReviseExisting) {
          // Prepare revision
          const content = await this.memorizer.reviseMemo(formattedMessages, {
            memoryContext,
            content: messagesArray,
            existingMemo,
            existingTags: fetchedData.existingTags,
            workspaceId,
          })

          const embedding = await this.embeddingService.embed(content.abstract, {
            workspaceId,
            functionId: "memo-embedding",
          })

          const newMemo: MemoToCreate = {
            id: memoId(),
            workspaceId,
            memoType: MemoTypes.CONVERSATION,
            sourceConversationId: conversation.id,
            title: content.title,
            abstract: content.abstract,
            keyPoints: content.keyPoints,
            sourceMessageIds: content.sourceMessageIds,
            participantIds: conversation.participantIds,
            knowledgeType: existingMemo.knowledgeType,
            tags: content.tags,
            status: MemoStatuses.ACTIVE,
            version: existingMemo.version + 1,
            embedding,
          }

          supersessions.push({
            memoId: existingMemo.id,
            reason: classification.revisionReason ?? "Content updated",
          })
          memosToCreate.push(newMemo)
          outboxEvents.push({
            eventType: "memo:revised",
            payload: {
              workspaceId,
              memoId: newMemo.id,
              previousMemoId: existingMemo.id,
              memo: this.toWireMemoFromData(newMemo),
              revisionReason: classification.revisionReason ?? "Content updated",
            },
          })
          memosRevised++

          logger.info(
            {
              conversationId: conversation.id,
              previousMemoId: existingMemo.id,
              newMemoId: newMemo.id,
              version: existingMemo.version + 1,
            },
            "Memo revised"
          )
        } else if (!existingMemo) {
          // Create new memo
          const content = await this.memorizer.memorizeConversation(formattedMessages, {
            memoryContext,
            content: messagesArray,
            existingTags: fetchedData.existingTags,
            workspaceId,
          })

          const embedding = await this.embeddingService.embed(content.abstract, {
            workspaceId,
            functionId: "memo-embedding",
          })

          const memo: MemoToCreate = {
            id: memoId(),
            workspaceId,
            memoType: MemoTypes.CONVERSATION,
            sourceConversationId: conversation.id,
            title: content.title,
            abstract: content.abstract,
            keyPoints: content.keyPoints,
            sourceMessageIds: content.sourceMessageIds,
            participantIds: conversation.participantIds,
            knowledgeType: classification.knowledgeType,
            tags: content.tags,
            status: MemoStatuses.ACTIVE,
            embedding,
          }

          memosToCreate.push(memo)
          outboxEvents.push({
            eventType: "memo:created",
            payload: {
              workspaceId,
              memoId: memo.id,
              memo: this.toWireMemoFromData(memo),
            },
          })
          memosCreated++

          logger.info({ conversationId: conversation.id, memoId: memo.id }, "Conversation memo created")
        }
      } catch (error) {
        itemsFailed++
        logger.error(
          { error, conversationId: item.itemId, workspaceId, streamId },
          "Failed to process conversation for memo"
        )
      }
    }

    if (itemsFailed > 0) {
      logger.warn(
        { workspaceId, streamId, itemsFailed, totalItems: fetchedData.pending.length },
        "Some items failed during memo batch processing"
      )
    }

    // Phase 3: Save all results in ONE transaction (fast, ~200ms instead of 10-50 seconds)
    await withTransaction(this.pool, async (client) => {
      // Perform supersessions
      for (const supersession of supersessions) {
        await MemoRepository.supersede(client, supersession.memoId, supersession.reason)
      }

      // Insert all memos
      for (const memoData of memosToCreate) {
        const { embedding, ...memoFields } = memoData
        await MemoRepository.insert(client, memoFields)
        await MemoRepository.updateEmbedding(client, memoData.id, embedding)
      }

      // Insert all outbox events
      for (const event of outboxEvents) {
        await OutboxRepository.insert(client, event.eventType, event.payload)
      }

      // Mark all items processed
      await PendingItemRepository.markProcessed(
        client,
        fetchedData.pending.map((p) => p.id)
      )

      await StreamStateRepository.markProcessed(client, workspaceId, streamId)
    })

    logger.info(
      { workspaceId, streamId, processed: fetchedData.pending.length, memosCreated, memosRevised },
      "Memo batch processed"
    )

    return { processed: fetchedData.pending.length, memosCreated, memosRevised }
  }

  private toWireMemo(memo: Memo): import("@threa/types").Memo {
    return {
      id: memo.id,
      workspaceId: memo.workspaceId,
      memoType: memo.memoType,
      sourceMessageId: memo.sourceMessageId,
      sourceConversationId: memo.sourceConversationId,
      title: memo.title,
      abstract: memo.abstract,
      keyPoints: memo.keyPoints,
      sourceMessageIds: memo.sourceMessageIds,
      participantIds: memo.participantIds,
      knowledgeType: memo.knowledgeType,
      tags: memo.tags,
      parentMemoId: memo.parentMemoId,
      status: memo.status,
      version: memo.version,
      revisionReason: memo.revisionReason,
      createdAt: memo.createdAt.toISOString(),
      updatedAt: memo.updatedAt.toISOString(),
      archivedAt: memo.archivedAt?.toISOString() ?? null,
    }
  }

  /** Convert MemoToCreate data to wire format (before DB insert, so use current timestamp) */
  private toWireMemoFromData(memoData: MemoToCreate): import("@threa/types").Memo {
    const now = new Date().toISOString()
    return {
      id: memoData.id,
      workspaceId: memoData.workspaceId,
      memoType: memoData.memoType,
      sourceMessageId: memoData.sourceMessageId ?? null,
      sourceConversationId: memoData.sourceConversationId ?? null,
      title: memoData.title,
      abstract: memoData.abstract,
      keyPoints: memoData.keyPoints,
      sourceMessageIds: memoData.sourceMessageIds,
      participantIds: memoData.participantIds,
      knowledgeType: memoData.knowledgeType,
      tags: memoData.tags,
      parentMemoId: null,
      status: memoData.status,
      version: memoData.version ?? 1,
      revisionReason: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }
  }
}
