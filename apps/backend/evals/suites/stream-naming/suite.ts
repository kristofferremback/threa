/**
 * Stream Naming Evaluation Suite
 *
 * Tests the stream naming service's ability to generate descriptive,
 * concise titles (2-5 words) for conversations.
 *
 * ## Usage
 *
 *   # Run all stream naming tests
 *   bun run eval -- -s stream-naming
 *
 *   # Run specific cases
 *   bun run eval -- -s stream-naming -c technical-api-discussion-001
 *
 *   # Compare models
 *   bun run eval -- -s stream-naming -m openrouter:openai/gpt-4.1-mini,openrouter:anthropic/claude-haiku-4.5
 *
 * ## Key Evaluators
 *
 * - word-count: Is the name 2-5 words?
 * - name-contains: Does it contain expected topic words?
 * - name-not-contains: Does it avoid unwanted phrases?
 * - avoids-generic: Does it avoid generic names like "Quick Question"?
 * - not-enough-context: Correctly returns NOT_ENOUGH_CONTEXT for minimal input?
 */

import type { EvalSuite, EvalContext } from "../../framework/types"
import { streamNamingCases } from "./cases"
import type { StreamNamingInput, StreamNamingOutput, StreamNamingExpected } from "./types"
import {
  notEnoughContextEvaluator,
  wordCountEvaluator,
  nameContainsEvaluator,
  nameNotContainsEvaluator,
  avoidsGenericEvaluator,
  accuracyEvaluator,
  wordCountComplianceEvaluator,
} from "./evaluators"
import { STREAM_NAMING_MODEL_ID, STREAM_NAMING_TEMPERATURE } from "../../../src/features/streams"
import { StreamNamingService } from "../../../src/features/streams"
import { MessageFormatter } from "../../../src/lib/ai/message-formatter"

/**
 * Task function that generates a stream name.
 * Uses the PRODUCTION StreamNamingService.generateName() method directly (INV-45).
 */
async function runStreamNamingTask(input: StreamNamingInput, ctx: EvalContext): Promise<StreamNamingOutput> {
  const existingNames = input.existingNames ?? []
  const requireName = input.requireName ?? false

  // Use the production StreamNamingService
  const messageFormatter = new MessageFormatter()
  const namingService = new StreamNamingService(ctx.pool, ctx.ai, ctx.configResolver, messageFormatter)

  try {
    const result = await namingService.generateName(input.conversationText, existingNames, requireName, {
      workspaceId: ctx.workspaceId,
    })

    return {
      input,
      name: result.name,
      notEnoughContext: result.notEnoughContext,
    }
  } catch (error) {
    // requireName=true throws on NOT_ENOUGH_CONTEXT, which we catch and convert
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (errorMsg.includes("NOT_ENOUGH_CONTEXT")) {
      return {
        input,
        name: null,
        notEnoughContext: true,
      }
    }
    return {
      input,
      name: null,
      notEnoughContext: false,
      error: errorMsg,
    }
  }
}

/**
 * Stream Naming Evaluation Suite
 */
export const streamNamingSuite: EvalSuite<StreamNamingInput, StreamNamingOutput, StreamNamingExpected> = {
  name: "stream-naming",
  description: "Tests stream naming quality (2-5 word descriptive titles)",

  cases: streamNamingCases,

  task: runStreamNamingTask,

  evaluators: [
    notEnoughContextEvaluator,
    wordCountEvaluator,
    nameContainsEvaluator,
    nameNotContainsEvaluator,
    avoidsGenericEvaluator,
  ],

  runEvaluators: [accuracyEvaluator, wordCountComplianceEvaluator],

  defaultPermutations: [
    {
      model: STREAM_NAMING_MODEL_ID,
      temperature: STREAM_NAMING_TEMPERATURE,
    },
  ],
}

export default streamNamingSuite
