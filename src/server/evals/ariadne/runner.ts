/**
 * Ariadne agent eval runner.
 *
 * Runs the agent against test cases using mock tools,
 * evaluates tool selection and response quality.
 */

import { createReactAgent } from "@langchain/langgraph/prebuilt"
import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOpenAI } from "@langchain/openai"
import { BaseMessageLike } from "@langchain/core/messages"
import { RunnableConfig, type RunnableInterface } from "@langchain/core/runnables"
import { MessagesAnnotation } from "@langchain/langgraph"
import { Langfuse } from "langfuse"
import { createMockTools, evaluateToolCalls, evaluateResponseQuality, type CapturedToolCall } from "./mock-tools"
import {
  buildAriadneDataset,
  getAriadneDatasetStats,
  type AriadneEvalCase,
  type AriadneEvalDataset,
} from "./dataset"
import { RETRIEVAL_PROMPT, THINKING_PARTNER_PROMPT } from "../../ai/ariadne/prompts"
import { parseModelString, type Provider } from "../llm-verifier"
import {
  LANGFUSE_SECRET_KEY,
  LANGFUSE_PUBLIC_KEY,
  LANGFUSE_BASE_URL,
} from "../../config"

export interface AriadneEvalResult {
  caseId: string
  scenario: string
  mode: string

  // Tool selection
  toolSelectionScore: number
  toolArgumentScore: number
  capturedTools: string[]
  expectedTools: string[]
  missingTools: string[]
  extraTools: string[]
  argErrors: string[]

  // Response quality
  responseQualityScore: number
  responseLength: number

  // Timing
  latencyMs: number

  // Combined score
  overallScore: number
}

export interface AriadneEvalRunSummary {
  runId: string
  model: string
  datasetName: string
  datasetVersion: string
  totalCases: number
  startedAt: string
  completedAt: string
  durationMs: number

  // Metrics
  avgToolSelectionScore: number
  avgToolArgumentScore: number
  avgResponseQualityScore: number
  avgOverallScore: number
  avgLatencyMs: number

  // Breakdown by scenario
  byScenario: Record<
    string,
    {
      total: number
      avgToolSelectionScore: number
      avgOverallScore: number
    }
  >
}

export interface AriadneEvalRunnerConfig {
  model: string
  langfuseEnabled: boolean
  verbose: boolean
}

/**
 * Create an agent for evaluation using mock tools.
 */
function createEvalAgent(
  evalCase: AriadneEvalCase,
  capturedCalls: CapturedToolCall[],
  modelString: string,
): RunnableInterface<{ messages: BaseMessageLike[] }, Record<string, unknown>> {
  const tools = createMockTools(evalCase, capturedCalls)
  const config = parseModelString(modelString)
  const isThinkingPartner = evalCase.mode === "thinking_partner"

  // Create model based on provider
  let model: ChatAnthropic | ChatOpenAI

  if (config.provider === "anthropic") {
    model = new ChatAnthropic({
      model: config.model,
      temperature: isThinkingPartner ? 0.8 : 0.7,
      maxTokens: isThinkingPartner ? 4096 : 2048,
    })
  } else if (config.provider === "openai") {
    model = new ChatOpenAI({
      model: config.model,
      temperature: isThinkingPartner ? 0.8 : 0.7,
      maxTokens: isThinkingPartner ? 4096 : 2048,
    })
  } else {
    // Default to Anthropic for Ollama models (won't work, but for structure)
    throw new Error(`Ollama models not supported in Ariadne evals - use anthropic or openai provider`)
  }

  // Dynamic prompt
  const prompt = (state: typeof MessagesAnnotation.State, _config: RunnableConfig): BaseMessageLike[] => {
    const systemPrompt = isThinkingPartner ? THINKING_PARTNER_PROMPT : RETRIEVAL_PROMPT
    return [{ role: "system", content: systemPrompt }, ...state.messages]
  }

  const agent = createReactAgent({
    llm: model,
    tools,
    prompt,
  })

  return agent as RunnableInterface<{ messages: BaseMessageLike[] }, Record<string, unknown>>
}

/**
 * Run a single eval case.
 */
async function runSingleCase(
  evalCase: AriadneEvalCase,
  modelString: string,
  langfuse: Langfuse | null,
  runId: string,
): Promise<AriadneEvalResult> {
  const capturedCalls: CapturedToolCall[] = []
  const agent = createEvalAgent(evalCase, capturedCalls, modelString)
  const start = performance.now()

  let response = ""

  try {
    const result = await agent.invoke({
      messages: [{ role: "user", content: evalCase.question }],
    })

    // Extract response from result
    const messages = result.messages as Array<{ content: string | unknown }>
    const lastMessage = messages[messages.length - 1]
    response = typeof lastMessage.content === "string" ? lastMessage.content : JSON.stringify(lastMessage.content)
  } catch (err) {
    response = `Error: ${err instanceof Error ? err.message : String(err)}`
  }

  const latencyMs = performance.now() - start

  // Evaluate tool calls
  const toolEval = evaluateToolCalls(capturedCalls, evalCase)

  // Evaluate response quality
  const responseQualityScore = evaluateResponseQuality(response, evalCase)

  // Calculate overall score (weighted average)
  const overallScore =
    toolEval.toolSelectionScore * 0.4 + toolEval.toolArgumentScore * 0.3 + responseQualityScore * 0.3

  // Log to Langfuse
  if (langfuse) {
    const trace = langfuse.trace({
      id: `${runId}_${evalCase.id}`,
      name: "ariadne-agent-eval",
      sessionId: runId,
      metadata: {
        scenario: evalCase.scenario,
        mode: evalCase.mode,
        expectedTools: evalCase.expectedTools.map((t) => t.tool),
        question: evalCase.question,
      },
    })

    langfuse.score({
      traceId: trace.id,
      name: "tool_selection",
      value: toolEval.toolSelectionScore,
    })

    langfuse.score({
      traceId: trace.id,
      name: "tool_arguments",
      value: toolEval.toolArgumentScore,
    })

    langfuse.score({
      traceId: trace.id,
      name: "response_quality",
      value: responseQualityScore,
    })

    langfuse.score({
      traceId: trace.id,
      name: "overall",
      value: overallScore,
    })
  }

  return {
    caseId: evalCase.id,
    scenario: evalCase.scenario,
    mode: evalCase.mode,
    toolSelectionScore: toolEval.toolSelectionScore,
    toolArgumentScore: toolEval.toolArgumentScore,
    capturedTools: toolEval.details.capturedTools,
    expectedTools: toolEval.details.expectedTools,
    missingTools: toolEval.details.missing,
    extraTools: toolEval.details.extra,
    argErrors: toolEval.details.argErrors,
    responseQualityScore,
    responseLength: response.length,
    latencyMs,
    overallScore,
  }
}

/**
 * Run the full Ariadne eval suite.
 */
export async function runAriadneEval(config: AriadneEvalRunnerConfig): Promise<AriadneEvalRunSummary> {
  const runId = `ariadne_eval_${Date.now()}_${config.model.replace(/[:.]/g, "_")}`
  const startedAt = new Date()

  // Build dataset
  const dataset = buildAriadneDataset()
  const stats = getAriadneDatasetStats(dataset)

  console.log(`\n🧵 Ariadne Agent Eval`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`Run ID: ${runId}`)
  console.log(`Model: ${config.model}`)
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

  const results: AriadneEvalResult[] = []

  // Run each case
  for (let i = 0; i < dataset.cases.length; i++) {
    const evalCase = dataset.cases[i]
    const progress = `[${i + 1}/${dataset.cases.length}]`

    if (config.verbose) {
      console.log(`${progress} ${evalCase.id} - "${evalCase.question.slice(0, 50)}..."`)
    } else {
      process.stdout.write(`\r${progress} Running...`)
    }

    try {
      const result = await runSingleCase(evalCase, config.model, langfuse, runId)
      results.push(result)

      if (config.verbose) {
        const status = result.overallScore >= 0.7 ? "✅" : result.overallScore >= 0.4 ? "⚠️" : "❌"
        console.log(
          `  ${status} overall=${(result.overallScore * 100).toFixed(0)}% ` +
            `tools=${(result.toolSelectionScore * 100).toFixed(0)}% ` +
            `(${result.capturedTools.join(", ") || "none"})`,
        )
      }
    } catch (err) {
      console.error(`\n❌ Error on case ${evalCase.id}:`, err)
    }
  }

  console.log(`\r${" ".repeat(40)}\r`) // Clear progress line

  // Calculate summary
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
 * Calculate summary metrics.
 */
function calculateSummary(
  runId: string,
  model: string,
  dataset: AriadneEvalDataset,
  results: AriadneEvalResult[],
  startedAt: Date,
): AriadneEvalRunSummary {
  const completedAt = new Date()

  // Averages
  const avgToolSelectionScore = results.reduce((sum, r) => sum + r.toolSelectionScore, 0) / results.length
  const avgToolArgumentScore = results.reduce((sum, r) => sum + r.toolArgumentScore, 0) / results.length
  const avgResponseQualityScore = results.reduce((sum, r) => sum + r.responseQualityScore, 0) / results.length
  const avgOverallScore = results.reduce((sum, r) => sum + r.overallScore, 0) / results.length
  const avgLatencyMs = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length

  // By scenario
  const byScenario: Record<string, { total: number; avgToolSelectionScore: number; avgOverallScore: number }> = {}

  for (const r of results) {
    if (!byScenario[r.scenario]) {
      byScenario[r.scenario] = { total: 0, avgToolSelectionScore: 0, avgOverallScore: 0 }
    }
    byScenario[r.scenario].total++
    byScenario[r.scenario].avgToolSelectionScore += r.toolSelectionScore
    byScenario[r.scenario].avgOverallScore += r.overallScore
  }

  for (const scenario of Object.keys(byScenario)) {
    byScenario[scenario].avgToolSelectionScore /= byScenario[scenario].total
    byScenario[scenario].avgOverallScore /= byScenario[scenario].total
  }

  return {
    runId,
    model,
    datasetName: dataset.name,
    datasetVersion: dataset.version,
    totalCases: results.length,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    avgToolSelectionScore,
    avgToolArgumentScore,
    avgResponseQualityScore,
    avgOverallScore,
    avgLatencyMs,
    byScenario,
  }
}

/**
 * Log summary to Langfuse.
 */
async function logSummaryToLangfuse(langfuse: Langfuse, summary: AriadneEvalRunSummary): Promise<void> {
  const trace = langfuse.trace({
    id: `${summary.runId}_summary`,
    name: "ariadne-agent-eval-summary",
    sessionId: summary.runId,
    metadata: {
      model: summary.model,
      datasetName: summary.datasetName,
      datasetVersion: summary.datasetVersion,
      totalCases: summary.totalCases,
      durationMs: summary.durationMs,
    },
  })

  langfuse.score({
    traceId: trace.id,
    name: "avg_tool_selection",
    value: summary.avgToolSelectionScore,
  })

  langfuse.score({
    traceId: trace.id,
    name: "avg_tool_arguments",
    value: summary.avgToolArgumentScore,
  })

  langfuse.score({
    traceId: trace.id,
    name: "avg_response_quality",
    value: summary.avgResponseQualityScore,
  })

  langfuse.score({
    traceId: trace.id,
    name: "avg_overall",
    value: summary.avgOverallScore,
  })
}

/**
 * Print summary to console.
 */
function printSummary(summary: AriadneEvalRunSummary): void {
  console.log(`\n📈 Results`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`Tool Selection Score: ${(summary.avgToolSelectionScore * 100).toFixed(1)}%`)
  console.log(`Tool Argument Score: ${(summary.avgToolArgumentScore * 100).toFixed(1)}%`)
  console.log(`Response Quality Score: ${(summary.avgResponseQualityScore * 100).toFixed(1)}%`)
  console.log(`Overall Score: ${(summary.avgOverallScore * 100).toFixed(1)}%`)
  console.log(``)
  console.log(`Avg Latency: ${summary.avgLatencyMs.toFixed(0)}ms`)
  console.log(`Total Duration: ${(summary.durationMs / 1000).toFixed(1)}s`)
  console.log(``)
  console.log(`By Scenario:`)

  for (const [scenario, data] of Object.entries(summary.byScenario)) {
    const pct = (data.avgOverallScore * 100).toFixed(0)
    const bar = "█".repeat(Math.round(data.avgOverallScore * 10)) + "░".repeat(10 - Math.round(data.avgOverallScore * 10))
    console.log(`  ${scenario.padEnd(20)} ${bar} ${pct}% (n=${data.total})`)
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
}
