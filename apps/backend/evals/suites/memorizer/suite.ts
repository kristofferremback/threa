/**
 * Memorizer Evaluation Suite
 *
 * Tests the Memorizer's ability to:
 * - Extract key information into self-contained memos
 * - Normalize relative dates to absolute dates
 * - Generate appropriate tags
 */

import type {
  EvalSuite,
  EvalContext,
  EvaluatorResult,
  Evaluator,
  RunEvaluator,
  CaseResult,
} from "../../framework/types"
import { containsEvaluator, fieldContainsEvaluator } from "../../framework/evaluators/contains"
import { llmJudgeEvaluator } from "../../framework/evaluators/llm-judge"
import { Memorizer, type MemoContent } from "../../../src/lib/memo/memorizer"
import { MessageFormatter } from "../../../src/lib/ai/message-formatter"
import { memorizerCases, createTestMessage, type MemorizerInput, type MemorizerExpected } from "./cases"
import { messageId } from "../../../src/lib/id"

/**
 * Task function that memorizes a message.
 */
async function memorizeMessage(input: MemorizerInput, ctx: EvalContext): Promise<MemoContent> {
  const messageFormatter = new MessageFormatter()
  const memorizer = new Memorizer(ctx.ai, ctx.permutation.model, messageFormatter)

  // Create a test message from the input
  const message = createTestMessage(input.content, messageId(), ctx.userId)

  // Memorize the message
  return memorizer.memorizeMessage({
    memoryContext: input.memoryContext ?? [],
    content: message,
    existingTags: input.existingTags ?? [],
    workspaceId: ctx.workspaceId,
    authorTimezone: input.authorTimezone,
  })
}

/**
 * Evaluator that checks if abstract contains expected phrases.
 */
const abstractContainsEvaluator: Evaluator<MemoContent, MemorizerExpected> = {
  name: "abstract-contains",
  evaluate: (output: MemoContent, expected: MemorizerExpected): EvaluatorResult => {
    if (!expected.abstractContains || expected.abstractContains.length === 0) {
      return { name: "abstract-contains", score: 1, passed: true, details: "No contains requirements" }
    }

    const abstract = output.abstract.toLowerCase()
    const found = expected.abstractContains.filter((phrase) => abstract.includes(phrase.toLowerCase()))
    const missing = expected.abstractContains.filter((phrase) => !abstract.includes(phrase.toLowerCase()))

    const score = found.length / expected.abstractContains.length
    const passed = score >= 0.7

    return {
      name: "abstract-contains",
      score,
      passed,
      details: missing.length > 0 ? `Missing: ${missing.map((s) => `"${s}"`).join(", ")}` : undefined,
    }
  },
}

/**
 * Evaluator that checks if abstract does NOT contain unwanted phrases.
 * Used to verify date normalization (e.g., "tomorrow" should be resolved).
 */
const abstractNotContainsEvaluator: Evaluator<MemoContent, MemorizerExpected> = {
  name: "abstract-not-contains",
  evaluate: (output: MemoContent, expected: MemorizerExpected): EvaluatorResult => {
    if (!expected.abstractNotContains || expected.abstractNotContains.length === 0) {
      return { name: "abstract-not-contains", score: 1, passed: true, details: "No exclusion requirements" }
    }

    const abstract = output.abstract.toLowerCase()
    const found = expected.abstractNotContains.filter((phrase) => abstract.includes(phrase.toLowerCase()))

    const passed = found.length === 0
    const score = passed ? 1 : 1 - found.length / expected.abstractNotContains.length

    return {
      name: "abstract-not-contains",
      score,
      passed,
      details: found.length > 0 ? `Unwanted phrases found: ${found.map((s) => `"${s}"`).join(", ")}` : undefined,
    }
  },
}

/**
 * Evaluator that checks minimum number of key points.
 */
const keyPointsEvaluator: Evaluator<MemoContent, MemorizerExpected> = {
  name: "key-points",
  evaluate: (output: MemoContent, expected: MemorizerExpected): EvaluatorResult => {
    if (expected.minKeyPoints === undefined) {
      return { name: "key-points", score: 1, passed: true, details: "No key points requirement" }
    }

    const actual = output.keyPoints.length
    const required = expected.minKeyPoints
    const passed = actual >= required
    const score = Math.min(1, actual / required)

    return {
      name: "key-points",
      score,
      passed,
      details: passed ? undefined : `Expected at least ${required} key points, got ${actual}`,
    }
  },
}

/**
 * Evaluator that checks if expected tags are present.
 */
const tagsEvaluator: Evaluator<MemoContent, MemorizerExpected> = {
  name: "tags",
  evaluate: (output: MemoContent, expected: MemorizerExpected): EvaluatorResult => {
    if (!expected.expectedTags || expected.expectedTags.length === 0) {
      return { name: "tags", score: 1, passed: true, details: "No tags requirement" }
    }

    const outputTags = output.tags.map((t) => t.toLowerCase())
    const found = expected.expectedTags.filter((tag) => outputTags.some((t) => t.includes(tag.toLowerCase())))
    const missing = expected.expectedTags.filter((tag) => !outputTags.some((t) => t.includes(tag.toLowerCase())))

    const score = found.length / expected.expectedTags.length
    const passed = score >= 0.5 // More lenient for tags

    return {
      name: "tags",
      score,
      passed,
      details: missing.length > 0 ? `Missing tags: ${missing.join(", ")}` : undefined,
    }
  },
}

/**
 * Evaluator that checks if title contains expected terms.
 */
const titleContainsEvaluator: Evaluator<MemoContent, MemorizerExpected> = {
  name: "title-contains",
  evaluate: (output: MemoContent, expected: MemorizerExpected): EvaluatorResult => {
    if (!expected.titleContains || expected.titleContains.length === 0) {
      return { name: "title-contains", score: 1, passed: true, details: "No title requirements" }
    }

    const title = output.title.toLowerCase()
    const found = expected.titleContains.filter((term) => title.includes(term.toLowerCase()))

    const score = found.length / expected.titleContains.length
    const passed = score >= 0.5

    return {
      name: "title-contains",
      score,
      passed,
      details:
        score < 1
          ? `Title "${output.title}" missing: ${expected.titleContains.filter((t) => !title.includes(t.toLowerCase())).join(", ")}`
          : undefined,
    }
  },
}

/**
 * Run-level evaluator for date normalization success rate.
 */
const dateNormalizationEvaluator: RunEvaluator<MemoContent, MemorizerExpected> = {
  name: "date-normalization",
  evaluate: (results: CaseResult<MemoContent, MemorizerExpected>[]) => {
    // Filter to cases that have abstractNotContains (date normalization cases)
    const dateNormCases = results.filter((r) => !r.error && r.expectedOutput.abstractNotContains?.length)

    if (dateNormCases.length === 0) {
      return { name: "date-normalization", score: 1, passed: true, details: "No date normalization cases" }
    }

    const passed = dateNormCases.filter((r) => {
      const abstract = r.output.abstract.toLowerCase()
      return !r.expectedOutput.abstractNotContains!.some((phrase) => abstract.includes(phrase.toLowerCase()))
    })

    const score = passed.length / dateNormCases.length

    return {
      name: "date-normalization",
      score,
      passed: score >= 0.7,
      details: `${passed.length}/${dateNormCases.length} dates normalized (${(score * 100).toFixed(1)}%)`,
    }
  },
}

/**
 * Memorizer Evaluation Suite
 */
export const memorizerSuite: EvalSuite<MemorizerInput, MemoContent, MemorizerExpected> = {
  name: "memorizer",
  description: "Evaluates the Memorizer's ability to extract information and normalize dates",

  cases: memorizerCases,

  task: memorizeMessage,

  evaluators: [
    abstractContainsEvaluator,
    abstractNotContainsEvaluator,
    keyPointsEvaluator,
    tagsEvaluator,
    titleContainsEvaluator,
  ],

  runEvaluators: [dateNormalizationEvaluator],

  defaultPermutations: [
    {
      model: "openrouter:openai/gpt-oss-120b",
      temperature: 0.3,
    },
  ],
}

export default memorizerSuite
