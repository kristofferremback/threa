import type { BoundaryExtractor, ExtractionContext, ExtractionResult } from "./types"
import { logger } from "../logger"
import { StreamTypes } from "@threa/types"

/**
 * Stub boundary extractor for CI/test environments where the LLM API is not available.
 * Always creates new conversations for scratchpad/channel messages.
 * For thread messages, joins existing conversation or creates a new one.
 */
export class StubBoundaryExtractor implements BoundaryExtractor {
  async extract(context: ExtractionContext): Promise<ExtractionResult> {
    logger.debug({ messageId: context.newMessage.id }, "Using stub boundary extractor")

    // Thread handling is deterministic - no LLM needed
    if (context.streamType === StreamTypes.THREAD) {
      const existingConv = context.activeConversations[0]
      if (existingConv) {
        return {
          conversationId: existingConv.id,
          confidence: 1.0,
        }
      }

      const parentConv = context.parentMessageConversations?.[0]
      if (parentConv) {
        return {
          conversationId: parentConv.id,
          confidence: 1.0,
        }
      }
    }

    // For non-thread messages, always create a new conversation
    // This is a simplification for testing - real extractor uses LLM to group messages
    return {
      conversationId: null,
      newConversationTopic: this.extractTopic(context.newMessage.content),
      confidence: 1.0,
    }
  }

  private extractTopic(content: string): string {
    const firstSentence = content.split(/[.!?\n]/)[0]?.trim()
    const text = firstSentence && firstSentence.length > 0 ? firstSentence : content.trim()

    if (text.length <= 100) {
      return text
    }

    const lastSpace = text.lastIndexOf(" ", 99)
    if (lastSpace > 20) {
      return text.slice(0, lastSpace) + "…"
    }

    return text.slice(0, 99) + "…"
  }
}
