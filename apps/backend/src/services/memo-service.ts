import type { Pool, PoolClient } from "pg"
import { withTransaction } from "../db"
import {
  MemoRepository,
  PendingItemRepository,
  StreamStateRepository,
  ConversationRepository,
  MessageRepository,
  OutboxRepository,
  type Memo,
  type PendingMemoItem,
} from "../repositories"
import { MemoClassifier } from "../lib/memo/classifier"
import { Memorizer } from "../lib/memo/memorizer"
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

/** Interface for memo service implementations */
export interface MemoServiceLike {
  processBatch(workspaceId: string, streamId: string): Promise<ProcessResult>
}

export interface MemoServiceConfig {
  pool: Pool
  classifier: MemoClassifier
  memorizer: Memorizer
  embeddingService: EmbeddingServiceLike
}

export class MemoService implements MemoServiceLike {
  private pool: Pool
  private classifier: MemoClassifier
  private memorizer: Memorizer
  private embeddingService: EmbeddingServiceLike

  constructor(config: MemoServiceConfig) {
    this.pool = config.pool
    this.classifier = config.classifier
    this.memorizer = config.memorizer
    this.embeddingService = config.embeddingService
  }

  async processBatch(workspaceId: string, streamId: string): Promise<ProcessResult> {
    return withTransaction(this.pool, async (client) => {
      const pending = await PendingItemRepository.findUnprocessed(client, workspaceId, streamId, {
        limit: 50,
      })

      if (pending.length === 0) {
        return { processed: 0, memosCreated: 0, memosRevised: 0 }
      }

      const existingMemos = await MemoRepository.findByStream(client, streamId, {
        status: MemoStatuses.ACTIVE,
        limit: MEMORY_CONTEXT_LIMIT,
        orderBy: "createdAt",
      })
      const memoryContext = existingMemos.map((m) => m.abstract)

      const existingTags = await MemoRepository.getAllTags(client, workspaceId)

      let memosCreated = 0
      let memosRevised = 0
      let itemsFailed = 0

      const messageItems = pending.filter((p) => p.itemType === "message")
      for (const item of messageItems) {
        try {
          const result = await this.processMessage(client, item, memoryContext, existingTags, workspaceId)
          if (result) memosCreated++
        } catch (error) {
          itemsFailed++
          logger.error({ error, messageId: item.itemId, workspaceId, streamId }, "Failed to process message for memo")
        }
      }

      const convItems = pending.filter((p) => p.itemType === "conversation")
      for (const item of convItems) {
        try {
          const result = await this.processConversation(client, item, memoryContext, existingTags, workspaceId)
          if (result === "created") memosCreated++
          if (result === "revised") memosRevised++
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
          { workspaceId, streamId, itemsFailed, totalItems: pending.length },
          "Some items failed during memo batch processing"
        )
      }

      await PendingItemRepository.markProcessed(
        client,
        pending.map((p) => p.id)
      )

      await StreamStateRepository.markProcessed(client, workspaceId, streamId)

      logger.info(
        { workspaceId, streamId, processed: pending.length, memosCreated, memosRevised },
        "Memo batch processed"
      )

      return { processed: pending.length, memosCreated, memosRevised }
    })
  }

  private async processMessage(
    client: PoolClient,
    item: PendingMemoItem,
    memoryContext: string[],
    existingTags: string[],
    workspaceId: string
  ): Promise<Memo | null> {
    const message = await MessageRepository.findById(client, item.itemId)
    if (!message) {
      logger.warn({ messageId: item.itemId }, "Message not found for memo processing")
      return null
    }

    if (message.authorType !== "user") {
      return null
    }

    const classification = await this.classifier.classifyMessage(message)
    if (!classification.isGem || !classification.knowledgeType) {
      return null
    }

    logger.debug(
      { messageId: message.id, knowledgeType: classification.knowledgeType, confidence: classification.confidence },
      "Message classified as gem"
    )

    const content = await this.memorizer.memorizeMessage({
      memoryContext,
      content: message,
      existingTags,
    })

    const memo = await MemoRepository.insert(client, {
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
    })

    const embedding = await this.embeddingService.embed(memo.abstract)
    await MemoRepository.updateEmbedding(client, memo.id, embedding)

    await OutboxRepository.insert(client, "memo:created", {
      workspaceId,
      memoId: memo.id,
      memo: this.toWireMemo(memo),
    })

    return memo
  }

  private async processConversation(
    client: PoolClient,
    item: PendingMemoItem,
    memoryContext: string[],
    existingTags: string[],
    workspaceId: string
  ): Promise<"created" | "revised" | null> {
    const conversation = await ConversationRepository.findById(client, item.itemId)
    if (!conversation) {
      logger.warn({ conversationId: item.itemId }, "Conversation not found for memo processing")
      return null
    }

    if (conversation.messageIds.length < MIN_CONVERSATION_MESSAGES) {
      return null
    }

    const messages = await MessageRepository.findByIds(client, conversation.messageIds)
    const messagesArray = Array.from(messages.values())

    if (messagesArray.length === 0) {
      logger.warn({ conversationId: conversation.id }, "No messages found for conversation")
      return null
    }

    const existingMemo = await MemoRepository.findActiveByConversation(client, conversation.id)

    const classification = await this.classifier.classifyConversation(
      client,
      conversation,
      messagesArray,
      existingMemo ?? undefined
    )

    if (!classification.isKnowledgeWorthy || !classification.knowledgeType) {
      return null
    }

    if (existingMemo && classification.shouldReviseExisting) {
      return this.reviseMemo(
        client,
        existingMemo,
        conversation,
        messagesArray,
        memoryContext,
        existingTags,
        workspaceId,
        classification.revisionReason ?? "Content updated"
      )
    }

    if (!existingMemo) {
      return this.createConversationMemo(
        client,
        conversation,
        messagesArray,
        memoryContext,
        existingTags,
        workspaceId,
        classification.knowledgeType
      )
    }

    return null
  }

  private async createConversationMemo(
    client: PoolClient,
    conversation: ReturnType<typeof ConversationRepository.findById> extends Promise<infer T> ? NonNullable<T> : never,
    messages: Awaited<ReturnType<typeof MessageRepository.findById>>[],
    memoryContext: string[],
    existingTags: string[],
    workspaceId: string,
    knowledgeType: import("@threa/types").KnowledgeType
  ): Promise<"created"> {
    const content = await this.memorizer.memorizeConversation(client, {
      memoryContext,
      content: messages.filter((m): m is NonNullable<typeof m> => m !== null),
      existingTags,
    })

    const memo = await MemoRepository.insert(client, {
      id: memoId(),
      workspaceId,
      memoType: MemoTypes.CONVERSATION,
      sourceConversationId: conversation.id,
      title: content.title,
      abstract: content.abstract,
      keyPoints: content.keyPoints,
      sourceMessageIds: content.sourceMessageIds,
      participantIds: conversation.participantIds,
      knowledgeType,
      tags: content.tags,
      status: MemoStatuses.ACTIVE,
    })

    const embedding = await this.embeddingService.embed(memo.abstract)
    await MemoRepository.updateEmbedding(client, memo.id, embedding)

    await OutboxRepository.insert(client, "memo:created", {
      workspaceId,
      memoId: memo.id,
      memo: this.toWireMemo(memo),
    })

    logger.info({ conversationId: conversation.id, memoId: memo.id }, "Conversation memo created")

    return "created"
  }

  private async reviseMemo(
    client: PoolClient,
    existingMemo: Memo,
    conversation: ReturnType<typeof ConversationRepository.findById> extends Promise<infer T> ? NonNullable<T> : never,
    messages: Awaited<ReturnType<typeof MessageRepository.findById>>[],
    memoryContext: string[],
    existingTags: string[],
    workspaceId: string,
    revisionReason: string
  ): Promise<"revised"> {
    await MemoRepository.supersede(client, existingMemo.id, revisionReason)

    const content = await this.memorizer.reviseMemo(client, {
      memoryContext,
      content: messages.filter((m): m is NonNullable<typeof m> => m !== null),
      existingMemo,
      existingTags,
    })

    const newMemo = await MemoRepository.insert(client, {
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
    })

    const embedding = await this.embeddingService.embed(newMemo.abstract)
    await MemoRepository.updateEmbedding(client, newMemo.id, embedding)

    await OutboxRepository.insert(client, "memo:revised", {
      workspaceId,
      memoId: newMemo.id,
      previousMemoId: existingMemo.id,
      memo: this.toWireMemo(newMemo),
      revisionReason,
    })

    logger.info(
      {
        conversationId: conversation.id,
        previousMemoId: existingMemo.id,
        newMemoId: newMemo.id,
        version: existingMemo.version + 1,
      },
      "Memo revised"
    )

    return "revised"
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
}
