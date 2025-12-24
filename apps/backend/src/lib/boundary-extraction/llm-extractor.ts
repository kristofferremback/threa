import { generateObject } from "ai"
import { z } from "zod"
import type { ProviderRegistry } from "../ai/provider-registry"
import type { BoundaryExtractor, ExtractionContext, ExtractionResult } from "./types"
import type { Message } from "../../repositories/message-repository"
import { logger } from "../logger"
import { CONVERSATION_STATUSES } from "@threa/types"

/**
 * Schema for LLM extraction response using structured outputs.
 * The model outputs directly conform to this schema, eliminating JSON parsing errors.
 */
const extractionResponseSchema = z.object({
  conversationId: z.string().nullable().describe("ID of existing conversation to join, or null for new conversation"),
  newConversationTopic: z.string().optional().describe("Topic summary if starting a new conversation"),
  completenessUpdates: z
    .array(
      z.object({
        conversationId: z.string(),
        score: z.number().min(1).max(7).describe("Completeness score: 1 = just started, 7 = fully resolved"),
        status: z.enum(CONVERSATION_STATUSES),
      })
    )
    .optional()
    .describe("Updates to completeness scores for affected conversations"),
  confidence: z.number().min(0).max(1).describe("Confidence in this classification (0.0 to 1.0)"),
  reasoning: z.string().optional().describe("Brief explanation of the classification decision"),
})

const EXTRACTION_PROMPT = `You are analyzing a message stream to identify conversation boundaries. Your task is to determine which conversation a new message belongs to.

## Active Conversations
{{CONVERSATIONS}}

## Recent Messages (last 5)
{{RECENT_MESSAGES}}

## New Message
From: {{AUTHOR}}
Content: {{CONTENT}}

## Task
Determine which conversation this message belongs to. Consider:
1. Topic continuity - does it continue an existing topic?
2. Participant overlap - is the author part of an existing conversation?
3. Explicit references - does the message reference something from a conversation?
4. Context - does this feel like a continuation or a new topic?

Notes:
- Set conversationId to null if this starts a new conversation
- newConversationTopic is only needed if conversationId is null
- completenessUpdates is optional, include only if a conversation's status changed
- Score 1 = just started, 7 = fully resolved
- Status should be "resolved" if a question was answered or decision was made`

export class LLMBoundaryExtractor implements BoundaryExtractor {
  constructor(
    private providerRegistry: ProviderRegistry,
    private modelId: string
  ) {}

  async extract(context: ExtractionContext): Promise<ExtractionResult> {
    if (context.isThread) {
      return this.handleThreadMessage(context)
    }

    const prompt = this.buildPrompt(context)

    try {
      const model = this.providerRegistry.getModel(this.modelId)
      const result = await generateObject({
        model,
        prompt,
        schema: extractionResponseSchema,
        maxOutputTokens: 500,
        temperature: 0.2,
      })

      return this.validateResult(result.object, context)
    } catch (err) {
      logger.error({ err }, "Boundary extraction LLM call failed")
      return {
        conversationId: null,
        newConversationTopic: this.extractTopicFromMessage(context.newMessage),
        confidence: 0.3,
      }
    }
  }

  private handleThreadMessage(context: ExtractionContext): ExtractionResult {
    const existingConv = context.activeConversations[0]
    return {
      conversationId: existingConv?.id ?? null,
      newConversationTopic: existingConv ? undefined : this.extractTopicFromMessage(context.newMessage),
      confidence: 1.0,
    }
  }

  private buildPrompt(context: ExtractionContext): string {
    const convSection =
      context.activeConversations.length > 0
        ? context.activeConversations
            .map(
              (c) =>
                `- ${c.id}: "${c.topicSummary ?? "No topic yet"}" (${c.messageCount} messages, completeness: ${c.completenessScore}/7, participants: ${c.participantIds.length})`
            )
            .join("\n")
        : "No active conversations in this stream yet."

    const recentSection = context.recentMessages
      .map(
        (m) =>
          `[${m.authorType}:${m.authorId.slice(-8)}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? "..." : ""}`
      )
      .join("\n")

    return EXTRACTION_PROMPT.replace("{{CONVERSATIONS}}", convSection)
      .replace("{{RECENT_MESSAGES}}", recentSection || "No recent messages.")
      .replace("{{AUTHOR}}", `${context.newMessage.authorType}:${context.newMessage.authorId.slice(-8)}`)
      .replace("{{CONTENT}}", context.newMessage.content)
  }

  private validateResult(
    parsed: z.infer<typeof extractionResponseSchema>,
    context: ExtractionContext
  ): ExtractionResult {
    // Validate that the returned conversation ID actually exists
    if (parsed.conversationId && !this.isValidConversationId(parsed.conversationId, context)) {
      logger.warn({ parsedId: parsed.conversationId }, "LLM returned invalid conversation ID, treating as new")
      return {
        conversationId: null,
        newConversationTopic: parsed.newConversationTopic || this.extractTopicFromMessage(context.newMessage),
        confidence: parsed.confidence,
      }
    }

    return {
      conversationId: parsed.conversationId,
      newConversationTopic: parsed.newConversationTopic,
      completenessUpdates: parsed.completenessUpdates,
      confidence: parsed.confidence,
    }
  }

  private isValidConversationId(id: string, context: ExtractionContext): boolean {
    return context.activeConversations.some((c) => c.id === id)
  }

  private extractTopicFromMessage(message: Message): string {
    const firstSentence = message.content.split(/[.!?\n]/)[0]?.trim()
    if (firstSentence && firstSentence.length > 0) {
      return firstSentence.slice(0, 100)
    }
    return message.content.slice(0, 100)
  }
}
