import type { Pool } from "pg"
import { z } from "zod"
import { withClient } from "../../../db"
import type { AI } from "../../../lib/ai/ai"
import type { ConfigResolver, ResearcherConfig } from "../../../lib/ai/config-resolver"
import { COMPONENT_PATHS } from "../../../lib/ai/config-resolver"
import type { EmbeddingServiceLike } from "../../memos"
import { MessageRepository, type Message } from "../../messaging"
import { MemoRepository } from "../../memos"
import { SearchRepository } from "../../search"
import { StreamRepository } from "../../streams"
import { AttachmentRepository } from "../../attachments"
import { ResearcherCache, type ResearcherCachedResult } from "./cache"
import { computeAgentAccessSpec, type AgentAccessSpec } from "./access-spec"
import {
  formatRetrievedContext,
  enrichMessageSearchResults,
  type EnrichedMemoResult,
  type EnrichedMessageResult,
  type EnrichedAttachmentResult,
} from "./context-formatter"
import { logger } from "../../../lib/logger"
import { SEMANTIC_DISTANCE_THRESHOLD } from "../../search"
import { RESEARCHER_MAX_ITERATIONS, RESEARCHER_MAX_RESULTS_PER_SEARCH, RESEARCHER_SYSTEM_PROMPT } from "./config"
import { appendBaselineQueries, buildBaselineQueries } from "./query/baseline-queries"

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
  /** Attachments found (for debugging/logging) */
  attachments?: EnrichedAttachmentResult[]
}

/**
 * Input for running the researcher.
 */
export interface ResearcherInput {
  workspaceId: string
  streamId: string
  triggerMessage: Message
  conversationHistory: Message[]
  invokingMemberId: string
  /** For DMs: all participant member IDs */
  dmParticipantIds?: string[]
}

/**
 * Dependencies for the Researcher.
 */
export interface ResearcherDeps {
  pool: Pool
  ai: AI
  configResolver: ConfigResolver
  embeddingService: EmbeddingServiceLike
}

// Schema for combined decision + queries (single LLM call)
const decisionWithQueriesSchema = z.object({
  needsSearch: z.boolean(),
  reasoning: z.string(),
  queries: z
    .array(
      z.object({
        target: z.enum(["memos", "messages", "attachments"]),
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
        target: z.enum(["memos", "messages", "attachments"]),
        type: z.enum(["semantic", "exact"]),
        query: z.string(),
      })
    )
    .nullable(),
  reasoning: z.string(),
})

type SearchQuery = NonNullable<z.infer<typeof decisionWithQueriesSchema>["queries"]>[number]

function mergeMemoResults(existing: EnrichedMemoResult[], incoming: EnrichedMemoResult[]): EnrichedMemoResult[] {
  const merged = [...existing]
  const seen = new Set(existing.map((memo) => memo.memo.id))

  for (const memo of incoming) {
    if (seen.has(memo.memo.id)) continue
    seen.add(memo.memo.id)
    merged.push(memo)
  }

  return merged
}

function mergeMessageResults(
  existing: EnrichedMessageResult[],
  incoming: EnrichedMessageResult[]
): EnrichedMessageResult[] {
  const merged = [...existing]
  const seen = new Set(existing.map((message) => message.id))

  for (const message of incoming) {
    if (seen.has(message.id)) continue
    seen.add(message.id)
    merged.push(message)
  }

  return merged
}

function mergeAttachmentResults(
  existing: EnrichedAttachmentResult[],
  incoming: EnrichedAttachmentResult[]
): EnrichedAttachmentResult[] {
  const merged = [...existing]
  const seen = new Set(existing.map((attachment) => attachment.id))

  for (const attachment of incoming) {
    if (seen.has(attachment.id)) continue
    seen.add(attachment.id)
    merged.push(attachment)
  }

  return merged
}

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
    const { workspaceId, streamId, triggerMessage, invokingMemberId, dmParticipantIds } = input

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
        invokingMemberId,
      })

      // For DMs, we need to pass participant IDs
      const effectiveAccessSpec: AgentAccessSpec =
        stream.type === "dm" && dmParticipantIds ? { type: "member_union", memberIds: dmParticipantIds } : accessSpec

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
    const { configResolver, embeddingService } = this.deps
    const { workspaceId, triggerMessage, conversationHistory, invokingMemberId } = input

    // Resolve config for researcher
    const config = (await configResolver.resolve(COMPONENT_PATHS.COMPANION_RESEARCHER)) as ResearcherConfig

    const contextSummary = this.buildContextSummary(triggerMessage, conversationHistory)
    const maxIterations = config.maxIterations ?? RESEARCHER_MAX_ITERATIONS
    const messageId = triggerMessage.id
    const triggerMessageText = triggerMessage.contentMarkdown
    const excludedMessageIds = new Set([messageId])

    // ── Step 1: Decide whether to search and generate initial queries ──

    const decision = await this.decideAndGenerateQueries({
      contextSummary,
      config,
      workspaceId,
      messageId,
    })

    let initialQueries: SearchQuery[] = decision.queries?.length ? decision.queries : []

    if (!decision.needsSearch && decision.reasoning === "Decision failed") {
      initialQueries = buildBaselineQueries(triggerMessageText)
      if (initialQueries.length > 0) {
        logger.warn({ messageId }, "Researcher decision failed; falling back to baseline retrieval queries")
      }
    }
    if (decision.needsSearch && initialQueries.length === 0) {
      initialQueries = buildBaselineQueries(triggerMessageText)
      logger.info(
        { messageId, reasoning: decision.reasoning },
        "Researcher generated baseline queries because model did not return any queries"
      )
    }

    const shouldSearch = decision.needsSearch || initialQueries.length > 0

    if (!shouldSearch || initialQueries.length === 0) {
      logger.debug({ messageId, reasoning: decision.reasoning }, "Researcher decided no search needed")
      return this.emptyResult()
    }

    // ── Step 2: Search → evaluate loop ──

    let allMemos: EnrichedMemoResult[] = []
    let allMessages: EnrichedMessageResult[] = []
    let allAttachments: EnrichedAttachmentResult[] = []
    let pendingQueries: SearchQuery[] = appendBaselineQueries(initialQueries, triggerMessageText)
    let iteration = 0

    while (iteration < maxIterations) {
      // Execute pending queries
      if (pendingQueries.length === 0) {
        logger.warn({ messageId }, "Researcher loop iteration with no pending queries")
        break
      }

      const searchResults = await this.executeQueries(
        pool,
        pendingQueries,
        workspaceId,
        accessibleStreamIds,
        embeddingService,
        invokingMemberId,
        true,
        excludedMessageIds
      )

      allMemos = mergeMemoResults(allMemos, searchResults.memos)
      allMessages = mergeMessageResults(allMessages, searchResults.messages)
      allAttachments = mergeAttachmentResults(allAttachments, searchResults.attachments)

      // Evaluate results
      const evaluation = await this.evaluateResults(
        contextSummary,
        allMemos,
        allMessages,
        allAttachments,
        config,
        workspaceId,
        messageId
      )

      const hasAnyResults = allMemos.length > 0 || allMessages.length > 0 || allAttachments.length > 0

      // On evaluation failure with no results, try baseline queries once
      if (evaluation.reasoning === "Evaluation failed" && !hasAnyResults) {
        const fallbackQueries = buildBaselineQueries(triggerMessageText)
        if (fallbackQueries.length > 0) {
          logger.warn(
            { messageId, iteration },
            "Researcher evaluation failed with no results; retrying with baseline queries"
          )
          pendingQueries = fallbackQueries
          iteration++
          continue
        }
      }

      if (evaluation.sufficient || !evaluation.additionalQueries?.length) {
        logger.debug({ messageId, iteration, reasoning: evaluation.reasoning }, "Researcher found sufficient results")
        break
      }

      // Continue with additional queries
      pendingQueries = evaluation.additionalQueries
      iteration++
    }

    if (iteration >= maxIterations) {
      logger.debug({ messageId, iteration, maxIterations }, "Researcher reached max iterations")
    }

    // ── Step 3: Build result ──

    const sources = this.buildSources(allMemos, allMessages, allAttachments, workspaceId)
    const retrievedContext = formatRetrievedContext(allMemos, allMessages, allAttachments)

    logger.info(
      {
        messageId,
        memoCount: allMemos.length,
        messageCount: allMessages.length,
        attachmentCount: allAttachments.length,
        iterations: iteration,
        accessSpecType: accessSpec.type,
      },
      "Researcher completed"
    )

    return {
      retrievedContext,
      sources,
      shouldSearch: true,
      memos: allMemos,
      messages: allMessages,
      attachments: allAttachments,
    }
  }

  /**
   * Combined decision + query generation in a single LLM call.
   * Saves one round-trip compared to separate decide + generateQueries calls.
   */
  private async decideAndGenerateQueries(params: {
    contextSummary: string
    config: ResearcherConfig
    workspaceId: string
    messageId: string
  }): Promise<z.infer<typeof decisionWithQueriesSchema>> {
    const { ai } = this.deps
    const { contextSummary, config, workspaceId, messageId } = params
    try {
      const { value } = await ai.generateObject({
        model: config.modelId,
        schema: decisionWithQueriesSchema,
        messages: [
          { role: "system", content: RESEARCHER_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Analyze this message and decide if workspace search would help answer it.

${contextSummary}

Respond with:
- needsSearch: true/false
- reasoning: brief explanation of your decision
- queries: array of search queries (or null if needsSearch is false)

Each query must have:
- target: "memos" | "messages" | "attachments"
- type: "semantic" | "exact"
- query: the search text

Guidelines for search:
- Use target "memos" for summarized knowledge (decisions, context, discussions)
- Use target "messages" for specific quotes, recent activity, or exact terms
- Use target "attachments" when looking for documents, images, or files
- Use type "semantic" for concepts/topics
- Use type "exact" for error messages, IDs, or quoted text`,
          },
        ],
        temperature: config.temperature,
        telemetry: { functionId: "researcher-decide-and-query", metadata: { messageId } },
        context: { workspaceId, origin: "system" },
      })

      return value
    } catch (error) {
      logger.warn({ error }, "Researcher decision failed, defaulting to no search")
      return { needsSearch: false, reasoning: "Decision failed", queries: null }
    }
  }

  /**
   * Evaluate if current results are sufficient.
   */
  private async evaluateResults(
    contextSummary: string,
    memos: EnrichedMemoResult[],
    messages: EnrichedMessageResult[],
    attachments: EnrichedAttachmentResult[],
    config: ResearcherConfig,
    workspaceId: string,
    messageId: string
  ): Promise<z.infer<typeof evaluationSchema>> {
    const { ai } = this.deps
    const resultsText = this.formatResultsForEvaluation(memos, messages, attachments)

    try {
      const { value } = await ai.generateObject({
        model: config.modelId,
        schema: evaluationSchema,
        messages: [
          { role: "system", content: RESEARCHER_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Evaluate if these search results are sufficient to help answer the user's question.

${contextSummary}

## Current Results

${resultsText || "No results found yet."}

Respond with:
- sufficient: true/false
- reasoning: brief explanation
- additionalQueries: array of queries (or null if sufficient)

Each query must have:
- target: "memos" | "messages" | "attachments"
- type: "semantic" | "exact"
- query: the search text`,
          },
        ],
        temperature: config.temperature,
        telemetry: { functionId: "researcher-evaluate", metadata: { messageId } },
        context: { workspaceId, origin: "system" },
      })

      return value
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
    invokingMemberId: string,
    includeSurroundingContext: boolean,
    excludedMessageIds: Set<string>
  ): Promise<{
    memos: EnrichedMemoResult[]
    messages: EnrichedMessageResult[]
    attachments: EnrichedAttachmentResult[]
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
            attachments: [] as EnrichedAttachmentResult[],
            search: {
              target: "memos" as const,
              type: query.type,
              query: query.query,
              resultCount: memoResults.length,
            },
          }
        } else if (query.target === "messages") {
          const messageResults = await this.searchMessages(
            pool,
            query,
            workspaceId,
            accessibleStreamIds,
            includeSurroundingContext,
            excludedMessageIds
          )
          return {
            type: "messages" as const,
            memos: [] as EnrichedMemoResult[],
            messages: messageResults,
            attachments: [] as EnrichedAttachmentResult[],
            search: {
              target: "messages" as const,
              type: query.type,
              query: query.query,
              resultCount: messageResults.length,
            },
          }
        } else {
          const attachmentResults = await this.searchAttachments(pool, query, workspaceId, accessibleStreamIds)
          return {
            type: "attachments" as const,
            memos: [] as EnrichedMemoResult[],
            messages: [] as EnrichedMessageResult[],
            attachments: attachmentResults,
            search: {
              target: "attachments" as const,
              type: query.type,
              query: query.query,
              resultCount: attachmentResults.length,
            },
          }
        }
      })
    )

    // Aggregate results
    const memos: EnrichedMemoResult[] = []
    const messages: EnrichedMessageResult[] = []
    const attachments: EnrichedAttachmentResult[] = []
    const searches: ResearcherCachedResult["searchesPerformed"] = []

    for (const result of results) {
      memos.push(...result.memos)
      messages.push(...result.messages)
      attachments.push(...result.attachments)
      searches.push(result.search)
    }

    logger.debug(
      {
        queryCount: searches.length,
        searches: searches.map((search) => ({
          target: search.target,
          type: search.type,
          query: search.query,
          resultCount: search.resultCount,
        })),
      },
      "Researcher query batch completed"
    )

    return { memos, messages, attachments, searches }
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
        const embedding = await embeddingService.embed(query.query, {
          workspaceId,
          functionId: "researcher-memo-semantic-search",
        })
        // DB search (single query, INV-30)
        const semanticResults = await MemoRepository.semanticSearch(pool, {
          workspaceId,
          embedding,
          streamIds: accessibleStreamIds,
          limit: RESEARCHER_MAX_RESULTS_PER_SEARCH,
          semanticDistanceThreshold: SEMANTIC_DISTANCE_THRESHOLD,
        })
        const results =
          semanticResults.length > 0
            ? semanticResults
            : await MemoRepository.fullTextSearch(pool, {
                workspaceId,
                query: query.query,
                streamIds: accessibleStreamIds,
                limit: RESEARCHER_MAX_RESULTS_PER_SEARCH,
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
        limit: RESEARCHER_MAX_RESULTS_PER_SEARCH,
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
    accessibleStreamIds: string[],
    includeSurroundingContext: boolean,
    excludedMessageIds: Set<string>
  ): Promise<EnrichedMessageResult[]> {
    const { embeddingService } = this.deps

    // Build query string - for exact, wrap in quotes
    const searchQuery = query.type === "exact" ? `"${query.query}"` : query.query

    try {
      // Generate embedding for semantic search (AI, no DB, ~200-500ms)
      let embedding: number[] = []
      if (searchQuery.trim()) {
        try {
          embedding = await embeddingService.embed(searchQuery, {
            workspaceId,
            functionId: "researcher-message-semantic-search",
          })
        } catch (error) {
          logger.warn({ error }, "Failed to generate embedding, falling back to keyword-only search")
        }
      }

      // DB search (fast, ~10-50ms)
      return await withClient(pool, async (client) => {
        const filters = {}
        const normalizedQuery = searchQuery.trim()
        const hasQuery = normalizedQuery.length > 0
        const hasEmbedding = embedding.length > 0
        const primaryResults =
          !hasQuery || !hasEmbedding
            ? await SearchRepository.fullTextSearch(client, {
                query: normalizedQuery,
                streamIds: accessibleStreamIds,
                filters,
                limit: RESEARCHER_MAX_RESULTS_PER_SEARCH,
              })
            : await SearchRepository.hybridSearch(client, {
                query: normalizedQuery,
                embedding,
                streamIds: accessibleStreamIds,
                filters,
                limit: RESEARCHER_MAX_RESULTS_PER_SEARCH,
                semanticDistanceThreshold: SEMANTIC_DISTANCE_THRESHOLD,
              })
        const searchResults =
          hasQuery && hasEmbedding && primaryResults.length === 0
            ? await SearchRepository.fullTextSearch(client, {
                query: normalizedQuery,
                streamIds: accessibleStreamIds,
                filters,
                limit: RESEARCHER_MAX_RESULTS_PER_SEARCH,
              })
            : primaryResults

        const filteredSearchResults = searchResults.filter((result) => !excludedMessageIds.has(result.id))
        const rawResults = [...filteredSearchResults]
        if (includeSurroundingContext && filteredSearchResults.length > 0) {
          const surroundingBatches = await Promise.all(
            filteredSearchResults
              .slice(0, 3)
              .map((result) => MessageRepository.findSurrounding(client, result.id, result.streamId, 1, 1))
          )

          for (const surrounding of surroundingBatches) {
            for (const message of surrounding) {
              if (excludedMessageIds.has(message.id)) {
                continue
              }
              rawResults.push({
                id: message.id,
                streamId: message.streamId,
                content: message.contentMarkdown,
                authorId: message.authorId,
                authorType: message.authorType,
                createdAt: message.createdAt,
                rank: 0,
              })
            }
          }

          const topStreamIds = [...new Set(filteredSearchResults.slice(0, 2).map((result) => result.streamId))]
          const recentMessagesByStream = await Promise.all(
            topStreamIds.map((streamId) => MessageRepository.list(client, streamId, { limit: 5 }))
          )
          for (const streamMessages of recentMessagesByStream) {
            for (const message of streamMessages) {
              if (excludedMessageIds.has(message.id)) {
                continue
              }
              rawResults.push({
                id: message.id,
                streamId: message.streamId,
                content: message.contentMarkdown,
                authorId: message.authorId,
                authorType: message.authorType,
                createdAt: message.createdAt,
                rank: 0,
              })
            }
          }
        }

        const dedupedResultsById = new Map<string, (typeof rawResults)[number]>()
        for (const result of rawResults) {
          if (excludedMessageIds.has(result.id)) {
            continue
          }
          if (!dedupedResultsById.has(result.id)) {
            dedupedResultsById.set(result.id, result)
          }
        }

        // Enrich results with author names and stream names
        return enrichMessageSearchResults(client, [...dedupedResultsById.values()])
      })
    } catch (error) {
      logger.warn({ error, query: query.query }, "Message search failed")
      return []
    }
  }

  /**
   * Search attachments with a query.
   * Uses keyword search on filename and extraction content.
   */
  private async searchAttachments(
    pool: Pool,
    query: SearchQuery,
    workspaceId: string,
    accessibleStreamIds: string[]
  ): Promise<EnrichedAttachmentResult[]> {
    try {
      const results = await AttachmentRepository.searchWithExtractions(pool, {
        workspaceId,
        streamIds: accessibleStreamIds,
        query: query.query,
        limit: RESEARCHER_MAX_RESULTS_PER_SEARCH,
      })

      return results.map((r) => ({
        id: r.id,
        filename: r.filename,
        mimeType: r.mimeType,
        streamId: r.streamId,
        contentType: r.extraction?.contentType ?? null,
        summary: r.extraction?.summary ?? null,
        createdAt: r.createdAt,
      }))
    } catch (error) {
      logger.warn({ error, query: query.query }, "Attachment search failed")
      return []
    }
  }

  /**
   * Build sources for citation.
   */
  private buildSources(
    memos: EnrichedMemoResult[],
    messages: EnrichedMessageResult[],
    attachments: EnrichedAttachmentResult[],
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

    for (const att of attachments) {
      sources.push({
        type: "workspace",
        title: att.filename,
        url: att.streamId
          ? `/w/${workspaceId}/streams/${att.streamId}?attachment=${att.id}`
          : `/w/${workspaceId}/attachments/${att.id}`,
        snippet: att.summary?.slice(0, 200),
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
  private formatResultsForEvaluation(
    memos: EnrichedMemoResult[],
    messages: EnrichedMessageResult[],
    attachments: EnrichedAttachmentResult[]
  ): string {
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

    if (attachments.length > 0) {
      parts.push("### Attachments Found")
      for (const att of attachments) {
        const summary = att.summary ? `: ${att.summary}` : ""
        parts.push(`- **${att.filename}** (${att.contentType ?? att.mimeType})${summary}`)
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
      attachments: [],
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
      attachments: [],
    }
  }
}
