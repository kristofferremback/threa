/**
 * Ariadne agent eval runner.
 *
 * Runs the agent against test cases using REAL tools against a seeded test database.
 * Evaluates tool selection, argument accuracy, and retrieval quality.
 */

import { Pool } from "pg"
import { createReactAgent } from "@langchain/langgraph/prebuilt"
import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOpenAI } from "@langchain/openai"
import { BaseMessageLike, AIMessage, ToolMessage } from "@langchain/core/messages"
import { RunnableConfig, type RunnableInterface } from "@langchain/core/runnables"
import { StructuredTool } from "@langchain/core/tools"
import { MessagesAnnotation } from "@langchain/langgraph"
import { Langfuse } from "langfuse"
import { setupAriadneEval, cleanupAriadneEvalData, type SeededData } from "./seed-data"
import { buildAriadneDataset, getAriadneDatasetStats, type AriadneEvalCase, type AriadneEvalDataset } from "./dataset"
import { createAriadneTools, type AriadneToolsContext } from "../../ai/ariadne/tools"
import { RETRIEVAL_PROMPT, THINKING_PARTNER_PROMPT } from "../../ai/ariadne/prompts"
import { parseModelString } from "../llm-verifier"
import { LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL } from "../../config"
import { closeTestPool } from "../../services/__tests__/test-helpers"

export interface CapturedToolCall {
  name: string
  args: Record<string, unknown>
  result: string
  timestamp: number
}

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

  // Retrieval quality (new)
  retrievalScore: number
  expectedSources: string[]
  foundSources: string[]
  missingSources: string[]

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
  avgRetrievalScore: number
  avgResponseQualityScore: number
  avgOverallScore: number
  avgLatencyMs: number

  // Breakdown by scenario
  byScenario: Record<
    string,
    {
      total: number
      avgToolSelectionScore: number
      avgRetrievalScore: number
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
 * Wrap tools to capture their calls while still executing them.
 */
function wrapToolsForCapture(
  tools: StructuredTool[],
  capturedCalls: CapturedToolCall[],
): StructuredTool[] {
  return tools.map((tool) => {
    const originalInvoke = tool.invoke.bind(tool)

    // Override invoke to capture calls
    tool.invoke = async (input: unknown, config?: unknown) => {
      const result = await originalInvoke(input, config)
      capturedCalls.push({
        name: tool.name,
        args: input as Record<string, unknown>,
        result: typeof result === "string" ? result : JSON.stringify(result),
        timestamp: Date.now(),
      })
      return result
    }

    return tool
  })
}

/**
 * Create an agent for evaluation using real tools.
 */
function createEvalAgent(
  pool: Pool,
  seededData: SeededData,
  evalCase: AriadneEvalCase,
  capturedCalls: CapturedToolCall[],
  modelString: string,
): RunnableInterface<{ messages: BaseMessageLike[] }, Record<string, unknown>> {
  const config = parseModelString(modelString)
  const isThinkingPartner = evalCase.mode === "thinking_partner"

  // Create tool context for the eval user
  const toolContext: AriadneToolsContext = {
    workspaceId: seededData.workspace.id,
    userId: seededData.users.kris.id, // Use Kris as the eval user
    currentStreamId: seededData.channels.general.id, // Default to general channel
    scope: { type: "user" }, // Full access for evals
  }

  // Create real tools and wrap them to capture calls
  const realTools = createAriadneTools(pool, toolContext)
  const wrappedTools = wrapToolsForCapture(realTools, capturedCalls)

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
    throw new Error(`Ollama models not supported in Ariadne evals - use anthropic or openai provider`)
  }

  // Dynamic prompt
  const prompt = (state: typeof MessagesAnnotation.State, _config: RunnableConfig): BaseMessageLike[] => {
    const systemPrompt = isThinkingPartner ? THINKING_PARTNER_PROMPT : RETRIEVAL_PROMPT
    return [{ role: "system", content: systemPrompt }, ...state.messages]
  }

  const agent = createReactAgent({
    llm: model,
    tools: wrappedTools,
    prompt,
  })

  return agent as RunnableInterface<{ messages: BaseMessageLike[] }, Record<string, unknown>>
}

/**
 * Run a single eval case.
 */
async function runSingleCase(
  pool: Pool,
  seededData: SeededData,
  evalCase: AriadneEvalCase,
  modelString: string,
  langfuse: Langfuse | null,
  runId: string,
): Promise<AriadneEvalResult> {
  const capturedCalls: CapturedToolCall[] = []
  const agent = createEvalAgent(pool, seededData, evalCase, capturedCalls, modelString)
  const start = performance.now()

  let response = ""
  let allToolResults = ""

  try {
    const result = await agent.invoke({
      messages: [{ role: "user", content: evalCase.question }],
    })

    // Extract response and tool results from messages
    const messages = result.messages as Array<AIMessage | ToolMessage>
    for (const msg of messages) {
      if (msg instanceof ToolMessage || (msg as { type?: string }).type === "tool") {
        allToolResults += " " + (typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content))
      }
    }

    const lastMessage = messages[messages.length - 1]
    response = typeof lastMessage.content === "string" ? lastMessage.content : JSON.stringify(lastMessage.content)
  } catch (err) {
    response = `Error: ${err instanceof Error ? err.message : String(err)}`
  }

  const latencyMs = performance.now() - start

  // Evaluate tool calls
  const toolEval = evaluateToolCalls(capturedCalls, evalCase)

  // Evaluate retrieval quality (did we find the expected sources?)
  const retrievalEval = evaluateRetrieval(allToolResults + " " + response, evalCase)

  // Evaluate response quality
  const responseQualityScore = evaluateResponseQuality(response, evalCase)

  // Calculate overall score (weighted average)
  // Give more weight to retrieval since that's the key metric for real tools
  const overallScore =
    toolEval.toolSelectionScore * 0.25 +
    toolEval.toolArgumentScore * 0.15 +
    retrievalEval.score * 0.35 +
    responseQualityScore * 0.25

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
        expectedSources: evalCase.expectedSourceIds,
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
      name: "retrieval",
      value: retrievalEval.score,
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
    retrievalScore: retrievalEval.score,
    expectedSources: retrievalEval.expectedSources,
    foundSources: retrievalEval.foundSources,
    missingSources: retrievalEval.missingSources,
    responseQualityScore,
    responseLength: response.length,
    latencyMs,
    overallScore,
  }
}

/**
 * Evaluate tool call accuracy.
 */
function evaluateToolCalls(
  captured: CapturedToolCall[],
  evalCase: AriadneEvalCase,
): {
  toolSelectionScore: number
  toolArgumentScore: number
  details: {
    expectedTools: string[]
    capturedTools: string[]
    missing: string[]
    extra: string[]
    argErrors: string[]
  }
} {
  const expected = evalCase.expectedTools
  const capturedNames = captured.map((c) => c.name)

  // Tool selection accuracy
  const expectedSet = new Set(expected.map((e) => e.tool))
  const capturedSet = new Set(capturedNames)

  const missing = [...expectedSet].filter((t) => !capturedSet.has(t))
  const extra = [...capturedSet].filter((t) => !expectedSet.has(t))

  // In strict order mode, check order matches
  let orderCorrect = true
  if (evalCase.strictOrder && expected.length > 0) {
    const capturedFiltered = capturedNames.filter((n) => expectedSet.has(n))
    const expectedOrder = expected.map((e) => e.tool)
    orderCorrect = JSON.stringify(capturedFiltered) === JSON.stringify(expectedOrder)
  }

  // Tool selection score: penalize missing and extra tools
  const toolSelectionScore =
    expected.length === 0
      ? captured.length === 0
        ? 1.0
        : 0.0 // No tools expected: perfect if none called
      : Math.max(0, 1 - (missing.length + extra.length * 0.5) / expected.length) * (orderCorrect ? 1 : 0.8)

  // Argument accuracy
  const argErrors: string[] = []

  for (const exp of expected) {
    const capturedCall = captured.find((c) => c.name === exp.tool)
    if (!capturedCall) continue

    // Check required args
    if (exp.requiredArgs) {
      for (const arg of exp.requiredArgs) {
        const value = getNestedValue(capturedCall.args, arg)
        if (value === undefined) {
          argErrors.push(`${exp.tool}: missing required arg '${arg}'`)
        }
      }
    }

    // Check arg matchers
    if (exp.argMatchers) {
      for (const [arg, matcher] of Object.entries(exp.argMatchers)) {
        const value = getNestedValue(capturedCall.args, arg)
        if (value === undefined) {
          argErrors.push(`${exp.tool}: missing arg '${arg}' for matcher`)
          continue
        }

        const valueStr = Array.isArray(value) ? value.join(",") : String(value)
        const regex = matcher instanceof RegExp ? matcher : new RegExp(matcher, "i")

        if (!regex.test(valueStr)) {
          argErrors.push(`${exp.tool}: arg '${arg}' value '${valueStr}' doesn't match ${matcher}`)
        }
      }
    }
  }

  // Argument score
  const expectedWithArgs = expected.filter((e) => e.requiredArgs || e.argMatchers).length
  const toolArgumentScore = expectedWithArgs === 0 ? 1.0 : Math.max(0, 1 - argErrors.length / expectedWithArgs)

  return {
    toolSelectionScore,
    toolArgumentScore,
    details: {
      expectedTools: expected.map((e) => e.tool),
      capturedTools: capturedNames,
      missing,
      extra,
      argErrors,
    },
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".")
  let current: unknown = obj

  for (const part of parts) {
    if (current === undefined || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Evaluate retrieval quality - did the agent find the expected sources?
 */
function evaluateRetrieval(
  fullOutput: string,
  evalCase: AriadneEvalCase,
): {
  score: number
  expectedSources: string[]
  foundSources: string[]
  missingSources: string[]
} {
  const expectedSources = evalCase.expectedSourceIds || []
  if (expectedSources.length === 0) {
    return { score: 1.0, expectedSources: [], foundSources: [], missingSources: [] }
  }

  const foundSources: string[] = []
  const missingSources: string[] = []

  for (const sourceId of expectedSources) {
    if (fullOutput.includes(sourceId)) {
      foundSources.push(sourceId)
    } else {
      missingSources.push(sourceId)
    }
  }

  const score = foundSources.length / expectedSources.length

  return { score, expectedSources, foundSources, missingSources }
}

/**
 * Evaluate response quality using keyword matching.
 * Returns a score from 0 to 1.
 */
function evaluateResponseQuality(response: string, evalCase: AriadneEvalCase): number {
  if (!evalCase.responseKeywords || evalCase.responseKeywords.length === 0) {
    return 1.0 // No keywords to check
  }

  const normalizedResponse = response.toLowerCase()
  let matches = 0

  for (const keyword of evalCase.responseKeywords) {
    if (normalizedResponse.includes(keyword.toLowerCase())) {
      matches++
    }
  }

  return matches / evalCase.responseKeywords.length
}

/**
 * Run the full Ariadne eval suite.
 */
export async function runAriadneEval(config: AriadneEvalRunnerConfig): Promise<AriadneEvalRunSummary> {
  const runId = `ariadne_eval_${Date.now()}_${config.model.replace(/[:.]/g, "_")}`
  const startedAt = new Date()

  console.log(`\n🧵 Ariadne Agent Eval (Real Tools)`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`Run ID: ${runId}`)
  console.log(`Model: ${config.model}`)

  // Set up test database and seed data
  console.log(`\n📦 Setting up test database...`)
  const { pool, data: seededData } = await setupAriadneEval()
  console.log(`   ✓ Seeded ${seededData.messages.size} messages, ${seededData.memos.size} memos`)

  // Build dataset
  const dataset = buildAriadneDataset()
  const stats = getAriadneDatasetStats(dataset)

  console.log(`\n📊 Dataset: ${dataset.name} v${dataset.version}`)
  console.log(`   Total Cases: ${stats.total}`)
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
      const result = await runSingleCase(pool, seededData, evalCase, config.model, langfuse, runId)
      results.push(result)

      if (config.verbose) {
        const status = result.overallScore >= 0.7 ? "✅" : result.overallScore >= 0.4 ? "⚠️" : "❌"
        console.log(
          `  ${status} overall=${(result.overallScore * 100).toFixed(0)}% ` +
            `tools=${(result.toolSelectionScore * 100).toFixed(0)}% ` +
            `retrieval=${(result.retrievalScore * 100).toFixed(0)}% ` +
            `(${result.capturedTools.join(", ") || "none"})`,
        )
        if (result.missingSources.length > 0) {
          console.log(`     Missing sources: ${result.missingSources.join(", ")}`)
        }
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

  // Clean up
  console.log(`\n🧹 Cleaning up test data...`)
  await cleanupAriadneEvalData(pool)
  await closeTestPool()

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
  const avgRetrievalScore = results.reduce((sum, r) => sum + r.retrievalScore, 0) / results.length
  const avgResponseQualityScore = results.reduce((sum, r) => sum + r.responseQualityScore, 0) / results.length
  const avgOverallScore = results.reduce((sum, r) => sum + r.overallScore, 0) / results.length
  const avgLatencyMs = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length

  // By scenario
  const byScenario: Record<
    string,
    { total: number; avgToolSelectionScore: number; avgRetrievalScore: number; avgOverallScore: number }
  > = {}

  for (const r of results) {
    if (!byScenario[r.scenario]) {
      byScenario[r.scenario] = { total: 0, avgToolSelectionScore: 0, avgRetrievalScore: 0, avgOverallScore: 0 }
    }
    byScenario[r.scenario].total++
    byScenario[r.scenario].avgToolSelectionScore += r.toolSelectionScore
    byScenario[r.scenario].avgRetrievalScore += r.retrievalScore
    byScenario[r.scenario].avgOverallScore += r.overallScore
  }

  for (const scenario of Object.keys(byScenario)) {
    byScenario[scenario].avgToolSelectionScore /= byScenario[scenario].total
    byScenario[scenario].avgRetrievalScore /= byScenario[scenario].total
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
    avgRetrievalScore,
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
    name: "avg_retrieval",
    value: summary.avgRetrievalScore,
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
  console.log(`Retrieval Score: ${(summary.avgRetrievalScore * 100).toFixed(1)}%`)
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
