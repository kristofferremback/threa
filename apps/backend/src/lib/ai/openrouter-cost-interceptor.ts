/**
 * OpenRouter Cost Interceptor
 *
 * Captures cost and token usage from OpenRouter API responses for LangChain calls.
 * Uses AsyncLocalStorage to track costs per-request in a thread-safe manner.
 */

import { AsyncLocalStorage } from "node:async_hooks"
import { logger } from "../logger"

export interface CapturedUsage {
  cost: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

interface CostStore {
  cost: number
  tokens: {
    prompt: number
    completion: number
    total: number
  }
}

const costStorage = new AsyncLocalStorage<CostStore>()

type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Create a fetch wrapper that captures OpenRouter cost from responses.
 * This can be passed to LangChain's ChatOpenAI configuration.
 */
export function createCostCapturingFetch(originalFetch: FetchFunction = fetch): FetchFunction {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init)

    // Only process OpenRouter responses
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!url.includes("openrouter.ai")) {
      return response
    }

    // Check if we're in a tracking context
    const store = costStorage.getStore()
    if (!store) {
      return response
    }

    try {
      // Clone response to read body without consuming it
      const cloned = response.clone()
      const text = await cloned.text()

      // Handle streaming responses (SSE format)
      if (text.startsWith("data:")) {
        // For streaming, we need to find the final chunk with usage info
        const lines = text.split("\n")
        for (const line of lines.reverse()) {
          if (line.startsWith("data:") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(5).trim())
              if (data.usage) {
                store.cost += data.usage.cost ?? 0
                store.tokens.prompt += data.usage.prompt_tokens ?? 0
                store.tokens.completion += data.usage.completion_tokens ?? 0
                store.tokens.total += data.usage.total_tokens ?? 0
                break
              }
            } catch {
              // Not valid JSON, skip
            }
          }
        }
      } else {
        // Non-streaming response
        const body = JSON.parse(text)
        if (body.usage) {
          store.cost += body.usage.cost ?? 0
          store.tokens.prompt += body.usage.prompt_tokens ?? 0
          store.tokens.completion += body.usage.completion_tokens ?? 0
          store.tokens.total += body.usage.total_tokens ?? 0
        }
      }
    } catch (error) {
      logger.warn({ error }, "Failed to extract cost from OpenRouter response")
    }

    return response
  }
}

/**
 * Run a function with cost tracking enabled.
 * Returns the result along with captured usage data.
 *
 * @example
 * const { result, usage } = await withCostTracking(async () => {
 *   return compiledGraph.invoke(input, config)
 * })
 * console.log(`Cost: $${usage.cost}`)
 */
export async function withCostTracking<T>(fn: () => Promise<T>): Promise<{ result: T; usage: CapturedUsage }> {
  const store: CostStore = {
    cost: 0,
    tokens: { prompt: 0, completion: 0, total: 0 },
  }

  const result = await costStorage.run(store, fn)

  return {
    result,
    usage: {
      cost: store.cost,
      promptTokens: store.tokens.prompt,
      completionTokens: store.tokens.completion,
      totalTokens: store.tokens.total,
    },
  }
}

/**
 * Get the current cost tracking store, if in a tracking context.
 * Useful for checking accumulated costs mid-execution.
 */
export function getCurrentUsage(): CapturedUsage | null {
  const store = costStorage.getStore()
  if (!store) return null

  return {
    cost: store.cost,
    promptTokens: store.tokens.prompt,
    completionTokens: store.tokens.completion,
    totalTokens: store.tokens.total,
  }
}
