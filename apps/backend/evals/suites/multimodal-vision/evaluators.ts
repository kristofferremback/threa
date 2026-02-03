/**
 * Evaluators for Multimodal Vision Evaluation
 *
 * Tests whether the agent can see and describe images accurately.
 */

import type { Evaluator, EvalContext, EvaluatorResult, RunEvaluator, CaseResult } from "../../framework/types"
import { llmJudgeEvaluator } from "../../framework/evaluators/llm-judge"
import type { MultimodalVisionOutput, MultimodalVisionExpected } from "./types"

// =============================================================================
// Case-Level Evaluators
// =============================================================================

/**
 * Evaluates whether the agent responded at all.
 */
export const respondedEvaluator: Evaluator<MultimodalVisionOutput, MultimodalVisionExpected> = {
  name: "responded",
  evaluate: (output: MultimodalVisionOutput): EvaluatorResult => {
    const hasContent = output.messages.length > 0 && output.messages.some((m) => m.content.trim() !== "")

    return {
      name: "responded",
      score: hasContent ? 1 : 0,
      passed: hasContent,
      details: hasContent ? undefined : "Agent did not produce any response",
    }
  },
}

/**
 * Evaluates whether the response contains expected keywords.
 * This verifies the agent actually saw and understood the image.
 */
export const contentMentionsEvaluator: Evaluator<MultimodalVisionOutput, MultimodalVisionExpected> = {
  name: "content-mentions",
  evaluate: (output: MultimodalVisionOutput, expected: MultimodalVisionExpected): EvaluatorResult => {
    const shouldMention = expected.shouldMention
    if (!shouldMention || shouldMention.length === 0) {
      return { name: "content-mentions", score: 1, passed: true, details: "No mention requirements" }
    }

    const fullContent = output.messages.map((m) => m.content.toLowerCase()).join(" ")

    const found = shouldMention.filter((phrase) => fullContent.includes(phrase.toLowerCase()))
    const missing = shouldMention.filter((phrase) => !fullContent.includes(phrase.toLowerCase()))

    const score = found.length / shouldMention.length
    const passed = score >= 0.5 // At least half of expected keywords found

    return {
      name: "content-mentions",
      score,
      passed,
      details: missing.length > 0 ? `Missing keywords: ${missing.map((s) => `"${s}"`).join(", ")}` : undefined,
    }
  },
}

/**
 * Evaluates whether the response avoids hallucinated content.
 */
export const noHallucinationEvaluator: Evaluator<MultimodalVisionOutput, MultimodalVisionExpected> = {
  name: "no-hallucination",
  evaluate: (output: MultimodalVisionOutput, expected: MultimodalVisionExpected): EvaluatorResult => {
    const shouldNotMention = expected.shouldNotMention
    if (!shouldNotMention || shouldNotMention.length === 0) {
      return { name: "no-hallucination", score: 1, passed: true, details: "No exclusion requirements" }
    }

    const fullContent = output.messages.map((m) => m.content.toLowerCase()).join(" ")

    const found = shouldNotMention.filter((phrase) => fullContent.includes(phrase.toLowerCase()))

    const passed = found.length === 0
    const score = passed ? 1 : 1 - found.length / shouldNotMention.length

    return {
      name: "no-hallucination",
      score,
      passed,
      details: found.length > 0 ? `Hallucinated content found: ${found.map((s) => `"${s}"`).join(", ")}` : undefined,
    }
  },
}

/**
 * LLM-as-judge evaluator for image understanding quality.
 * Verifies the agent genuinely understood the image content.
 */
export function createImageUnderstandingEvaluator(): Evaluator<MultimodalVisionOutput, MultimodalVisionExpected> {
  const baseJudge = llmJudgeEvaluator<MultimodalVisionOutput, MultimodalVisionExpected>({
    name: "image-understanding",
    criteria: `The response demonstrates genuine understanding of the image content:
- References specific visual elements present in the image
- Does not hallucinate content that isn't there
- Provides accurate descriptions when asked
- Engages meaningfully with questions about the image`,
    passThreshold: 0.7,
  })

  return {
    name: "image-understanding",
    evaluate: async (
      output: MultimodalVisionOutput,
      expected: MultimodalVisionExpected,
      ctx: EvalContext
    ): Promise<EvaluatorResult> => {
      const fullContent = output.messages.map((m) => m.content).join("\n")
      if (!fullContent.trim()) {
        return { name: "image-understanding", score: 0, passed: false, details: "No response content" }
      }

      return baseJudge.evaluate(output, expected, ctx)
    },
  }
}

// =============================================================================
// Run-Level Evaluators
// =============================================================================

/**
 * Overall vision accuracy across all cases.
 */
export const visionAccuracyEvaluator: RunEvaluator<MultimodalVisionOutput, MultimodalVisionExpected> = {
  name: "vision-accuracy",
  evaluate: (results: CaseResult<MultimodalVisionOutput, MultimodalVisionExpected>[]) => {
    const validResults = results.filter((r) => !r.error)
    if (validResults.length === 0) {
      return { name: "vision-accuracy", score: 0, passed: false, details: "No valid results" }
    }

    // Count cases where all evaluations passed
    const allPassed = validResults.filter((r) => r.evaluations.every((e) => e.passed)).length
    const accuracy = allPassed / validResults.length

    return {
      name: "vision-accuracy",
      score: accuracy,
      passed: accuracy >= 0.7,
      details: `${allPassed}/${validResults.length} cases passed all evaluations (${(accuracy * 100).toFixed(1)}%)`,
    }
  },
}

/**
 * Average image understanding score.
 */
export const averageUnderstandingEvaluator: RunEvaluator<MultimodalVisionOutput, MultimodalVisionExpected> = {
  name: "average-understanding",
  evaluate: (results: CaseResult<MultimodalVisionOutput, MultimodalVisionExpected>[]) => {
    const understandingScores = results
      .filter((r) => !r.error)
      .map((r) => r.evaluations.find((e) => e.name === "image-understanding"))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map((e) => e.score)

    if (understandingScores.length === 0) {
      return { name: "average-understanding", score: 0, passed: false, details: "No understanding scores" }
    }

    const averageScore = understandingScores.reduce((a, b) => a + b, 0) / understandingScores.length

    return {
      name: "average-understanding",
      score: averageScore,
      passed: averageScore >= 0.7,
      details: `Average understanding: ${(averageScore * 100).toFixed(1)}%`,
    }
  },
}

/**
 * Hallucination rate across all cases.
 */
export const hallucinationRateEvaluator: RunEvaluator<MultimodalVisionOutput, MultimodalVisionExpected> = {
  name: "hallucination-rate",
  evaluate: (results: CaseResult<MultimodalVisionOutput, MultimodalVisionExpected>[]) => {
    const hallucinationResults = results
      .filter((r) => !r.error)
      .map((r) => r.evaluations.find((e) => e.name === "no-hallucination"))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)

    if (hallucinationResults.length === 0) {
      return { name: "hallucination-rate", score: 1, passed: true, details: "No hallucination checks" }
    }

    const passedCount = hallucinationResults.filter((e) => e.passed).length
    const score = passedCount / hallucinationResults.length

    return {
      name: "hallucination-rate",
      score,
      passed: score >= 0.9, // 90% should not hallucinate
      details: `${passedCount}/${hallucinationResults.length} cases passed hallucination check (${(score * 100).toFixed(1)}%)`,
    }
  },
}
