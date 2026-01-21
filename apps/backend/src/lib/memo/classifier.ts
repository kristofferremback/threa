import { z } from "zod"
import type { AI } from "../ai/ai"
import { MessageFormatter } from "../ai/message-formatter"
import type { Message } from "../../repositories/message-repository"
import type { Conversation } from "../../repositories/conversation-repository"
import type { Memo } from "../../repositories/memo-repository"
import { KNOWLEDGE_TYPES, type KnowledgeType } from "@threa/types"

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

/**
 * OpenAI's strict mode requires ALL properties in the `required` array,
 * so we use `.nullable()` instead of `.optional()` for optional semantics.
 */
const messageClassificationSchema = z.object({
  isGem: z.boolean().describe("Whether this message is a standalone gem worth memorizing"),
  knowledgeType: z
    .enum(KNOWLEDGE_TYPES)
    .nullable()
    .describe(`Type of knowledge if isGem is true: ${KNOWLEDGE_TYPES.map((t) => `"${t}"`).join(" | ")}`),
  confidence: z.number().min(0).max(1).nullable().describe("Confidence in this classification (0.0 to 1.0)"),
  reasoning: z.string().nullable().describe("Brief explanation of the classification decision"),
})

const conversationClassificationSchema = z.object({
  isKnowledgeWorthy: z.boolean().describe("Whether this conversation contains knowledge worth preserving"),
  knowledgeType: z
    .enum(KNOWLEDGE_TYPES)
    .nullable()
    .describe(`Primary type of knowledge if worthy: ${KNOWLEDGE_TYPES.map((t) => `"${t}"`).join(" | ")}`),
  shouldReviseExisting: z.boolean().nullable().describe("If a memo exists, whether it should be revised"),
  revisionReason: z
    .string()
    .nullable()
    .describe("Why the existing memo should be revised (if shouldReviseExisting is true)"),
  confidence: z.number().min(0).max(1).nullable().describe("Confidence in this classification (0.0 to 1.0)"),
})

const MESSAGE_SYSTEM_PROMPT = `You are a knowledge classifier for a team chat application. You identify standalone messages that contain valuable knowledge worth preserving ("gems").

Gems are messages that:
- Contain decisions with rationale
- Document procedures or how-to instructions
- Share learnings or insights from experience
- Provide context that helps understand the team/project
- Include reference information (links, resources, definitions)

NOT gems:
- Simple acknowledgments (ok, thanks, got it)
- Social chatter without information value
- Questions without answers
- Status updates without context ("done", "working on it")
- Incomplete thoughts that need conversation context

Output ONLY valid JSON matching the schema. Keep reasoning to ONE brief sentence.`

const CONVERSATION_SYSTEM_PROMPT = `You are a knowledge classifier for a team chat application. You identify conversations that contain valuable knowledge worth preserving in organizational memory.

Knowledge-worthy conversations:
- Document decisions with context and rationale
- Capture procedures or processes that were worked out
- Record learnings from debugging, incidents, or experiments
- Establish context about why things are the way they are
- Contain reference information that will be useful later

NOT knowledge-worthy:
- Pure social chat or banter
- Brief status exchanges
- Conversations where important information is in external links only
- Incomplete discussions that trail off without resolution

When comparing to an existing memo, recommend revision if:
- Significant new information was added
- The conclusion or decision changed
- New participants brought important perspectives
- The topic evolved substantially

Output ONLY valid JSON matching the schema. Keep reasoning to ONE brief sentence.`

const MESSAGE_PROMPT = `Classify this message. Is it a standalone gem worth preserving?

## Message
From: {{AUTHOR_TYPE}} ({{AUTHOR_ID}})
Content:
{{CONTENT}}`

const CONVERSATION_PROMPT = `Classify this conversation. Is it worth preserving in organizational memory?

## Conversation
Topic: {{TOPIC}}
Participants: {{PARTICIPANTS}}
Message count: {{MESSAGE_COUNT}}

## Messages
{{MESSAGES}}

{{EXISTING_MEMO_SECTION}}`

const EXISTING_MEMO_TEMPLATE = `## Existing Memo
Title: {{MEMO_TITLE}}
Abstract: {{MEMO_ABSTRACT}}
Version: {{MEMO_VERSION}}
Created: {{MEMO_CREATED}}

Should this memo be revised based on the conversation above?`

export class MemoClassifier {
  constructor(
    private ai: AI,
    private modelId: string,
    private messageFormatter: MessageFormatter
  ) {}

  async classifyMessage(message: Message, context: ClassifierContext): Promise<MessageClassification> {
    const prompt = MESSAGE_PROMPT.replace("{{AUTHOR_TYPE}}", message.authorType)
      .replace("{{AUTHOR_ID}}", message.authorId.slice(-8))
      .replace("{{CONTENT}}", message.contentMarkdown)

    const { value } = await this.ai.generateObject({
      model: this.modelId,
      schema: messageClassificationSchema,
      messages: [
        { role: "system", content: MESSAGE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
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
    const existingMemoSection = existingMemo
      ? EXISTING_MEMO_TEMPLATE.replace("{{MEMO_TITLE}}", existingMemo.title)
          .replace("{{MEMO_ABSTRACT}}", existingMemo.abstract)
          .replace("{{MEMO_VERSION}}", String(existingMemo.version))
          .replace("{{MEMO_CREATED}}", existingMemo.createdAt.toISOString())
      : ""

    const messageCount = formattedMessages.split("<message").length - 1

    const prompt = CONVERSATION_PROMPT.replace("{{TOPIC}}", conversation.topicSummary ?? "No topic set")
      .replace("{{PARTICIPANTS}}", conversation.participantIds.map((id) => id.slice(-8)).join(", "))
      .replace("{{MESSAGE_COUNT}}", String(messageCount))
      .replace("{{MESSAGES}}", formattedMessages)
      .replace("{{EXISTING_MEMO_SECTION}}", existingMemoSection)

    const { value } = await this.ai.generateObject({
      model: this.modelId,
      schema: conversationClassificationSchema,
      messages: [
        { role: "system", content: CONVERSATION_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
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
