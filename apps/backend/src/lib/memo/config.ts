/**
 * Memo AI Configuration
 *
 * Central configuration for memo classification and memorization.
 * Used by both production code and evals to ensure consistency.
 */

import { z } from "zod"
import { KNOWLEDGE_TYPES } from "@threa/types"
import { formatDate } from "../temporal"

// ============================================================================
// Model Configuration
// ============================================================================

/**
 * Default model for memo classification and generation.
 * Can be overridden via AI_MEMO_MODEL environment variable.
 */
export const MEMO_MODEL_ID = "openrouter:openai/gpt-oss-120b"

/**
 * Temperature settings for different operations.
 */
export const MEMO_TEMPERATURES = {
  classification: 0.1, // Low temperature for consistent classification
  memorization: 0.3, // Slightly higher for creative summarization
} as const

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for message classification output.
 * OpenAI's strict mode requires ALL properties in `required`,
 * so we use `.nullable()` instead of `.optional()`.
 */
export const messageClassificationSchema = z.object({
  isGem: z.boolean().describe("Whether this message is a standalone gem worth memorizing"),
  knowledgeType: z
    .enum(KNOWLEDGE_TYPES)
    .nullable()
    .describe(`Type of knowledge if isGem is true: ${KNOWLEDGE_TYPES.map((t) => `"${t}"`).join(" | ")}`),
  confidence: z.number().min(0).max(1).nullable().describe("Confidence in this classification (0.0 to 1.0)"),
  reasoning: z.string().nullable().describe("Brief explanation of the classification decision"),
})

export type MessageClassificationOutput = z.infer<typeof messageClassificationSchema>

/**
 * Schema for conversation classification output.
 */
export const conversationClassificationSchema = z.object({
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

export type ConversationClassificationOutput = z.infer<typeof conversationClassificationSchema>

/**
 * Schema for memo content generation.
 */
export const memoContentSchema = z.object({
  title: z.string().max(100).describe("Concise title summarizing the memo (max 100 characters)"),
  abstract: z.string().describe("Self-contained 1-2 paragraph summary preserving ALL important information"),
  keyPoints: z.array(z.string()).max(5).describe("Up to 5 key points extracted from the content"),
  tags: z.array(z.string()).max(5).describe("Up to 5 relevant tags for categorization"),
  sourceMessageIds: z.array(z.string()).describe("IDs of messages that contain the key information"),
})

export type MemoContentOutput = z.infer<typeof memoContentSchema>

// ============================================================================
// Classifier Prompts
// ============================================================================

export const CLASSIFIER_MESSAGE_SYSTEM_PROMPT = `You are a knowledge classifier for a team chat application. You identify standalone messages that contain valuable knowledge worth preserving ("gems").

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
- Messages from AI/personas (when "From: persona") - we preserve human knowledge, not AI-generated content

IMPORTANT:
- If isGem is false, knowledgeType MUST be null
- Only set knowledgeType when isGem is true

Output ONLY valid JSON matching the schema. Keep reasoning to ONE brief sentence.`

export const CLASSIFIER_CONVERSATION_SYSTEM_PROMPT = `You are a knowledge classifier for a team chat application. You identify conversations that contain valuable knowledge worth preserving in organizational memory.

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

export const CLASSIFIER_MESSAGE_PROMPT = `Classify this message. Is it a standalone gem worth preserving?

## Message
From: {{AUTHOR_TYPE}} ({{AUTHOR_ID}})
Content:
{{CONTENT}}`

export const CLASSIFIER_CONVERSATION_PROMPT = `Classify this conversation. Is it worth preserving in organizational memory?

## Conversation
Topic: {{TOPIC}}
Participants: {{PARTICIPANTS}}
Message count: {{MESSAGE_COUNT}}

## Messages
{{MESSAGES}}

{{EXISTING_MEMO_SECTION}}`

export const CLASSIFIER_EXISTING_MEMO_TEMPLATE = `## Existing Memo
Title: {{MEMO_TITLE}}
Abstract: {{MEMO_ABSTRACT}}
Version: {{MEMO_VERSION}}
Created: {{MEMO_CREATED}}

Should this memo be revised based on the conversation above?`

// ============================================================================
// Memorizer Prompts
// ============================================================================

const MEMORIZER_SYSTEM_PROMPT_TEMPLATE = `You are a knowledge preservation specialist for a team chat application. You create concise, self-contained memos that capture valuable information from conversations.

Your memos should:
1. Be SELF-CONTAINED - a reader should understand the memo without seeing the original messages
2. Preserve ALL important information - decisions, rationale, context, participants
3. Be FACTUAL - no meta-commentary like "this memo captures..." or "the team discussed..."
4. Use consistent vocabulary with prior memos when similar concepts appear
5. RESOLVE PRONOUNS when possible - If you can determine who "he/she/they" refers to from the conversation, use their actual name. If unclear (e.g., conversation continues from offline), leave the pronoun. When in doubt, preserve the original wording.
6. ANCHOR DATES when possible - Convert relative dates ("yesterday", "next week") to actual dates using today's date: {{CURRENT_DATE}}. If ambiguous, leave as-is.

The abstract should be 1-2 paragraphs that could stand alone as organizational memory.

Output ONLY valid JSON matching the schema.`

/**
 * Get the memorizer system prompt with date anchoring.
 */
export function getMemorizerSystemPrompt(timezone?: string): string {
  const now = new Date()
  const tz = timezone ?? "UTC"
  const today = formatDate(now, tz, "YYYY-MM-DD")
  return MEMORIZER_SYSTEM_PROMPT_TEMPLATE.replace("{{CURRENT_DATE}}", today)
}

export const MEMORIZER_MESSAGE_PROMPT = `Create a memo for this standalone message.

## Memory Context (prior memos for vocabulary consistency)
{{MEMORY_CONTEXT}}

## Message to Memorize
ID: {{MESSAGE_ID}}
From: {{AUTHOR_TYPE}}
Content:
{{CONTENT}}

{{EXISTING_TAGS_SECTION}}

Create a self-contained memo that preserves this knowledge.`

export const MEMORIZER_CONVERSATION_PROMPT = `Create a memo for this conversation.

## Memory Context (prior memos for vocabulary consistency)
{{MEMORY_CONTEXT}}

## Conversation Messages
{{MESSAGES}}

{{EXISTING_TAGS_SECTION}}

Create a self-contained memo that captures the key knowledge from this conversation.
In sourceMessageIds, include ONLY the message IDs that contain the most important information.`

export const MEMORIZER_REVISION_PROMPT = `Revise the existing memo based on new conversation content.

## Memory Context (prior memos for vocabulary consistency)
{{MEMORY_CONTEXT}}

## Existing Memo
Title: {{MEMO_TITLE}}
Abstract: {{MEMO_ABSTRACT}}
Key Points:
{{MEMO_KEY_POINTS}}

## Updated Conversation
{{MESSAGES}}

{{EXISTING_TAGS_SECTION}}

Create an updated memo that incorporates the new information while preserving existing valuable content.`

export const MEMORIZER_EXISTING_TAGS_TEMPLATE = `## Existing Tags in Workspace
Prefer these tags when applicable, but create new ones if needed:
{{TAGS}}`
