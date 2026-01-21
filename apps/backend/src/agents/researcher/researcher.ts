import type { Pool, PoolClient } from "pg"
import { z } from "zod"
import type { RunnableConfig } from "@langchain/core/runnables"
import type { ChatOpenAI } from "@langchain/openai"
import { withClient } from "../../db"
import type { AI } from "../../lib/ai/ai"
import type { EmbeddingServiceLike } from "../../services/embedding-service"
import type { Message } from "../../repositories/message-repository"
import { MemoRepository, type MemoSearchResult } from "../../repositories/memo-repository"
import { SearchRepository } from "../../repositories/search-repository"
import { StreamRepository } from "../../repositories/stream-repository"
import { ResearcherCache, type ResearcherCachedResult } from "./cache"
import { computeAgentAccessSpec, type AgentAccessSpec } from "./access-spec"
import {
  formatRetrievedContext,
  enrichMessageSearchResults,
  type EnrichedMemoResult,
  type EnrichedMessageResult,
} from "./context-formatter"
import { logger } from "../../lib/logger"

// Model for researcher decisions - use fast model for structured output
const RESEARCHER_MODEL = "openrouter:openai/gpt-5-mini"

// Maximum iterations for additional queries
const MAX_ITERATIONS = 5

// Maximum number of memos/messages to retrieve per search
const MAX_RESULTS_PER_SEARCH = 5

/**
 * Source item for citation - extended to support workspace sources.
 */
export interface WorkspaceSourceItem {
  type: "web" | "workspace"
  title: string
  url: string
  snippet?: string
}

/**
 * Result from running the researcher.
 */
export interface ResearcherResult {
  /** Formatted context to inject into system prompt */
  retrievedContext: string | null
  /** Sources for citation in the final message */
  sources: WorkspaceSourceItem[]
  /** Whether the researcher decided to search */
  shouldSearch: boolean
  /** Memos found (for debugging/logging) */
  memos: EnrichedMemoResult[]
  /** Messages found (for debugging/logging) */
  messages: EnrichedMessageResult[]
}

/**
 * Input for running the researcher.
 */
export interface ResearcherInput {
  workspaceId: string
  streamId: string
  triggerMessage: Message
  conversationHistory: Message[]
  invokingUserId: string
  /** For DMs: all participant user IDs */
  dmParticipantIds?: string[]
  /** LangChain config for trace context propagation */
  langchainConfig?: RunnableConfig
}

/**
 * Dependencies for the Researcher.
 */
export interface ResearcherDeps {
  pool: Pool
  ai: AI
  embeddingService: EmbeddingServiceLike
}

/**
 * Get a LangChain model configured for the researcher's lightweight decision calls.
 */
function getResearcherModel(ai: AI): ChatOpenAI {
  return ai.getLangChainModel(RESEARCHER_MODEL)
}

// Schema for combined decision + queries (single LLM call)
const decisionWithQueriesSchema = z.object({
  needsSearch: z.boolean(),
  reasoning: z.string(),
  queries: z
    .array(
      z.object({
        target: z.enum(["memos", "messages"]),
        type: z.enum(["semantic", "exact"]),
        query: z.string(),
      })
    )
    .nullable()
    .describe("Search queries to execute if needsSearch is true, null otherwise"),
})

// Schema for evaluation after seeing results
const evaluationSchema = z.object({
  sufficient: z.boolean(),
  additionalQueries: z
    .array(
      z.object({
        target: z.enum(["memos", "messages"]),
        type: z.enum(["semantic", "exact"]),
        query: z.string(),
      })
    )
    .nullable(),
  reasoning: z.string(),
})

type SearchQuery = NonNullable<z.infer<typeof decisionWithQueriesSchema>["queries"]>[number]

const SYSTEM_PROMPT = `You analyze user messages to decide if workspace knowledge retrieval would help answer them.

You work in steps:
1. First, decide if search is needed at all
2. If yes, generate search queries
3. After seeing results, evaluate if they're sufficient or if more searches are needed

Guidelines:
- Start with memo search (summarized knowledge) when looking for decisions, context, or discussions
- Use message search when you need specific quotes, recent activity, or exact terms
- Use "semantic" search for concepts, topics, intent
- Use "exact" search for error messages, IDs, specific phrases, quoted text
- Generate 1-3 focused queries per step

Skip search entirely when:
- Simple greetings, thanks, or acknowledgments
- Questions about external/current topics (web search is more appropriate)
- The conversation history already contains the answer
- User is sharing information, not asking a question
- The question is about the current conversation itself`

/**
 * Researcher that retrieves relevant workspace knowledge before the main agent responds.
 *
 * Implements the GAM (General Agentic Memory) pattern:
 * - Lightweight decision about whether to search
 * - Targeted retrieval from memos (summarized) and messages (raw)
 * - Formatted context injection into system prompt
 */
export class Researcher {
  constructor(private readonly deps: ResearcherDeps) {}

  /**
   * Run the researcher for a trigger message.
   * Returns cached result if available, otherwise runs the full decision loop.
   */
  /**
   * Research entry point.
   *
   * IMPORTANT: Uses three-phase pattern (INV-41) to avoid holding database
   * connections during AI calls (which can take 10-30+ seconds total):
   *
   * Phase 1: Fetch all setup data with withClient (~100-200ms)
   * Phase 2: AI decision loop with no connection held (10-30+ seconds)
   *          Uses pool.query for individual DB operations (fast)
   * Phase 3: Save cache result with withClient (~50ms)
   */
  async research(input: ResearcherInput): Promise<ResearcherResult> {
    const { pool } = this.deps
    const { workspaceId, streamId, triggerMessage, invokingUserId, dmParticipantIds } = input

    // Phase 1: Fetch all setup data with withClient (no transaction, fast reads ~100-200ms)
    const fetchedData = await withClient(pool, async (client) => {
      // Check cache first
      const cached = await ResearcherCache.findByMessage(client, triggerMessage.id)
      if (cached) {
        return { cached: cached.result, stream: null, accessSpec: null, accessibleStreamIds: null }
      }

      // Compute access spec for this invocation context
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        return { cached: null, stream: null, accessSpec: null, accessibleStreamIds: null }
      }

      const accessSpec = await computeAgentAccessSpec(client, {
        stream,
        invokingUserId,
      })

      // For DMs, we need to pass participant IDs
      const effectiveAccessSpec: AgentAccessSpec =
        stream.type === "dm" && dmParticipantIds ? { type: "user_union", userIds: dmParticipantIds } : accessSpec

      // Get accessible streams for searches
      const accessibleStreamIds = await SearchRepository.getAccessibleStreamsForAgent(
        client,
        effectiveAccessSpec,
        workspaceId
      )

      return { cached: null, stream, accessSpec: effectiveAccessSpec, accessibleStreamIds }
    })

    // Return cached result if available
    if (fetchedData.cached) {
      logger.debug({ messageId: triggerMessage.id }, "Researcher cache hit")
      return this.cachedResultToResearcherResult(fetchedData.cached)
    }

    // Return empty if stream not found
    if (!fetchedData.stream || !fetchedData.accessSpec || !fetchedData.accessibleStreamIds) {
      logger.warn({ streamId }, "Stream not found for researcher")
      return this.emptyResult()
    }

    logger.info(
      {
        messageId: triggerMessage.id,
        accessSpecType: fetchedData.accessSpec.type,
        accessibleStreamCount: fetchedData.accessibleStreamIds.length,
        accessibleStreamIds: fetchedData.accessibleStreamIds.slice(0, 10),
      },
      "Researcher computed access"
    )

    if (fetchedData.accessibleStreamIds.length === 0) {
      logger.warn(
        { messageId: triggerMessage.id, accessSpec: fetchedData.accessSpec },
        "No accessible streams for researcher"
      )
      return this.emptyResult()
    }

    // Phase 2: Run decision loop (AI calls + DB queries, no connection held, 10-30+ seconds)
    // Uses pool.query for individual DB operations (fast, ~10-50ms each)
    const result = await this.runDecisionLoop(pool, input, fetchedData.accessSpec, fetchedData.accessibleStreamIds)

    // Phase 3: Save cache result (single query, INV-30)
    await ResearcherCache.set(pool, {
      workspaceId,
      messageId: triggerMessage.id,
      streamId,
      accessSpec: fetchedData.accessSpec!,
      result: this.toResearcherCachedResult(result),
    })

    return result
  }

  /**
   * Main decision loop: decide → search → evaluate → maybe search more.
   *
   * Uses pool.query for individual DB operations instead of holding a connection
   * through the entire loop (which includes AI calls taking 10-30+ seconds).
   */
  private async runDecisionLoop(
    pool: Pool,
    input: ResearcherInput,
    accessSpec: AgentAccessSpec,
    accessibleStreamIds: string[]
  ): Promise<ResearcherResult> {
    const { ai, embeddingService } = this.deps
    const { workspaceId, triggerMessage, conversationHistory, langchainConfig, invokingUserId } = input

    // Get LangChain model for structured output calls
    const model = getResearcherModel(ai)

    // Step 1: Decide if search is needed AND generate queries in one call (AI, no DB)
    const contextSummary = this.buildContextSummary(triggerMessage, conversationHistory)
    const decision = await this.decideAndGenerateQueries(model, contextSummary, langchainConfig)

    if (!decision.needsSearch || !decision.queries?.length) {
      logger.debug(
        { messageId: triggerMessage.id, reasoning: decision.reasoning },
        "Researcher decided no search needed"
      )
      return this.emptyResult()
    }

    const initialQueries = decision.queries

    // Execute searches and collect results
    let allMemos: EnrichedMemoResult[] = []
    let allMessages: EnrichedMessageResult[] = []
    const searchesPerformed: ResearcherCachedResult["searchesPerformed"] = []

    // Execute initial queries (uses pool.query for DB operations, fast ~50-100ms)
    const initialResults = await this.executeQueries(
      pool,
      initialQueries,
      workspaceId,
      accessibleStreamIds,
      embeddingService,
      invokingUserId
    )
    allMemos = [...allMemos, ...initialResults.memos]
    allMessages = [...allMessages, ...initialResults.messages]
    searchesPerformed.push(...initialResults.searches)

    // Step 3: Iterative evaluation - let the researcher decide if more searches are needed
    let iteration = 0
    while (iteration < MAX_ITERATIONS) {
      // AI evaluation (no DB, 1-5 seconds)
      const evaluation = await this.evaluateResults(model, contextSummary, allMemos, allMessages, langchainConfig)

      if (evaluation.sufficient || !evaluation.additionalQueries?.length) {
        logger.debug(
          { messageId: triggerMessage.id, iterations: iteration + 1, reasoning: evaluation.reasoning },
          "Researcher found sufficient results"
        )
        break
      }

      // Execute additional queries (uses pool.query, fast ~50-100ms)
      const additionalResults = await this.executeQueries(
        pool,
        evaluation.additionalQueries,
        workspaceId,
        accessibleStreamIds,
        embeddingService,
        invokingUserId
      )

      // Deduplicate results
      const existingMemoIds = new Set(allMemos.map((m) => m.memo.id))
      const existingMessageIds = new Set(allMessages.map((m) => m.id))

      for (const memo of additionalResults.memos) {
        if (!existingMemoIds.has(memo.memo.id)) {
          allMemos.push(memo)
          existingMemoIds.add(memo.memo.id)
        }
      }

      for (const msg of additionalResults.messages) {
        if (!existingMessageIds.has(msg.id)) {
          allMessages.push(msg)
          existingMessageIds.add(msg.id)
        }
      }

      searchesPerformed.push(...additionalResults.searches)
      iteration++
    }

    // Build sources for citation
    const sources = this.buildSources(allMemos, allMessages, workspaceId)

    // Format retrieved context for system prompt
    const retrievedContext = formatRetrievedContext(allMemos, allMessages)

    logger.info(
      {
        messageId: triggerMessage.id,
        memoCount: allMemos.length,
        messageCount: allMessages.length,
        searchCount: searchesPerformed.length,
      },
      "Researcher completed"
    )

    return {
      retrievedContext,
      sources,
      shouldSearch: true,
      memos: allMemos,
      messages: allMessages,
    }
  }

  /**
   * Combined decision + query generation in a single LLM call.
   * Saves one round-trip compared to separate decide + generateQueries calls.
   */
  private async decideAndGenerateQueries(
    model: ChatOpenAI,
    contextSummary: string,
    langchainConfig?: RunnableConfig
  ): Promise<z.infer<typeof decisionWithQueriesSchema>> {
    try {
      const structuredModel = model.withStructuredOutput(decisionWithQueriesSchema, {
        name: "researcher-decide-and-query",
      })

      const result = await structuredModel.invoke(
        [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Analyze this message and decide if workspace search would help answer it.

${contextSummary}

If search IS needed:
- Generate 1-3 focused search queries
- Start with memo search for summarized knowledge (decisions, context, discussions)
- Use message search for specific quotes, recent activity, or exact terms
- Use "semantic" for concepts/topics, "exact" for error messages, IDs, or quoted text

If search is NOT needed, set needsSearch to false and queries to null.`,
          },
        ],
        langchainConfig
      )

      return result
    } catch (error) {
      logger.warn({ error }, "Researcher decision failed, defaulting to no search")
      return { needsSearch: false, reasoning: "Decision failed", queries: null }
    }
  }

  /**
   * Evaluate if current results are sufficient.
   * Uses LangChain's structured output for proper trace integration.
   */
  private async evaluateResults(
    model: ChatOpenAI,
    contextSummary: string,
    memos: EnrichedMemoResult[],
    messages: EnrichedMessageResult[],
    langchainConfig?: RunnableConfig
  ): Promise<z.infer<typeof evaluationSchema>> {
    const resultsText = this.formatResultsForEvaluation(memos, messages)

    try {
      const structuredModel = model.withStructuredOutput(evaluationSchema, { name: "researcher-evaluate" })

      const result = await structuredModel.invoke(
        [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Evaluate if these search results are sufficient to help answer the user's question.

${contextSummary}

## Current Results

${resultsText || "No results found yet."}

If results are insufficient, suggest additional queries. Otherwise, mark as sufficient.`,
          },
        ],
        langchainConfig
      )

      return result
    } catch (error) {
      logger.warn({ error }, "Researcher evaluation failed, treating as sufficient")
      return { sufficient: true, additionalQueries: null, reasoning: "Evaluation failed" }
    }
  }

  /**
   * Execute a set of search queries in parallel.
   * Uses pool.query for individual DB operations (fast, ~10-50ms each).
   */
  private async executeQueries(
    pool: Pool,
    queries: SearchQuery[],
    workspaceId: string,
    accessibleStreamIds: string[],
    embeddingService: EmbeddingServiceLike,
    invokingUserId: string
  ): Promise<{
    memos: EnrichedMemoResult[]
    messages: EnrichedMessageResult[]
    searches: ResearcherCachedResult["searchesPerformed"]
  }> {
    // Execute all queries in parallel
    const results = await Promise.all(
      queries.map(async (query) => {
        if (query.target === "memos") {
          const memoResults = await this.searchMemos(pool, query, workspaceId, accessibleStreamIds, embeddingService)
          return {
            type: "memos" as const,
            memos: memoResults,
            messages: [] as EnrichedMessageResult[],
            search: {
              target: "memos" as const,
              type: query.type,
              query: query.query,
              resultCount: memoResults.length,
            },
          }
        } else {
          const messageResults = await this.searchMessages(pool, query, workspaceId, accessibleStreamIds)
          return {
            type: "messages" as const,
            memos: [] as EnrichedMemoResult[],
            messages: messageResults,
            search: {
              target: "messages" as const,
              type: query.type,
              query: query.query,
              resultCount: messageResults.length,
            },
          }
        }
      })
    )

    // Aggregate results
    const memos: EnrichedMemoResult[] = []
    const messages: EnrichedMessageResult[] = []
    const searches: ResearcherCachedResult["searchesPerformed"] = []

    for (const result of results) {
      memos.push(...result.memos)
      messages.push(...result.messages)
      searches.push(result.search)
    }

    return { memos, messages, searches }
  }

  /**
   * Search memos with a query.
   * Uses withClient for DB operations (fast, ~10-50ms).
   */
  private async searchMemos(
    pool: Pool,
    query: SearchQuery,
    workspaceId: string,
    accessibleStreamIds: string[],
    embeddingService: EmbeddingServiceLike
  ): Promise<EnrichedMemoResult[]> {
    // For semantic search, generate embedding (AI, no DB, ~200-500ms)
    if (query.type === "semantic") {
      try {
        const embedding = await embeddingService.embed(query.query)
        // DB search (single query, INV-30)
        const results = await MemoRepository.semanticSearch(pool, {
          workspaceId,
          embedding,
          streamIds: accessibleStreamIds,
          limit: MAX_RESULTS_PER_SEARCH,
        })

        return results.map((r) => ({
          memo: r.memo,
          distance: r.distance,
          sourceStream: r.sourceStream,
        }))
      } catch (error) {
        logger.warn({ error, query: query.query }, "Memo semantic search failed")
        return []
      }
    }

    // For exact search, use full-text search (single query, INV-30)
    try {
      const results = await MemoRepository.fullTextSearch(pool, {
        workspaceId,
        query: query.query,
        streamIds: accessibleStreamIds,
        limit: MAX_RESULTS_PER_SEARCH,
      })

      return results.map((r) => ({
        memo: r.memo,
        distance: r.distance,
        sourceStream: r.sourceStream,
      }))
    } catch (error) {
      logger.warn({ error, query: query.query }, "Memo full-text search failed")
      return []
    }
  }

  /**
   * Search messages with a query and enrich results.
   * Uses withClient for DB operations (fast, ~10-50ms).
   */
  private async searchMessages(
    pool: Pool,
    query: SearchQuery,
    workspaceId: string,
    accessibleStreamIds: string[]
  ): Promise<EnrichedMessageResult[]> {
    const { embeddingService } = this.deps

    // Build query string - for exact, wrap in quotes
    const searchQuery = query.type === "exact" ? `"${query.query}"` : query.query

    try {
      // Generate embedding for semantic search (AI, no DB, ~200-500ms)
      let embedding: number[] = []
      if (searchQuery.trim()) {
        try {
          embedding = await embeddingService.embed(searchQuery)
        } catch (error) {
          logger.warn({ error }, "Failed to generate embedding, falling back to keyword-only search")
        }
      }

      // DB search (fast, ~10-50ms)
      return await withClient(pool, async (client) => {
        const filters = {}
        let results

        if (!searchQuery.trim()) {
          // No search terms - return recent messages
          results = await SearchRepository.fullTextSearch(client, {
            query: "",
            streamIds: accessibleStreamIds,
            filters,
            limit: MAX_RESULTS_PER_SEARCH,
          })
        } else if (embedding.length === 0) {
          // No embedding - keyword-only search
          results = await SearchRepository.fullTextSearch(client, {
            query: searchQuery,
            streamIds: accessibleStreamIds,
            filters,
            limit: MAX_RESULTS_PER_SEARCH,
          })
        } else {
          // Hybrid search with RRF ranking
          results = await SearchRepository.hybridSearch(client, {
            query: searchQuery,
            embedding,
            streamIds: accessibleStreamIds,
            filters,
            limit: MAX_RESULTS_PER_SEARCH,
          })
        }

        // Enrich results with author names and stream names
        return enrichMessageSearchResults(client, results)
      })
    } catch (error) {
      logger.warn({ error, query: query.query }, "Message search failed")
      return []
    }
  }

  /**
   * Build sources for citation.
   */
  private buildSources(
    memos: EnrichedMemoResult[],
    messages: EnrichedMessageResult[],
    workspaceId: string
  ): WorkspaceSourceItem[] {
    const sources: WorkspaceSourceItem[] = []

    for (const { memo, sourceStream } of memos) {
      sources.push({
        type: "workspace",
        title: memo.title,
        url: `/w/${workspaceId}/memos/${memo.id}`,
        snippet: memo.abstract.slice(0, 200),
      })
    }

    for (const msg of messages) {
      sources.push({
        type: "workspace",
        title: `${msg.authorName} in ${msg.streamName}`,
        url: `/w/${workspaceId}/streams/${msg.streamId}?message=${msg.id}`,
        snippet: msg.content.slice(0, 200),
      })
    }

    return sources
  }

  /**
   * Build context summary for the researcher.
   */
  private buildContextSummary(triggerMessage: Message, conversationHistory: Message[]): string {
    const recentMessages = conversationHistory.slice(-5)
    const historyText = recentMessages.map((m) => `${m.authorType}: ${m.contentMarkdown}`).join("\n")

    return `## Current Message
${triggerMessage.contentMarkdown}

## Recent Conversation
${historyText || "No recent messages."}`
  }

  /**
   * Format results for evaluation prompt.
   */
  private formatResultsForEvaluation(memos: EnrichedMemoResult[], messages: EnrichedMessageResult[]): string {
    const parts: string[] = []

    if (memos.length > 0) {
      parts.push("### Memos Found")
      for (const { memo } of memos) {
        parts.push(`- **${memo.title}**: ${memo.abstract}`)
      }
    }

    if (messages.length > 0) {
      parts.push("### Messages Found")
      for (const msg of messages) {
        parts.push(`- ${msg.authorName} in ${msg.streamName}: "${msg.content}"`)
      }
    }

    return parts.join("\n\n")
  }

  /**
   * Convert cached result back to ResearcherResult.
   */
  private cachedResultToResearcherResult(cached: ResearcherCachedResult): ResearcherResult {
    return {
      retrievedContext: cached.retrievedContext,
      sources: cached.sources,
      shouldSearch: cached.shouldSearch,
      memos: [], // We don't cache the full enriched results
      messages: [],
    }
  }

  /**
   * Convert ResearcherResult to cacheable format.
   */
  private toResearcherCachedResult(result: ResearcherResult): ResearcherCachedResult {
    return {
      shouldSearch: result.shouldSearch,
      retrievedContext: result.retrievedContext,
      sources: result.sources,
      searchesPerformed: [], // Could track this if needed
    }
  }

  /**
   * Empty result when no search is performed.
   */
  private emptyResult(): ResearcherResult {
    return {
      retrievedContext: null,
      sources: [],
      shouldSearch: false,
      memos: [],
      messages: [],
    }
  }
}
