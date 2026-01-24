/**
 * Boundary Extraction Evaluation Suite
 *
 * Tests the boundary extractor's ability to correctly classify messages
 * into existing conversations or identify new conversation topics.
 *
 * ## Usage
 *
 *   # Run all boundary extraction tests
 *   bun run eval -- -s boundary-extraction
 *
 *   # Run specific cases
 *   bun run eval -- -s boundary-extraction -c new-topic-fresh-stream-001
 *
 *   # Compare models
 *   bun run eval -- -s boundary-extraction -m openrouter:openai/gpt-4.1-mini,openrouter:anthropic/claude-haiku-4.5
 *
 * ## Key Evaluators
 *
 * - conversation-decision: Correct new vs existing decision?
 * - topic-contains: New topic contains expected keywords?
 * - confidence: Above minimum threshold?
 * - completeness-update: Correct resolution detection?
 */

import type { EvalSuite, EvalContext } from "../../framework/types"
import { boundaryExtractionCases } from "./cases"
import type { BoundaryExtractionInput, BoundaryExtractionOutput, BoundaryExtractionExpected } from "./types"
import {
  conversationDecisionEvaluator,
  topicContainsEvaluator,
  confidenceEvaluator,
  completenessUpdateEvaluator,
  accuracyEvaluator,
  decisionAccuracyEvaluator,
  averageConfidenceEvaluator,
} from "./evaluators"
import {
  BOUNDARY_EXTRACTION_MODEL_ID,
  BOUNDARY_EXTRACTION_TEMPERATURE,
  BOUNDARY_EXTRACTION_SYSTEM_PROMPT,
  BOUNDARY_EXTRACTION_PROMPT,
  extractionResponseSchema,
} from "../../../src/lib/boundary-extraction/config"
import type { Message } from "../../../src/repositories/message-repository"
import { ulid } from "ulid"

/**
 * Convert eval message to production Message type.
 */
function toMessage(evalMsg: BoundaryExtractionInput["newMessage"], streamId: string): Message {
  return {
    id: `msg_${ulid()}`,
    streamId,
    sequence: BigInt(1),
    authorId: evalMsg.authorId,
    authorType: evalMsg.authorType,
    contentJson: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: evalMsg.contentMarkdown }] }],
    },
    contentMarkdown: evalMsg.contentMarkdown,
    replyCount: 0,
    reactions: {},
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
  }
}

/**
 * Build prompt from input context.
 */
function buildPrompt(input: BoundaryExtractionInput): string {
  const conversations = input.activeConversations || []
  const recentMessages = input.recentMessages || []

  const convSection =
    conversations.length > 0
      ? conversations
          .map(
            (c) =>
              `- ${c.id}: "${c.topicSummary ?? "No topic yet"}" (${c.messageCount} messages, completeness: ${c.completenessScore}/7, participants: ${c.participantIds.length})`
          )
          .join("\n")
      : "No active conversations in this stream yet."

  const recentSection = recentMessages
    .map(
      (m) =>
        `[${m.authorType}:${m.authorId.slice(-8)}]: ${m.contentMarkdown.slice(0, 200)}${m.contentMarkdown.length > 200 ? "..." : ""}`
    )
    .join("\n")

  return BOUNDARY_EXTRACTION_PROMPT.replace("{{CONVERSATIONS}}", convSection)
    .replace("{{RECENT_MESSAGES}}", recentSection || "No recent messages.")
    .replace("{{AUTHOR}}", `${input.newMessage.authorType}:${input.newMessage.authorId.slice(-8)}`)
    .replace("{{CONTENT}}", input.newMessage.contentMarkdown)
}

/**
 * Task function that runs boundary extraction.
 */
async function runBoundaryExtractionTask(
  input: BoundaryExtractionInput,
  ctx: EvalContext
): Promise<BoundaryExtractionOutput> {
  const prompt = buildPrompt(input)

  try {
    const { value } = await ctx.ai.generateObject({
      model: ctx.permutation.model,
      schema: extractionResponseSchema,
      messages: [
        { role: "system", content: BOUNDARY_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: ctx.permutation.temperature ?? BOUNDARY_EXTRACTION_TEMPERATURE,
      telemetry: {
        functionId: "boundary-extraction-eval",
        metadata: {
          streamType: input.streamType,
          activeConversationCount: input.activeConversations?.length ?? 0,
        },
      },
    })

    // Validate that returned conversation ID exists in active conversations
    const validConvIds = new Set((input.activeConversations || []).map((c) => c.id))
    const conversationId = value.conversationId && validConvIds.has(value.conversationId) ? value.conversationId : null

    return {
      input,
      conversationId,
      newConversationTopic: value.newConversationTopic ?? undefined,
      completenessUpdates: value.completenessUpdates ?? undefined,
      confidence: value.confidence,
    }
  } catch (error) {
    return {
      input,
      conversationId: null,
      confidence: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Boundary Extraction Evaluation Suite
 */
export const boundaryExtractionSuite: EvalSuite<
  BoundaryExtractionInput,
  BoundaryExtractionOutput,
  BoundaryExtractionExpected
> = {
  name: "boundary-extraction",
  description: "Tests conversation boundary classification accuracy",

  cases: boundaryExtractionCases,

  task: runBoundaryExtractionTask,

  evaluators: [conversationDecisionEvaluator, topicContainsEvaluator, confidenceEvaluator, completenessUpdateEvaluator],

  runEvaluators: [accuracyEvaluator, decisionAccuracyEvaluator, averageConfidenceEvaluator],

  defaultPermutations: [
    {
      model: BOUNDARY_EXTRACTION_MODEL_ID,
      temperature: BOUNDARY_EXTRACTION_TEMPERATURE,
    },
  ],
}

export default boundaryExtractionSuite
