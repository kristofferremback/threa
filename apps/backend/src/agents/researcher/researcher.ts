import type { Pool, PoolClient } from "pg"
import { z } from "zod"
import { withClient } from "../../db"
import type { AI } from "../../lib/ai/ai"
import type { EmbeddingServiceLike } from "../../services/embedding-service"
import type { SearchService } from "../../services/search-service"
import type { Message } from "../../repositories/message-repository"
import { MemoRepository, type MemoSearchResult } from "../../repositories/memo-repository"
import { SearchRepository } from "../../repositories/search-repository"
import { StreamRepository } from "../../repositories/stream-repository"
import { UserRepository } from "../../repositories/user-repository"
import { PersonaRepository } from "../../repositories/persona-repository"
import { ResearcherCache, type ResearcherCachedResult } from "./cache"
import { computeAgentAccessSpec, type AgentAccessSpec } from "./access-spec"
import { formatRetrievedContext, type EnrichedMemoResult, type EnrichedMessageResult } from "./context-formatter"
import { logger } from "../../lib/logger"

// Model for researcher decisions
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
}

/**
 * Dependencies for the Researcher.
 */
export interface ResearcherDeps {
  pool: Pool
  ai: AI
  embeddingService: EmbeddingServiceLike
  searchService: SearchService
}

// Schema for researcher decision
const decisionSchema = z.object({
  needsSearch: z.boolean(),
  reasoning: z.string(),
})

// Schema for search queries
const searchQueriesSchema = z.object({
  queries: z.array(
    z.object({
      target: z.enum(["memos", "messages"]),
      type: z.enum(["semantic", "exact"]),
      query: z.string(),
    })
  ),
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

type SearchQuery = z.infer<typeof searchQueriesSchema>["queries"][number]

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
  async research(input: ResearcherInput): Promise<ResearcherResult> {
    const { pool } = this.deps
    const { workspaceId, streamId, triggerMessage, invokingUserId, dmParticipantIds } = input

    return withClient(pool, async (client) => {
      // Check cache first
      const cached = await ResearcherCache.findByMessage(client, triggerMessage.id)
      if (cached) {
        logger.debug({ messageId: triggerMessage.id }, "Researcher cache hit")
        return this.cachedResultToResearcherResult(cached.result)
      }

      // Compute access spec for this invocation context
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        logger.warn({ streamId }, "Stream not found for researcher")
        return this.emptyResult()
      }

      const accessSpec = await computeAgentAccessSpec(client, {
        stream,
        invokingUserId,
      })

      // For DMs, we need to pass participant IDs
      const effectiveAccessSpec: AgentAccessSpec =
        stream.type === "dm" && dmParticipantIds ? { type: "user_union", userIds: dmParticipantIds } : accessSpec

      // Run the decision loop
      const result = await this.runDecisionLoop(client, input, effectiveAccessSpec)

      // Cache the result
      await ResearcherCache.set(client, {
        workspaceId,
        messageId: triggerMessage.id,
        streamId,
        accessSpec: effectiveAccessSpec,
        result: this.toResearcherCachedResult(result),
      })

      return result
    })
  }

  /**
   * Main decision loop: decide → search → evaluate → maybe search more.
   */
  private async runDecisionLoop(
    client: PoolClient,
    input: ResearcherInput,
    accessSpec: AgentAccessSpec
  ): Promise<ResearcherResult> {
    const { ai, embeddingService } = this.deps
    const { workspaceId, triggerMessage, conversationHistory } = input

    // Step 1: Decide if search is needed
    const contextSummary = this.buildContextSummary(triggerMessage, conversationHistory)
    const decision = await this.decideSearch(contextSummary)

    if (!decision.needsSearch) {
      logger.debug(
        { messageId: triggerMessage.id, reasoning: decision.reasoning },
        "Researcher decided no search needed"
      )
      return this.emptyResult()
    }

    // Get accessible streams for searches
    const accessibleStreamIds = await SearchRepository.getAccessibleStreamsForAgent(client, accessSpec, workspaceId)

    if (accessibleStreamIds.length === 0) {
      logger.debug({ messageId: triggerMessage.id }, "No accessible streams for researcher")
      return this.emptyResult()
    }

    // Step 2: Generate initial queries
    const initialQueries = await this.generateQueries(contextSummary)

    // Execute searches and collect results
    let allMemos: EnrichedMemoResult[] = []
    let allMessages: EnrichedMessageResult[] = []
    const searchesPerformed: ResearcherCachedResult["searchesPerformed"] = []

    // Execute initial queries
    const initialResults = await this.executeQueries(
      client,
      initialQueries,
      workspaceId,
      accessibleStreamIds,
      embeddingService
    )
    allMemos = [...allMemos, ...initialResults.memos]
    allMessages = [...allMessages, ...initialResults.messages]
    searchesPerformed.push(...initialResults.searches)

    // Step 3: Iterative evaluation - let the researcher decide if more searches are needed
    let iteration = 0
    while (iteration < MAX_ITERATIONS) {
      const evaluation = await this.evaluateResults(contextSummary, allMemos, allMessages)

      if (evaluation.sufficient || !evaluation.additionalQueries?.length) {
        logger.debug(
          { messageId: triggerMessage.id, iterations: iteration + 1, reasoning: evaluation.reasoning },
          "Researcher found sufficient results"
        )
        break
      }

      // Execute additional queries
      const additionalResults = await this.executeQueries(
        client,
        evaluation.additionalQueries,
        workspaceId,
        accessibleStreamIds,
        embeddingService
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
   * Decide if search is needed for this message.
   */
  private async decideSearch(contextSummary: string): Promise<z.infer<typeof decisionSchema>> {
    const { ai } = this.deps

    try {
      const { value } = await ai.generateObject({
        model: RESEARCHER_MODEL,
        schema: decisionSchema,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Decide if workspace search would help answer this message.

${contextSummary}

Respond with whether search is needed and your reasoning.`,
          },
        ],
        maxTokens: 200,
        temperature: 0,
        telemetry: {
          functionId: "researcher-decide",
        },
      })

      return value
    } catch (error) {
      logger.warn({ error }, "Researcher decision failed, defaulting to no search")
      return { needsSearch: false, reasoning: "Decision failed" }
    }
  }

  /**
   * Generate search queries for the message.
   */
  private async generateQueries(contextSummary: string): Promise<SearchQuery[]> {
    const { ai } = this.deps

    try {
      const { value } = await ai.generateObject({
        model: RESEARCHER_MODEL,
        schema: searchQueriesSchema,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Generate 1-3 search queries to find relevant workspace knowledge.

${contextSummary}

Start with memo search for summarized knowledge. Use message search for specific quotes or recent activity.`,
          },
        ],
        maxTokens: 300,
        temperature: 0,
        telemetry: {
          functionId: "researcher-queries",
        },
      })

      return value.queries
    } catch (error) {
      logger.warn({ error }, "Researcher query generation failed")
      return []
    }
  }

  /**
   * Evaluate if current results are sufficient.
   */
  private async evaluateResults(
    contextSummary: string,
    memos: EnrichedMemoResult[],
    messages: EnrichedMessageResult[]
  ): Promise<z.infer<typeof evaluationSchema>> {
    const { ai } = this.deps

    const resultsText = this.formatResultsForEvaluation(memos, messages)

    try {
      const { value } = await ai.generateObject({
        model: RESEARCHER_MODEL,
        schema: evaluationSchema,
        messages: [
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
        maxTokens: 400,
        temperature: 0,
        telemetry: {
          functionId: "researcher-evaluate",
        },
      })

      return value
    } catch (error) {
      logger.warn({ error }, "Researcher evaluation failed, treating as sufficient")
      return { sufficient: true, additionalQueries: null, reasoning: "Evaluation failed" }
    }
  }

  /**
   * Execute a set of search queries.
   */
  private async executeQueries(
    client: PoolClient,
    queries: SearchQuery[],
    workspaceId: string,
    accessibleStreamIds: string[],
    embeddingService: EmbeddingServiceLike
  ): Promise<{
    memos: EnrichedMemoResult[]
    messages: EnrichedMessageResult[]
    searches: ResearcherCachedResult["searchesPerformed"]
  }> {
    const memos: EnrichedMemoResult[] = []
    const messages: EnrichedMessageResult[] = []
    const searches: ResearcherCachedResult["searchesPerformed"] = []

    for (const query of queries) {
      if (query.target === "memos") {
        const results = await this.searchMemos(client, query, workspaceId, accessibleStreamIds, embeddingService)
        memos.push(...results)
        searches.push({
          target: "memos",
          type: query.type,
          query: query.query,
          resultCount: results.length,
        })
      } else {
        const results = await this.searchMessages(client, query, workspaceId, accessibleStreamIds, embeddingService)
        messages.push(...results)
        searches.push({
          target: "messages",
          type: query.type,
          query: query.query,
          resultCount: results.length,
        })
      }
    }

    return { memos, messages, searches }
  }

  /**
   * Search memos with a query.
   */
  private async searchMemos(
    client: PoolClient,
    query: SearchQuery,
    workspaceId: string,
    accessibleStreamIds: string[],
    embeddingService: EmbeddingServiceLike
  ): Promise<EnrichedMemoResult[]> {
    // For semantic search, generate embedding
    if (query.type === "semantic") {
      try {
        const embedding = await embeddingService.embed(query.query)
        const results = await MemoRepository.semanticSearch(client, {
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

    // For exact search, we'd need full-text search on memos
    // For now, fall back to semantic with the exact phrase
    // TODO: Add full-text search to memo repository
    try {
      const embedding = await embeddingService.embed(query.query)
      const results = await MemoRepository.semanticSearch(client, {
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
      logger.warn({ error, query: query.query }, "Memo exact search failed")
      return []
    }
  }

  /**
   * Search messages with a query and enrich results.
   */
  private async searchMessages(
    client: PoolClient,
    query: SearchQuery,
    workspaceId: string,
    accessibleStreamIds: string[],
    embeddingService: EmbeddingServiceLike
  ): Promise<EnrichedMessageResult[]> {
    const { searchService } = this.deps

    // Build query string - for exact, wrap in quotes
    const searchQuery = query.type === "exact" ? `"${query.query}"` : query.query

    try {
      const results = await searchService.search({
        workspaceId,
        userId: "researcher", // Special case - access already validated via accessibleStreamIds
        query: searchQuery,
        filters: {
          streamIds: accessibleStreamIds,
        },
        limit: MAX_RESULTS_PER_SEARCH,
      })

      // Enrich results with author names and stream names
      return this.enrichMessageResults(client, results)
    } catch (error) {
      logger.warn({ error, query: query.query }, "Message search failed")
      return []
    }
  }

  /**
   * Enrich search results with author names and stream names.
   */
  private async enrichMessageResults(
    client: PoolClient,
    results: Array<{
      id: string
      streamId: string
      content: string
      authorId: string
      authorType: "user" | "persona"
      createdAt: Date
    }>
  ): Promise<EnrichedMessageResult[]> {
    if (results.length === 0) return []

    // Collect unique IDs for batch lookup
    const userIds = new Set<string>()
    const personaIds = new Set<string>()
    const streamIds = new Set<string>()

    for (const r of results) {
      if (r.authorType === "user") {
        userIds.add(r.authorId)
      } else {
        personaIds.add(r.authorId)
      }
      streamIds.add(r.streamId)
    }

    // Batch fetch users, personas, streams
    const [users, personas, streams] = await Promise.all([
      userIds.size > 0 ? UserRepository.findByIds(client, [...userIds]) : Promise.resolve([]),
      personaIds.size > 0 ? PersonaRepository.findByIds(client, [...personaIds]) : Promise.resolve([]),
      StreamRepository.findByIds(client, [...streamIds]),
    ])

    // Build lookup maps
    const userMap = new Map(users.map((u) => [u.id, u]))
    const personaMap = new Map(personas.map((p) => [p.id, p]))
    const streamMap = new Map(streams.map((s) => [s.id, s]))

    // Enrich results
    return results.map((r) => {
      const authorName =
        r.authorType === "user"
          ? (userMap.get(r.authorId)?.name ?? "Unknown")
          : (personaMap.get(r.authorId)?.name ?? "Assistant")

      const stream = streamMap.get(r.streamId)
      const streamName = stream?.displayName ?? stream?.slug ?? stream?.type ?? "Unknown"

      return {
        id: r.id,
        streamId: r.streamId,
        content: r.content,
        authorId: r.authorId,
        authorType: r.authorType,
        authorName,
        streamName,
        streamType: stream?.type ?? "unknown",
        createdAt: r.createdAt,
      }
    })
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
    const historyText = recentMessages.map((m) => `${m.authorType}: ${m.content.slice(0, 200)}`).join("\n")

    return `## Current Message
${triggerMessage.content}

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
        parts.push(`- **${memo.title}**: ${memo.abstract.slice(0, 150)}...`)
      }
    }

    if (messages.length > 0) {
      parts.push("### Messages Found")
      for (const msg of messages) {
        parts.push(`- ${msg.authorName} in ${msg.streamName}: "${msg.content.slice(0, 100)}..."`)
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
