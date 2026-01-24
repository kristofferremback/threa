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
import {
  STREAM_NAMING_MODEL_ID,
  STREAM_NAMING_TEMPERATURE,
  buildNamingSystemPrompt,
} from "../../../src/services/stream-naming/config"
import { COMPONENT_PATHS } from "../../../src/lib/ai/config-resolver"

/**
 * Task function that generates a stream name.
 * Uses ConfigResolver to get model/temperature, ensuring evals test production config.
 */
async function runStreamNamingTask(input: StreamNamingInput, ctx: EvalContext): Promise<StreamNamingOutput> {
  const existingNames = input.existingNames ?? []
  const requireName = input.requireName ?? false

  const config = await ctx.configResolver.resolve(COMPONENT_PATHS.STREAM_NAMING)
  const systemPrompt = buildNamingSystemPrompt(existingNames, requireName)

  try {
    const { value } = await ctx.ai.generateText({
      model: config.modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.conversationText },
      ],
      temperature: config.temperature,
      telemetry: {
        functionId: "stream-naming-eval",
        metadata: { requireName, existingNamesCount: existingNames.length },
      },
    })

    const rawName = value?.trim() || null

    // Check for NOT_ENOUGH_CONTEXT
    if (!rawName || rawName === "NOT_ENOUGH_CONTEXT") {
      return {
        input,
        name: null,
        notEnoughContext: true,
      }
    }

    // Clean up the response (remove quotes, trim)
    const cleanName = rawName.replace(/^["']|["']$/g, "").trim()

    return {
      input,
      name: cleanName,
      notEnoughContext: false,
    }
  } catch (error) {
    return {
      input,
      name: null,
      notEnoughContext: false,
      error: error instanceof Error ? error.message : String(error),
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
