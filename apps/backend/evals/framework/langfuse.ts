/**
 * Langfuse integration for evaluation experiment tracking.
 *
 * Uses the Langfuse JS SDK to record experiment traces with scores.
 * Gracefully degrades when Langfuse is not configured.
 */

import { Langfuse } from "langfuse"
import type { EvalPermutation, CaseResult, EvaluatorResult, LangfuseOptions } from "./types"
import { logger } from "../../src/lib/logger"

let langfuseClient: Langfuse | null = null

/**
 * Check if Langfuse is configured and available.
 */
export function isLangfuseConfigured(): boolean {
  return !!(process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY)
}

/**
 * Get or create the Langfuse client.
 * Returns null if Langfuse is not configured.
 */
function getLangfuseClient(): Langfuse | null {
  if (!isLangfuseConfigured()) {
    return null
  }

  if (!langfuseClient) {
    langfuseClient = new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      baseUrl: process.env.LANGFUSE_BASE_URL || "http://localhost:3100",
    })
  }

  return langfuseClient
}

/**
 * Record an evaluation run to Langfuse.
 *
 * Creates a trace for the suite run with:
 * - Permutation configuration in metadata
 * - Individual spans for each case
 * - Scores for each evaluator result
 */
export async function recordEvalRun<TOutput, TExpected>(params: {
  suiteName: string
  permutation: EvalPermutation
  cases: CaseResult<TOutput, TExpected>[]
  runEvaluations: EvaluatorResult[]
  options: LangfuseOptions
}): Promise<string | undefined> {
  const { suiteName, permutation, cases, runEvaluations, options } = params

  if (!options.enabled) {
    return undefined
  }

  const client = getLangfuseClient()
  if (!client) {
    logger.warn("Langfuse not configured, skipping experiment recording")
    return undefined
  }

  // Create permutation label for trace name
  const permutationLabel = [
    permutation.model.split(":")[1] || permutation.model,
    permutation.temperature !== undefined ? `t${permutation.temperature}` : null,
    permutation.promptVariant || null,
  ]
    .filter(Boolean)
    .join("-")

  // Create trace for this eval run
  const trace = client.trace({
    name: `${suiteName}/${permutationLabel}`,
    metadata: {
      suiteName,
      permutation,
      caseCount: cases.length,
      passedCount: cases.filter((c) => c.evaluations.every((e) => e.passed)).length,
      failedCount: cases.filter((c) => c.evaluations.some((e) => !e.passed)).length,
    },
    tags: ["eval", suiteName, permutation.model.split(":")[1] || permutation.model],
  })

  // Record each case as a span with scores
  for (const caseResult of cases) {
    const span = trace.span({
      name: caseResult.caseName,
      input: caseResult.input,
      output: caseResult.output,
      metadata: {
        caseId: caseResult.caseId,
        durationMs: caseResult.durationMs,
        error: caseResult.error?.message,
      },
    })

    // Record evaluator scores
    for (const evaluation of caseResult.evaluations) {
      span.score({
        name: evaluation.name,
        value: evaluation.score,
        comment: evaluation.details,
      })
    }

    span.end()
  }

  // Record run-level evaluations as trace scores
  for (const evaluation of runEvaluations) {
    trace.score({
      name: evaluation.name,
      value: evaluation.score,
      comment: evaluation.details,
    })
  }

  // Flush to ensure all data is sent
  await client.flushAsync()

  logger.info({ traceId: trace.id, suiteName, permutationLabel }, "Recorded eval run to Langfuse")

  return trace.id
}

/**
 * Shutdown Langfuse client gracefully.
 * Call this before process exit.
 */
export async function shutdownLangfuse(): Promise<void> {
  if (langfuseClient) {
    await langfuseClient.shutdownAsync()
    langfuseClient = null
  }
}
