import type { AI } from "../../lib/ai/ai"
import type { ConfigResolver } from "../../lib/ai/config-resolver"
import { COMPONENT_PATHS } from "../../lib/ai/config-resolver"
import { MessageFormatter } from "../../lib/ai/message-formatter"
import type { Message } from "../messaging"
import type { Conversation } from "../conversations"
import type { Memo } from "./repository"
import type { KnowledgeType } from "@threa/types"
import {
  messageClassificationSchema,
  conversationClassificationSchema,
  CLASSIFIER_MESSAGE_SYSTEM_PROMPT,
  CLASSIFIER_CONVERSATION_SYSTEM_PROMPT,
  CLASSIFIER_MESSAGE_PROMPT,
  CLASSIFIER_CONVERSATION_PROMPT,
  CLASSIFIER_EXISTING_MEMO_TEMPLATE,
} from "./config"
import { memoRepair } from "./repair"

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

    const { value } = await this.ai.generateObject({
      model: config.modelId,
      schema: messageClassificationSchema,
      messages: [
        { role: "system", content: CLASSIFIER_MESSAGE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: config.temperature,
      repair: memoRepair,
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

    const { value } = await this.ai.generateObject({
      model: config.modelId,
      schema: conversationClassificationSchema,
      messages: [
        { role: "system", content: CLASSIFIER_CONVERSATION_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: config.temperature,
      repair: memoRepair,
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
}
