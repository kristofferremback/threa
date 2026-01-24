/**
 * Boundary Extraction Configuration
 *
 * Co-located config following INV-43 - both production code and evals
 * import from here to ensure consistency.
 */

import { z } from "zod"
import { CONVERSATION_STATUSES } from "@threa/types"

/** Default model for boundary extraction */
export const BOUNDARY_EXTRACTION_MODEL_ID = "openrouter:openai/gpt-4.1-mini"

/** Temperature for classification - low for consistency */
export const BOUNDARY_EXTRACTION_TEMPERATURE = 0.2

/** System prompt for boundary extraction */
export const BOUNDARY_EXTRACTION_SYSTEM_PROMPT = `You are a conversation boundary classifier. You analyze messages and output ONLY valid JSON matching the required schema. No explanations, no markdown, no prose - just the JSON object.`

/** User prompt template for boundary extraction */
export const BOUNDARY_EXTRACTION_PROMPT = `Analyze this message and determine which conversation it belongs to.

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

/**
 * Schema for LLM extraction response using structured outputs.
 */
export const extractionResponseSchema = z.object({
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

export type ExtractionResponse = z.infer<typeof extractionResponseSchema>
