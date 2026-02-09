import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import { logger } from "../../../lib/logger"

const WebSearchSchema = z.object({
  query: z.string().describe("The search query to find information on the web"),
})

export type WebSearchInput = z.infer<typeof WebSearchSchema>

export interface WebSearchResultItem {
  title: string
  url: string
  content: string
  score: number
}

export interface WebSearchResult {
  query: string
  results: WebSearchResultItem[]
  answer?: string
}

interface TavilySearchResponse {
  query: string
  answer?: string
  results: Array<{
    title: string
    url: string
    content: string
    score: number
  }>
  response_time: number
}

export interface CreateWebSearchToolParams {
  tavilyApiKey: string
  maxResults?: number
}

const FETCH_TIMEOUT_MS = 30000

// Patterns that might leak internal data in outbound search queries
const SENSITIVE_PATTERNS: RegExp[] = [
  /[A-Za-z0-9+/]{40,}={0,2}/g, // base64-like strings (40+ chars)
  /\b(sk|rk|pk|lf|wos)[-_][A-Za-z0-9_-]{10,}\b/g, // prefixed secrets
  /\b(stream|user|member|workspace|memo|attachment|session|persona)_[0-9A-HJKMNP-TV-Z]{26}\b/g, // internal ULIDs
]

function redactQuery(query: string): string {
  let redacted = query
  for (const pattern of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]")
  }
  return redacted
}

/**
 * Creates a web_search tool for the agent to search the web.
 *
 * Uses the Tavily API for search results optimized for LLMs.
 */
export function createWebSearchTool(params: CreateWebSearchToolParams) {
  const { tavilyApiKey, maxResults = 5 } = params

  return new DynamicStructuredTool({
    name: "web_search",
    description:
      "Search the web for current information. Returns relevant results with titles, URLs, and content snippets. Use this when you need up-to-date information or facts not in your training data.",
    schema: WebSearchSchema,
    func: async (input: WebSearchInput) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      const sanitizedQuery = redactQuery(input.query)

      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tavilyApiKey}`,
          },
          body: JSON.stringify({
            query: sanitizedQuery,
            max_results: maxResults,
            include_answer: true,
            search_depth: "basic",
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          logger.error({ status: response.status, error: errorText }, "Tavily API error")
          return JSON.stringify({
            error: `Search failed: ${response.status}`,
            query: input.query,
          })
        }

        const data = (await response.json()) as TavilySearchResponse

        const result: WebSearchResult = {
          query: data.query,
          results: data.results.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content,
            score: r.score,
          })),
          answer: data.answer,
        }

        logger.debug({ query: input.query, resultCount: result.results.length }, "Web search completed")

        return JSON.stringify(result)
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          logger.warn({ query: input.query }, "Web search timed out")
          return JSON.stringify({
            error: `Search timed out after ${FETCH_TIMEOUT_MS / 1000}s`,
            query: input.query,
          })
        }

        logger.error({ error, query: input.query }, "Web search failed")
        return JSON.stringify({
          error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          query: input.query,
        })
      } finally {
        clearTimeout(timeout)
      }
    },
  })
}
