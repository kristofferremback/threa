import { NoObjectGeneratedError } from "ai"
import type { AI } from "../ai/ai"
import type { ConfigResolver } from "../ai/config-resolver"
import { COMPONENT_PATHS } from "../ai/config-resolver"
import type { BoundaryExtractor, ExtractionContext, ExtractionResult } from "./types"
import type { Message } from "../../repositories/message-repository"
import { logger } from "../logger"
import { StreamTypes } from "@threa/types"
import {
  extractionResponseSchema,
  BOUNDARY_EXTRACTION_SYSTEM_PROMPT,
  BOUNDARY_EXTRACTION_PROMPT,
  type ExtractionResponse,
} from "./config"

export class LLMBoundaryExtractor implements BoundaryExtractor {
  constructor(
    private ai: AI,
    private configResolver: ConfigResolver
  ) {}

  async extract(context: ExtractionContext): Promise<ExtractionResult> {
    if (context.streamType === StreamTypes.THREAD) {
      return this.handleThreadMessage(context)
    }

    const config = await this.configResolver.resolve(COMPONENT_PATHS.BOUNDARY_EXTRACTION)
    const prompt = this.buildPrompt(context)

    try {
      const { value } = await this.ai.generateObject({
        model: config.modelId,
        schema: extractionResponseSchema,
        messages: [
          { role: "system", content: config.systemPrompt ?? BOUNDARY_EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: config.temperature,
        telemetry: {
          functionId: "boundary-extraction",
          metadata: {
            streamType: context.streamType,
            activeConversationCount: context.activeConversations.length,
          },
        },
        context: { workspaceId: context.workspaceId, origin: "system" },
      })

      return this.validateResult(value, context)
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
          `[${m.authorType}:${m.authorId.slice(-8)}]: ${m.contentMarkdown.slice(0, 200)}${m.contentMarkdown.length > 200 ? "..." : ""}`
      )
      .join("\n")

    return BOUNDARY_EXTRACTION_PROMPT.replace("{{CONVERSATIONS}}", convSection)
      .replace("{{RECENT_MESSAGES}}", recentSection || "No recent messages.")
      .replace("{{AUTHOR}}", `${context.newMessage.authorType}:${context.newMessage.authorId.slice(-8)}`)
      .replace("{{CONTENT}}", context.newMessage.contentMarkdown)
  }

  private validateResult(parsed: ExtractionResponse, context: ExtractionContext): ExtractionResult {
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
    const firstSentence = message.contentMarkdown.split(/[.!?\n]/)[0]?.trim()
    const text = firstSentence && firstSentence.length > 0 ? firstSentence : message.contentMarkdown.trim()

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
