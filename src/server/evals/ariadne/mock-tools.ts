/**
 * Mock tools for Ariadne evals.
 *
 * These tools capture tool calls and return mock responses,
 * allowing us to evaluate tool selection without hitting real services.
 */

import { tool } from "@langchain/core/tools"
import { z } from "zod"
import type { ToolName, AriadneEvalCase } from "./dataset"

export interface CapturedToolCall {
  name: ToolName
  args: Record<string, unknown>
  timestamp: number
}

/**
 * Create mock tools that capture calls and return predefined responses.
 */
export function createMockTools(evalCase: AriadneEvalCase, capturedCalls: CapturedToolCall[]) {
  const capture = (name: ToolName, args: Record<string, unknown>): string => {
    capturedCalls.push({
      name,
      args,
      timestamp: Date.now(),
    })
    return evalCase.mockResponses[name] || `No mock response for ${name}`
  }

  const searchMessages = tool(
    async (input) => capture("search_messages", input),
    {
      name: "search_messages",
      description:
        "Search past messages in the workspace. Use this to find relevant discussions, decisions, or information from conversations.",
      schema: z.object({
        query: z.string().describe("The search query text"),
        fromUsers: z.array(z.string()).optional().describe("Filter by message author names"),
        withUsers: z.array(z.string()).optional().describe("Filter by conversations with these users"),
        inChannels: z.array(z.string()).optional().describe("Filter by channel names"),
        streamTypes: z.array(z.string()).optional().describe("Filter by stream type"),
        limit: z.number().optional().describe("Maximum number of results"),
      }),
    },
  )

  const searchMemos = tool(
    async (input) => capture("search_memos", input),
    {
      name: "search_memos",
      description:
        "Search memos - lightweight pointers to valuable past conversations. Use this FIRST before searching all messages.",
      schema: z.object({
        query: z.string().describe("The search query for memos"),
        limit: z.number().optional().describe("Maximum number of results"),
      }),
    },
  )

  const getStreamContext = tool(
    async (input) => capture("get_stream_context", input),
    {
      name: "get_stream_context",
      description: "Get recent messages from a stream to understand the current conversation context.",
      schema: z.object({
        stream: z.string().optional().describe("The channel name or stream ID"),
        messageCount: z.number().optional().describe("Number of recent messages to retrieve"),
      }),
    },
  )

  const getThreadHistory = tool(
    async (input) => capture("get_thread_history", input),
    {
      name: "get_thread_history",
      description: "Get the full history of a thread, including the original message that started it.",
      schema: z.object({
        thread: z.string().describe("The thread ID or channel name to get history from"),
      }),
    },
  )

  const webSearch = tool(
    async (input) => capture("web_search", input),
    {
      name: "web_search",
      description: "Search the web for current information, documentation, or external resources.",
      schema: z.object({
        query: z.string().describe("The search query"),
        deepSearch: z.boolean().optional().describe("Use more thorough search"),
        maxResults: z.number().optional().describe("Maximum number of results"),
      }),
    },
  )

  const fetchUrl = tool(
    async (input) => capture("fetch_url", input),
    {
      name: "fetch_url",
      description: "Fetch and read the content of a URL.",
      schema: z.object({
        url: z.string().url().describe("The URL to fetch and read"),
      }),
    },
  )

  return [searchMemos, searchMessages, getStreamContext, getThreadHistory, webSearch, fetchUrl]
}

/**
 * Evaluate tool call accuracy.
 */
export function evaluateToolCalls(
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
  const extra = [...capturedSet].filter((t) => !expectedSet.has(t as ToolName))

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
 * Evaluate response quality using keyword matching.
 * Returns a score from 0 to 1.
 */
export function evaluateResponseQuality(response: string, evalCase: AriadneEvalCase): number {
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
