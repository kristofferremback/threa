/**
 * Eval runner for memo evolution.
 *
 * Runs evals against real models, tracks results with Langfuse,
 * and reports accuracy metrics.
 */

import { Langfuse } from "langfuse"
import { LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL, OLLAMA_EMBEDDING_MODEL } from "../config"
import { generateEmbedding, cosineSimilarity } from "./embedding-service"
import { verifyWithLLM } from "./llm-verifier"
import { buildDatasetFromFixtures, getDatasetStats, type EvalCase, type EvalDataset } from "./dataset"

export interface EvalResult {
  caseId: string
  scenario: string
  category: string

  // Embedding results
  embeddingSimilarity: number
  embeddingLatencyMs: number

  // LLM verification results
  llmSameTopic: boolean
  llmRelationship: string
  llmExplanation: string
  llmLatencyMs: number

  // Accuracy
  sameTopicCorrect: boolean
  expectedSameTopic: boolean
  expectedAction: string

  rawResponse?: string | null
  parsedResponse?: Record<string, any> | null

  // Error tracking
  error?: string
  errorStack?: string
}

export interface EvalRunSummary {
  runId: string
  model: string
  embeddingModel: string
  datasetName: string
  datasetVersion: string
  totalCases: number
  errorCount: number
  startedAt: string
  completedAt: string
  durationMs: number

  // Metrics
  sameTopicAccuracy: number
  sameTopicPrecision: number
  sameTopicRecall: number

  // Latencies
  avgEmbeddingLatencyMs: number
  avgLlmLatencyMs: number

  // Breakdown by scenario
  byScenario: Record<string, { total: number; errors: number; correct: number; accuracy: number }>
}

export interface EvalRunnerConfig {
  model: string
  langfuseEnabled: boolean
  verbose: boolean
}

/**
 * Run evals for memo evolution.
 */
export async function runEval(config: EvalRunnerConfig): Promise<EvalRunSummary> {
  const runId = `eval_${Date.now()}_${config.model.replace(/[:.]/g, "_")}`
  const startedAt = new Date()

  // Build dataset
  const dataset = buildDatasetFromFixtures()
  const stats = getDatasetStats(dataset)

  console.log(`\n📊 Memo Evolution Eval`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`Run ID: ${runId}`)
  console.log(`Model: ${config.model}`)
  console.log(`Embedding Model: ${OLLAMA_EMBEDDING_MODEL}`)
  console.log(`Dataset: ${dataset.name} v${dataset.version}`)
  console.log(`Total Cases: ${stats.total}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

  // Initialize Langfuse if enabled
  let langfuse: Langfuse | null = null
  if (config.langfuseEnabled && LANGFUSE_SECRET_KEY && LANGFUSE_PUBLIC_KEY) {
    langfuse = new Langfuse({
      secretKey: LANGFUSE_SECRET_KEY,
      publicKey: LANGFUSE_PUBLIC_KEY,
      baseUrl: LANGFUSE_BASE_URL,
    })
    console.log(`📡 Langfuse tracking enabled (${LANGFUSE_BASE_URL})\n`)
  }

  const results: EvalResult[] = []

  // Run each case
  for (let i = 0; i < dataset.cases.length; i++) {
    const evalCase = dataset.cases[i]
    const progress = `[${i + 1}/${dataset.cases.length}]`

    if (config.verbose) {
      console.log(`${progress} ${evalCase.id}`)
    } else {
      process.stdout.write(`\r${progress} Running...`)
    }

    const result = await runSingleCase(evalCase, config.model, langfuse, runId)
    results.push(result)

    if (config.verbose) {
      if (result.error) {
        console.log(`  ❌ ERROR: ${result.error}`)
        if (result.errorStack) {
          // Print first 3 lines of stack trace for context
          const stackLines = result.errorStack.split("\n").slice(0, 4).join("\n")
          console.log(`     ${stackLines.replace(/\n/g, "\n     ")}`)
        }
      } else {
        const status = result.sameTopicCorrect ? "✅" : "❌"
        console.log(
          `  ${status} same_topic: expected=${result.expectedSameTopic}, got=${result.llmSameTopic} (sim=${result.embeddingSimilarity.toFixed(2)})`,
        )

        if (result.parsedResponse) {
          console.log(`  Parsed Response: ${JSON.stringify(result.parsedResponse, null, 2)}`)
        } else if (result.rawResponse) {
          console.log(`  Raw Response: ${result.rawResponse}`)
        }
      }
    } else if (result.error) {
      // Always show errors even in non-verbose mode
      console.log(`\n❌ ${evalCase.id}: ${result.error}`)
    }
  }

  console.log(`\r${" ".repeat(40)}\r`) // Clear progress line

  // Calculate metrics
  const summary = calculateSummary(runId, config.model, dataset, results, startedAt)

  // Log to Langfuse
  if (langfuse) {
    await logSummaryToLangfuse(langfuse, summary)
    await langfuse.flushAsync()
  }

  // Print summary
  printSummary(summary)

  return summary
}

/**
 * Run a single eval case.
 */
async function runSingleCase(
  evalCase: EvalCase,
  modelString: string,
  langfuse: Langfuse | null,
  runId: string,
): Promise<EvalResult> {
  try {
    // Generate embeddings for anchor and new message
    const [anchorEmb, messageEmb] = await Promise.all([
      generateEmbedding(evalCase.memoAnchorContent),
      generateEmbedding(evalCase.newMessageContent),
    ])

    const embeddingSimilarity = cosineSimilarity(anchorEmb.embedding, messageEmb.embedding)

    // Run LLM verification
    const llmResult = await verifyWithLLM(evalCase.newMessageContent, evalCase.memoSummary, modelString)

    const sameTopicCorrect = llmResult.isSameTopic === evalCase.expectedSameTopic

    // Log to Langfuse if enabled
    if (langfuse) {
      const metadata = {
        model: llmResult.model,
        scenario: evalCase.scenario,
        category: evalCase.category,
        expectedAction: evalCase.expectedAction,
        expectedSameTopic: evalCase.expectedSameTopic,
      }

      const trace = langfuse.trace({
        id: `${runId}_${evalCase.id}`,
        name: "memo-evolution-eval",
        sessionId: runId,
        metadata,
      })

      // Log embedding generation
      trace.span({
        name: "embedding",
        metadata: {
          similarity: embeddingSimilarity,
          latencyMs: anchorEmb.latencyMs + messageEmb.latencyMs,
          ...metadata,
        },
      })

      // Log LLM verification
      trace.generation({
        name: "llm-verification",
        model: llmResult.model,
        input: {
          memoSummary: evalCase.memoSummary,
          newMessage: evalCase.newMessageContent,
        },
        output: {
          sameTopic: llmResult.isSameTopic,
          relationship: llmResult.relationship,
          explanation: llmResult.explanation,
        },
        metadata: {
          latencyMs: llmResult.latencyMs,
          rawResponse: llmResult.rawResponse,
          ...metadata,
        },
      })

      // Score the result
      langfuse.score({
        traceId: trace.id,
        name: "same_topic_accuracy",
        value: sameTopicCorrect ? 1 : 0,
        comment: sameTopicCorrect ? "Correct" : `Expected: ${evalCase.expectedSameTopic}, Got: ${llmResult.isSameTopic}`,
        metadata,
      })

      langfuse.score({
        traceId: trace.id,
        name: "embedding_similarity",
        value: embeddingSimilarity,
        metadata,
      })
    }

    return {
      caseId: evalCase.id,
      scenario: evalCase.scenario,
      category: evalCase.category,
      embeddingSimilarity,
      embeddingLatencyMs: anchorEmb.latencyMs + messageEmb.latencyMs,
      llmSameTopic: llmResult.isSameTopic,
      llmRelationship: llmResult.relationship,
      llmExplanation: llmResult.explanation,
      llmLatencyMs: llmResult.latencyMs,
      sameTopicCorrect,
      expectedSameTopic: evalCase.expectedSameTopic,
      expectedAction: evalCase.expectedAction,
      rawResponse: llmResult.rawResponse,
      parsedResponse: llmResult.parsedResponse,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const errorStack = err instanceof Error ? err.stack : undefined

    return {
      caseId: evalCase.id,
      scenario: evalCase.scenario,
      category: evalCase.category,
      embeddingSimilarity: 0,
      embeddingLatencyMs: 0,
      llmSameTopic: false,
      llmRelationship: "error",
      llmExplanation: error,
      llmLatencyMs: 0,
      sameTopicCorrect: false,
      expectedSameTopic: evalCase.expectedSameTopic,
      expectedAction: evalCase.expectedAction,
      rawResponse: null,
      parsedResponse: null,
      error,
      errorStack,
    }
  }
}

/**
 * Calculate summary metrics from results.
 */
function calculateSummary(
  runId: string,
  model: string,
  dataset: EvalDataset,
  results: EvalResult[],
  startedAt: Date,
): EvalRunSummary {
  const completedAt = new Date()

  // Count errors and filter successful results
  const errorCount = results.filter((r) => r.error).length
  const successfulResults = results.filter((r) => !r.error)

  // Same topic accuracy (only count successful results)
  const correct = successfulResults.filter((r) => r.sameTopicCorrect).length
  const sameTopicAccuracy = successfulResults.length > 0 ? correct / successfulResults.length : 0

  // Precision and recall for "same topic = true" (only count successful results)
  const truePositives = successfulResults.filter((r) => r.llmSameTopic && r.expectedSameTopic).length
  const falsePositives = successfulResults.filter((r) => r.llmSameTopic && !r.expectedSameTopic).length
  const falseNegatives = successfulResults.filter((r) => !r.llmSameTopic && r.expectedSameTopic).length

  const sameTopicPrecision = truePositives / (truePositives + falsePositives) || 0
  const sameTopicRecall = truePositives / (truePositives + falseNegatives) || 0

  // Latencies (only count successful results)
  const avgEmbeddingLatencyMs =
    successfulResults.length > 0
      ? successfulResults.reduce((sum, r) => sum + r.embeddingLatencyMs, 0) / successfulResults.length
      : 0
  const avgLlmLatencyMs =
    successfulResults.length > 0
      ? successfulResults.reduce((sum, r) => sum + r.llmLatencyMs, 0) / successfulResults.length
      : 0

  // By scenario
  const byScenario: Record<string, { total: number; errors: number; correct: number; accuracy: number }> = {}
  for (const r of results) {
    if (!byScenario[r.scenario]) {
      byScenario[r.scenario] = { total: 0, errors: 0, correct: 0, accuracy: 0 }
    }
    byScenario[r.scenario].total++
    if (r.error) {
      byScenario[r.scenario].errors++
    } else if (r.sameTopicCorrect) {
      byScenario[r.scenario].correct++
    }
  }
  for (const scenario of Object.keys(byScenario)) {
    const successCount = byScenario[scenario].total - byScenario[scenario].errors
    byScenario[scenario].accuracy = successCount > 0 ? byScenario[scenario].correct / successCount : 0
  }

  return {
    runId,
    model,
    embeddingModel: OLLAMA_EMBEDDING_MODEL,
    datasetName: dataset.name,
    datasetVersion: dataset.version,
    totalCases: results.length,
    errorCount,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    sameTopicAccuracy,
    sameTopicPrecision,
    sameTopicRecall,
    avgEmbeddingLatencyMs,
    avgLlmLatencyMs,
    byScenario,
  }
}

/**
 * Log summary to Langfuse as a separate trace.
 */
async function logSummaryToLangfuse(langfuse: Langfuse, summary: EvalRunSummary): Promise<void> {
  const trace = langfuse.trace({
    id: `${summary.runId}_summary`,
    name: "memo-evolution-eval-summary",
    sessionId: summary.runId,
    metadata: {
      model: summary.model,
      embeddingModel: summary.embeddingModel,
      datasetName: summary.datasetName,
      datasetVersion: summary.datasetVersion,
      totalCases: summary.totalCases,
      durationMs: summary.durationMs,
    },
  })

  langfuse.score({
    traceId: trace.id,
    name: "same_topic_accuracy",
    value: summary.sameTopicAccuracy,
  })

  langfuse.score({
    traceId: trace.id,
    name: "same_topic_precision",
    value: summary.sameTopicPrecision,
  })

  langfuse.score({
    traceId: trace.id,
    name: "same_topic_recall",
    value: summary.sameTopicRecall,
  })
}

/**
 * Print summary to console.
 */
function printSummary(summary: EvalRunSummary): void {
  console.log(`\n📈 Results`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

  if (summary.errorCount > 0) {
    console.log(`⚠️  Errors: ${summary.errorCount}/${summary.totalCases} cases failed`)
    console.log(``)
  }

  console.log(`Same Topic Accuracy: ${(summary.sameTopicAccuracy * 100).toFixed(1)}%`)
  console.log(`Same Topic Precision: ${(summary.sameTopicPrecision * 100).toFixed(1)}%`)
  console.log(`Same Topic Recall: ${(summary.sameTopicRecall * 100).toFixed(1)}%`)
  console.log(``)
  console.log(`Avg Embedding Latency: ${summary.avgEmbeddingLatencyMs.toFixed(0)}ms`)
  console.log(`Avg LLM Latency: ${summary.avgLlmLatencyMs.toFixed(0)}ms`)
  console.log(`Total Duration: ${(summary.durationMs / 1000).toFixed(1)}s`)
  console.log(``)
  console.log(`By Scenario:`)
  for (const [scenario, data] of Object.entries(summary.byScenario)) {
    const successCount = data.total - data.errors
    const pct = (data.accuracy * 100).toFixed(0)
    const bar = "█".repeat(Math.round(data.accuracy * 10)) + "░".repeat(10 - Math.round(data.accuracy * 10))
    const errorSuffix = data.errors > 0 ? ` ❌${data.errors}` : ""
    console.log(`  ${scenario.padEnd(25)} ${bar} ${pct}% (${data.correct}/${successCount}${errorSuffix})`)
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
}
