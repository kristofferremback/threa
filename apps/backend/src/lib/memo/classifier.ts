import type { AI } from "../ai/ai"
import { stripMarkdownFences } from "../ai/text-utils"
import type { ConfigResolver } from "../ai/config-resolver"
import { COMPONENT_PATHS } from "../ai/config-resolver"
import { MessageFormatter } from "../ai/message-formatter"
import type { Message } from "../../repositories/message-repository"
import type { Conversation } from "../../repositories/conversation-repository"
import type { Memo } from "../../repositories/memo-repository"
import type { KnowledgeType } from "@threa/types"
import { z } from "zod"
import {
  messageClassificationSchema,
  conversationClassificationSchema,
  CLASSIFIER_MESSAGE_SYSTEM_PROMPT,
  CLASSIFIER_CONVERSATION_SYSTEM_PROMPT,
  CLASSIFIER_MESSAGE_PROMPT,
  CLASSIFIER_CONVERSATION_PROMPT,
  CLASSIFIER_EXISTING_MEMO_TEMPLATE,
} from "./config"
import { logger } from "../logger"

/** Optional context for cost tracking */
export interface ClassifierContext {
  workspaceId: string
}

/**
 * Classification result for individual messages.
 * Determines if a message is a standalone "gem" worth memorizing.
 */
export interface MessageClassification {
  isGem: boolean
  knowledgeType: KnowledgeType | null
  confidence: number
  reasoning: string
}

/**
 * Classification result for conversations.
 * Determines if a conversation is knowledge-worthy and needs revision.
 */
export interface ConversationClassification {
  isKnowledgeWorthy: boolean
  knowledgeType: KnowledgeType | null
  shouldReviseExisting: boolean
  revisionReason: string | null
  confidence: number
}

export class MemoClassifier {
  constructor(
    private ai: AI,
    private configResolver: ConfigResolver,
    private messageFormatter: MessageFormatter
  ) {}

  async classifyMessage(message: Message, context: ClassifierContext): Promise<MessageClassification> {
    const config = await this.configResolver.resolve(COMPONENT_PATHS.MEMO_CLASSIFIER)

    const prompt = CLASSIFIER_MESSAGE_PROMPT.replace("{{AUTHOR_TYPE}}", message.authorType)
      .replace("{{AUTHOR_ID}}", message.authorId.slice(-8))
      .replace("{{CONTENT}}", message.contentMarkdown)

    const value = await this.generateWithRepair(messageClassificationSchema, {
      model: config.modelId,
      messages: [
        { role: "system", content: CLASSIFIER_MESSAGE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: config.temperature,
      telemetry: {
        functionId: "memo-classify-message",
        metadata: { messageId: message.id },
      },
      context: { workspaceId: context.workspaceId, origin: "system" },
    })

    return {
      isGem: value.isGem,
      knowledgeType: value.knowledgeType ?? null,
      confidence: value.confidence ?? 0.5,
      reasoning: value.reasoning ?? "",
    }
  }

  async classifyConversation(
    conversation: Conversation,
    formattedMessages: string,
    existingMemo: Memo | undefined,
    context: ClassifierContext
  ): Promise<ConversationClassification> {
    const config = await this.configResolver.resolve(COMPONENT_PATHS.MEMO_CLASSIFIER)

    const existingMemoSection = existingMemo
      ? CLASSIFIER_EXISTING_MEMO_TEMPLATE.replace("{{MEMO_TITLE}}", existingMemo.title)
          .replace("{{MEMO_ABSTRACT}}", existingMemo.abstract)
          .replace("{{MEMO_VERSION}}", String(existingMemo.version))
          .replace("{{MEMO_CREATED}}", existingMemo.createdAt.toISOString())
      : ""

    const messageCount = formattedMessages.split("<message").length - 1

    const prompt = CLASSIFIER_CONVERSATION_PROMPT.replace("{{TOPIC}}", conversation.topicSummary ?? "No topic set")
      .replace("{{PARTICIPANTS}}", conversation.participantIds.map((id) => id.slice(-8)).join(", "))
      .replace("{{MESSAGE_COUNT}}", String(messageCount))
      .replace("{{MESSAGES}}", formattedMessages)
      .replace("{{EXISTING_MEMO_SECTION}}", existingMemoSection)

    const value = await this.generateWithRepair(conversationClassificationSchema, {
      model: config.modelId,
      messages: [
        { role: "system", content: CLASSIFIER_CONVERSATION_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: config.temperature,
      telemetry: {
        functionId: "memo-classify-conversation",
        metadata: {
          conversationId: conversation.id,
          messageCount,
          hasExistingMemo: !!existingMemo,
        },
      },
      context: { workspaceId: context.workspaceId, origin: "system" },
    })

    return {
      isKnowledgeWorthy: value.isKnowledgeWorthy,
      knowledgeType: value.knowledgeType ?? null,
      shouldReviseExisting: existingMemo ? (value.shouldReviseExisting ?? false) : false,
      revisionReason: value.revisionReason ?? null,
      confidence: value.confidence ?? 0.5,
    }
  }

  private async generateWithRepair<T extends z.ZodType>(
    schema: T,
    options: {
      model: string
      messages: { role: "system" | "user" | "assistant"; content: string }[]
      temperature?: number
      telemetry: { functionId: string; metadata?: Record<string, unknown> }
      context: { workspaceId: string; origin: "system" }
    }
  ): Promise<z.infer<T>> {
    try {
      const { value } = await this.ai.generateObject({
        model: options.model,
        schema,
        messages: options.messages,
        temperature: options.temperature,
        telemetry: options.telemetry,
        context: options.context,
      })
      return value
    } catch (error) {
      const repaired = await this.tryRepair(schema, error)
      if (repaired) {
        logger.warn({ error, functionId: options.telemetry.functionId }, "Memo classifier output repaired")
        return repaired
      }
      throw error
    }
  }

  private async tryRepair<T extends z.ZodType>(schema: T, error: unknown): Promise<z.infer<T> | null> {
    const text = typeof (error as { text?: unknown })?.text === "string" ? (error as { text: string }).text : null
    if (!text) return null

    const repaired = await stripMarkdownFences({ text })
    try {
      const parsed = JSON.parse(repaired)
      const result = schema.safeParse(parsed)
      return result.success ? result.data : null
    } catch {
      return null
    }
  }
}
