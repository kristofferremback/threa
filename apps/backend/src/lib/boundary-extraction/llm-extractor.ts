import { generateObject, NoObjectGeneratedError } from "ai"
import { z } from "zod"
import type { ProviderRegistry } from "../ai/provider-registry"
import { stripMarkdownFences } from "../ai/text-utils"
import type { BoundaryExtractor, ExtractionContext, ExtractionResult } from "./types"
import type { Message } from "../../repositories/message-repository"
import { logger } from "../logger"
import { CONVERSATION_STATUSES, StreamTypes } from "@threa/types"

/**
 * Schema for LLM extraction response using structured outputs.
 * OpenAI's strict mode requires ALL properties in the `required` array,
 * so we use `.nullable()` instead of `.optional()` for optional semantics.
 */
const extractionResponseSchema = z.object({
  conversationId: z.string().nullable().describe("ID of existing conversation to join, or null for new conversation"),
  newConversationTopic: z
    .string()
    .nullable()
    .describe("Topic summary if starting a new conversation (required when conversationId is null)"),
  completenessUpdates: z
    .array(
      z
        .object({
          conversationId: z.string(),
          score: z.number().min(1).max(7).describe("Completeness score: 1 = just started, 7 = fully resolved"),
          status: z
            .enum(CONVERSATION_STATUSES)
            .describe(`Conversation status: ${CONVERSATION_STATUSES.map((s) => `"${s}"`).join(" | ")}`),
        })
        .strict()
    )
    .nullable()
    .describe("Updates to completeness scores for affected conversations, or null if none"),
  confidence: z.number().min(0).max(1).describe("Confidence in this classification (0.0 to 1.0)"),
  reasoning: z.string().nullable().describe("Brief explanation of the classification decision"),
})

const SYSTEM_PROMPT = `You are a conversation boundary classifier. You analyze messages and output ONLY valid JSON matching the required schema. No explanations, no markdown, no prose - just the JSON object.`

const EXTRACTION_PROMPT = `Analyze this message and determine which conversation it belongs to.

## Active Conversations
{{CONVERSATIONS}}

## Recent Messages (last 5)
{{RECENT_MESSAGES}}

## New Message
From: {{AUTHOR}}
Content: {{CONTENT}}

## Classification Rules
1. Topic continuity - does it continue an existing topic?
2. Participant overlap - is the author part of an existing conversation?
3. Explicit references - does the message reference something from a conversation?
4. Context - does this feel like a continuation or a new topic?

## Output Requirements
- conversationId: ID of existing conversation to join, or null for new conversation
- newConversationTopic: Topic summary if starting new conversation (required when conversationId is null)
- completenessUpdates: Array of {conversationId, score (1-7), status} for conversations whose completeness changed
  - status must be one of: "active", "stalled", "resolved"
- confidence: 0.0 to 1.0 confidence in this classification

Respond with ONLY the JSON object. No explanation, no markdown code blocks.`

export class LLMBoundaryExtractor implements BoundaryExtractor {
  constructor(
    private providerRegistry: ProviderRegistry,
    private modelId: string
  ) {}

  async extract(context: ExtractionContext): Promise<ExtractionResult> {
    if (context.streamType === StreamTypes.THREAD) {
      return this.handleThreadMessage(context)
    }

    const prompt = this.buildPrompt(context)

    const model = this.providerRegistry.getModel(this.modelId)

    try {
      const result = await generateObject({
        model,
        system: SYSTEM_PROMPT,
        prompt,
        schema: extractionResponseSchema,
        maxOutputTokens: 500,
        temperature: 0.2,
        experimental_repairText: stripMarkdownFences,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "boundary-extraction",
          metadata: {
            streamType: context.streamType,
            activeConversationCount: context.activeConversations.length,
          },
        },
      })

      return this.validateResult(result.object, context)
    } catch (error) {
      // Handle parsing errors gracefully - LLMs sometimes return JSON wrapped in markdown
      // This is NOT a silent fallback per INV-11: we log the error and only handle this
      // specific error type. API errors, rate limits, etc. still propagate for retry.
      if (error instanceof NoObjectGeneratedError) {
        logger.warn(
          { error: error.message, text: error.text?.slice(0, 200) },
          "LLM returned unparseable response, treating as new conversation"
        )
        return {
          conversationId: null,
          newConversationTopic: this.truncateAsTopic(context.newMessage),
          confidence: 0.5,
        }
      }
      throw error
    }
  }

  private handleThreadMessage(context: ExtractionContext): ExtractionResult {
    // First priority: join existing thread conversation (if there are already messages in this thread)
    const existingThreadConv = context.activeConversations[0]
    if (existingThreadConv) {
      return {
        conversationId: existingThreadConv.id,
        confidence: 1.0,
      }
    }

    // Second priority: join the parent message's conversation (thread continues parent's conversation)
    const parentConv = context.parentMessageConversations?.[0]
    if (parentConv) {
      return {
        conversationId: parentConv.id,
        confidence: 1.0,
      }
    }

    // Fallback: create new conversation (parent message wasn't in a conversation yet)
    return {
      conversationId: null,
      newConversationTopic: this.truncateAsTopic(context.newMessage),
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
        newConversationTopic: parsed.newConversationTopic || this.truncateAsTopic(context.newMessage),
        confidence: parsed.confidence,
      }
    }

    return {
      conversationId: parsed.conversationId,
      newConversationTopic: parsed.newConversationTopic ?? undefined,
      completenessUpdates: parsed.completenessUpdates ?? undefined,
      confidence: parsed.confidence,
    }
  }

  private isValidConversationId(id: string, context: ExtractionContext): boolean {
    return context.activeConversations.some((c) => c.id === id)
  }

  private truncateAsTopic(message: Message): string {
    const firstSentence = message.content.split(/[.!?\n]/)[0]?.trim()
    const text = firstSentence && firstSentence.length > 0 ? firstSentence : message.content.trim()

    if (text.length <= 100) {
      return text
    }

    // Find last space before the limit to avoid cutting mid-word
    // Reserve 1 char for ellipsis, so look for space before position 99
    const lastSpace = text.lastIndexOf(" ", 99)
    if (lastSpace > 20) {
      return text.slice(0, lastSpace) + "…"
    }

    // No good word boundary found, just truncate at 99 + ellipsis = 100 total
    return text.slice(0, 99) + "…"
  }
}
