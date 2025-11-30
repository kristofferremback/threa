import { Pool } from "pg"
import { ChatAnthropic } from "@langchain/anthropic"
import { SearchService, SearchScope } from "../../services/search-service"
import { MemoService, Memo } from "../../services/memo-service"
import { StreamService } from "../../services/stream-service"
import { logger } from "../../lib/logger"
import { queueEnrichmentForRetrieval } from "../../workers"

/**
 * AriadneResearcher - Iterative research agent for complex questions.
 *
 * Implements a plan/search/reflect loop:
 * 1. Quick memo lookup (might short-circuit for simple questions)
 * 2. Plan information needs based on question and gathered context
 * 3. Execute search plan across memos and messages
 * 4. Reflect on confidence and determine if more iteration is needed
 * 5. Synthesize final answer with citations
 */

export interface ResearcherConfig {
  maxIterations: number
  confidenceThreshold: number
  maxRetrievedMemos: number
  maxRetrievedEvents: number
}

interface GatheredContext {
  memos: Array<{ id: string; summary: string; streamId?: string; streamName?: string; score: number }>
  events: Array<{
    id: string
    content: string
    author: string
    streamId: string
    channel: string
    date: string
    textMessageId?: string
  }>
  confidence: number
  iterations: number
}

interface SearchPlan {
  sufficient: boolean
  missing: string[]
  searches: Array<{
    type: "memo" | "message"
    query: string
    filters?: {
      userIds?: string[]
      streamIds?: string[]
    }
  }>
}

interface Reflection {
  confidence: number
  assessment: string
  missing: string[]
  refinedQueries: string[]
}

export interface Citation {
  /** The citation number as used in the response text [1], [2], etc. */
  index: number
  /** Type of source */
  type: "message" | "memo"
  /** Event ID (for messages) or memo ID */
  id: string
  /** Stream ID where the source is located */
  streamId?: string
  /** Stream name/slug for display */
  streamName?: string
  /** Author name (for messages) */
  author?: string
  /** Date of the source */
  date?: string
  /** Preview of the source content */
  preview?: string
}

export interface ResearcherResponse {
  content: string
  /** List of citation IDs (for backward compatibility) */
  citations: string[]
  /** Rich citation metadata for frontend rendering */
  citationDetails: Citation[]
  confidence: number
  iterations: number
  memoHits: string[]
}

export class AriadneResearcher {
  private config: ResearcherConfig
  private searchService: SearchService
  private memoService: MemoService
  private streamService: StreamService
  private planModel: ChatAnthropic
  private synthesisModel: ChatAnthropic

  constructor(
    private pool: Pool,
    private workspaceId: string,
    private userId: string,
    private scope: SearchScope,
    config?: Partial<ResearcherConfig>,
  ) {
    this.config = {
      maxIterations: 3,
      confidenceThreshold: 0.8,
      maxRetrievedMemos: 5,
      maxRetrievedEvents: 10,
      ...config,
    }

    this.searchService = new SearchService(pool)
    this.memoService = new MemoService(pool)
    this.streamService = new StreamService(pool)

    // Use Haiku for planning (fast, cheap)
    this.planModel = new ChatAnthropic({
      model: "claude-haiku-4-5-20251001",
      temperature: 0.3,
      maxTokens: 1024,
    })

    // Use Sonnet for synthesis (better quality)
    this.synthesisModel = new ChatAnthropic({
      model: "claude-sonnet-4-20250514",
      temperature: 0.5,
      maxTokens: 2048,
    })
  }

  /**
   * Main entry point for iterative research.
   */
  async research(question: string): Promise<ResearcherResponse> {
    logger.info({ workspaceId: this.workspaceId, questionLength: question.length }, "Starting iterative research")

    // Step 1: Quick memo lookup (might short-circuit)
    const quickResult = await this.quickMemoLookup(question)
    if (quickResult.confidence > 0.9 && quickResult.memos.length > 0) {
      logger.info({ memoCount: quickResult.memos.length }, "Short-circuiting with high-confidence memos")
      return this.synthesizeFromMemos(question, quickResult)
    }

    // Step 2: Full iterative research
    return this.iterativeResearch(question, quickResult)
  }

  /**
   * Quick memo lookup - first pass.
   */
  private async quickMemoLookup(question: string): Promise<GatheredContext> {
    const results = await this.searchService.search(this.workspaceId, question, {
      limit: this.config.maxRetrievedMemos,
      searchMessages: false,
      searchKnowledge: true,
      userId: this.userId,
      scope: this.scope,
    })

    // Log retrieval
    const memoIds = results.results.map((r) => r.id)
    if (memoIds.length > 0) {
      await this.memoService
        .logRetrieval({
          workspaceId: this.workspaceId,
          query: question,
          requesterType: "ariadne",
          requesterId: this.userId,
          retrievedMemoIds: memoIds,
          retrievalScores: Object.fromEntries(results.results.map((r) => [r.id, r.score])),
          iterationCount: 0,
        })
        .catch((err) => logger.warn({ err }, "Failed to log retrieval"))
    }

    // Calculate confidence based on top scores
    const avgScore = results.results.length > 0 ? results.results.reduce((sum, r) => sum + r.score, 0) / results.results.length : 0
    const topScore = results.results[0]?.score || 0

    return {
      memos: results.results.map((r) => ({
        id: r.id,
        summary: r.content,
        streamName: r.streamName,
        score: r.score,
      })),
      events: [],
      confidence: Math.max(avgScore, topScore * 0.9),
      iterations: 0,
    }
  }

  /**
   * Iterative research loop: plan → search → reflect.
   */
  private async iterativeResearch(question: string, initialContext: GatheredContext): Promise<ResearcherResponse> {
    let gatheredContext = { ...initialContext }
    let iteration = 0

    while (iteration < this.config.maxIterations) {
      iteration++
      gatheredContext.iterations = iteration

      // PLAN: What information do we need?
      const plan = await this.planInformationNeeds(question, gatheredContext)

      if (plan.sufficient) {
        logger.info({ iteration }, "Plan determined we have sufficient information")
        break
      }

      // SEARCH: Execute search plan
      const searchResults = await this.executeSearchPlan(plan)

      // INTEGRATE: Merge new results
      gatheredContext = this.integrateResults(gatheredContext, searchResults)

      // REFLECT: Assess confidence
      const reflection = await this.reflect(question, gatheredContext)
      gatheredContext.confidence = reflection.confidence

      logger.info({ iteration, confidence: reflection.confidence, assessment: reflection.assessment }, "Research iteration complete")

      if (reflection.confidence >= this.config.confidenceThreshold) {
        break
      }
    }

    // Log final retrieval
    await this.memoService
      .logRetrieval({
        workspaceId: this.workspaceId,
        query: question,
        requesterType: "ariadne",
        requesterId: this.userId,
        retrievedMemoIds: gatheredContext.memos.map((m) => m.id),
        retrievedEventIds: gatheredContext.events.map((e) => e.id),
        retrievalScores: {
          ...Object.fromEntries(gatheredContext.memos.map((m) => [m.id, m.score])),
        },
        iterationCount: iteration,
      })
      .catch((err) => logger.warn({ err }, "Failed to log final retrieval"))

    // Queue enrichment for retrieved events
    for (const event of gatheredContext.events) {
      if (event.textMessageId) {
        queueEnrichmentForRetrieval({
          workspaceId: this.workspaceId,
          eventId: event.id,
          textMessageId: event.textMessageId,
          helpful: gatheredContext.confidence > 0.7,
        }).catch((err) => logger.warn({ err }, "Failed to queue enrichment for retrieval"))
      }
    }

    // Synthesize final answer
    return this.synthesize(question, gatheredContext)
  }

  /**
   * Plan what information is needed.
   */
  private async planInformationNeeds(question: string, currentContext: GatheredContext): Promise<SearchPlan> {
    const prompt = `You are helping search a workspace's knowledge base.

Question: ${question}

Information gathered so far:
${this.formatGatheredContext(currentContext)}

What additional information is needed to fully answer this question?
If the current information is sufficient, output {"sufficient": true}.
Otherwise, provide search queries to find missing information.

Output ONLY valid JSON:
{
  "sufficient": boolean,
  "missing": ["what's still needed"],
  "searches": [
    {"type": "memo", "query": "search terms for memos"},
    {"type": "message", "query": "search terms for messages"}
  ]
}

Keep searches concise and targeted. Maximum 2-3 searches per iteration.`

    try {
      const response = await this.planModel.invoke([{ role: "user", content: prompt }])
      const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content)

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as SearchPlan
      }

      return { sufficient: false, missing: [], searches: [{ type: "message", query: question }] }
    } catch (err) {
      logger.warn({ err }, "Failed to plan information needs, falling back to direct search")
      return { sufficient: false, missing: [], searches: [{ type: "message", query: question }] }
    }
  }

  /**
   * Execute the search plan.
   */
  private async executeSearchPlan(plan: SearchPlan): Promise<{ memos: GatheredContext["memos"]; events: GatheredContext["events"] }> {
    const results: { memos: GatheredContext["memos"]; events: GatheredContext["events"] } = {
      memos: [],
      events: [],
    }

    for (const search of plan.searches.slice(0, 3)) {
      try {
        if (search.type === "memo") {
          const memoResults = await this.searchService.search(this.workspaceId, search.query, {
            limit: this.config.maxRetrievedMemos,
            searchMessages: false,
            searchKnowledge: true,
            userId: this.userId,
            scope: this.scope,
          })

          results.memos.push(
            ...memoResults.results.map((r) => ({
              id: r.id,
              summary: r.content,
              streamId: r.streamId,
              streamName: r.streamName,
              score: r.score,
            })),
          )
        } else {
          const messageResults = await this.searchService.search(this.workspaceId, search.query, {
            limit: this.config.maxRetrievedEvents,
            searchMessages: true,
            searchKnowledge: false,
            userId: this.userId,
            scope: this.scope,
            filters: search.filters,
          })

          results.events.push(
            ...messageResults.results.map((r) => ({
              id: r.id,
              content: r.content,
              author: r.actor?.name || "Unknown",
              streamId: r.streamId || "",
              channel: r.streamName || "unknown",
              date: new Date(r.createdAt).toLocaleDateString(),
              textMessageId: r.id, // For enrichment tracking
            })),
          )
        }
      } catch (err) {
        logger.warn({ err, search }, "Search in plan failed")
      }
    }

    return results
  }

  /**
   * Integrate new results with existing context.
   */
  private integrateResults(
    current: GatheredContext,
    newResults: { memos: GatheredContext["memos"]; events: GatheredContext["events"] },
  ): GatheredContext {
    // Dedupe by ID
    const seenMemoIds = new Set(current.memos.map((m) => m.id))
    const seenEventIds = new Set(current.events.map((e) => e.id))

    const newMemos = newResults.memos.filter((m) => !seenMemoIds.has(m.id))
    const newEvents = newResults.events.filter((e) => !seenEventIds.has(e.id))

    return {
      ...current,
      memos: [...current.memos, ...newMemos].slice(0, this.config.maxRetrievedMemos),
      events: [...current.events, ...newEvents].slice(0, this.config.maxRetrievedEvents),
    }
  }

  /**
   * Reflect on gathered context and assess confidence.
   */
  private async reflect(question: string, context: GatheredContext): Promise<Reflection> {
    const prompt = `You are assessing whether we have enough information to answer a question.

Question: ${question}

Gathered information:
${this.formatGatheredContext(context)}

Assess:
1. How confident are you (0-1) that this information can answer the question?
2. What's missing, if anything?

Output ONLY valid JSON:
{
  "confidence": 0.X,
  "assessment": "brief assessment",
  "missing": ["what's missing"],
  "refinedQueries": ["refined search if needed"]
}`

    try {
      const response = await this.planModel.invoke([{ role: "user", content: prompt }])
      const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content)

      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as Reflection
      }

      // Fallback confidence estimate based on results
      const hasResults = context.memos.length > 0 || context.events.length > 0
      return {
        confidence: hasResults ? 0.6 : 0.2,
        assessment: hasResults ? "Some relevant information found" : "No relevant information found",
        missing: [],
        refinedQueries: [],
      }
    } catch (err) {
      logger.warn({ err }, "Failed to reflect, using fallback confidence")
      return {
        confidence: context.memos.length > 0 || context.events.length > 0 ? 0.5 : 0.2,
        assessment: "Reflection failed",
        missing: [],
        refinedQueries: [],
      }
    }
  }

  /**
   * Synthesize answer from memos (short-circuit path).
   */
  private async synthesizeFromMemos(question: string, context: GatheredContext): Promise<ResearcherResponse> {
    const prompt = `Answer this question based on the workspace memos below.
Reference specific memos using [1], [2] etc when citing information.
If the memos don't fully answer the question, say so.

Question: ${question}

Relevant memos:
${context.memos.map((m, i) => `[${i + 1}] ${m.summary}${m.streamName ? ` (from #${m.streamName})` : ""}`).join("\n\n")}`

    const response = await this.synthesisModel.invoke([{ role: "user", content: prompt }])
    const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content)

    // Build rich citation details
    const citationDetails: Citation[] = context.memos.map((m, i) => ({
      index: i + 1,
      type: "memo" as const,
      id: m.id,
      streamName: m.streamName,
      preview: m.summary.slice(0, 150) + (m.summary.length > 150 ? "..." : ""),
    }))

    return {
      content,
      citations: context.memos.map((m) => m.id),
      citationDetails,
      confidence: context.confidence,
      iterations: 0,
      memoHits: context.memos.map((m) => m.id),
    }
  }

  /**
   * Synthesize final answer from all gathered context.
   */
  private async synthesize(question: string, context: GatheredContext): Promise<ResearcherResponse> {
    const prompt = `Answer this question based on the workspace conversations and memos below.
Cite specific messages using [1], [2] etc. when referencing information.
If you're not confident about something, say so.

Question: ${question}

${context.memos.length > 0 ? `Relevant memos:\n${context.memos.map((m, i) => `- ${m.summary}${m.streamName ? ` (from #${m.streamName})` : ""}`).join("\n")}\n\n` : ""}Relevant conversations:
${context.events.map((e, i) => `[${i + 1}] ${e.author} in #${e.channel} (${e.date}): ${e.content.slice(0, 500)}${e.content.length > 500 ? "..." : ""}`).join("\n\n")}`

    const response = await this.synthesisModel.invoke([{ role: "user", content: prompt }])
    const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content)

    // Build rich citation details for events (messages get numbered citations)
    const citationDetails: Citation[] = context.events.map((e, i) => ({
      index: i + 1,
      type: "message" as const,
      id: e.id,
      streamId: e.streamId,
      streamName: e.channel,
      author: e.author,
      date: e.date,
      preview: e.content.slice(0, 150) + (e.content.length > 150 ? "..." : ""),
    }))

    return {
      content,
      citations: context.events.map((e) => e.id),
      citationDetails,
      confidence: context.confidence,
      iterations: context.iterations,
      memoHits: context.memos.map((m) => m.id),
    }
  }

  /**
   * Format gathered context for prompts.
   */
  private formatGatheredContext(context: GatheredContext): string {
    if (context.memos.length === 0 && context.events.length === 0) {
      return "No information gathered yet."
    }

    let formatted = ""

    if (context.memos.length > 0) {
      formatted += "Memos:\n"
      formatted += context.memos.map((m) => `- ${m.summary}${m.streamName ? ` (from #${m.streamName})` : ""}`).join("\n")
      formatted += "\n\n"
    }

    if (context.events.length > 0) {
      formatted += "Messages:\n"
      formatted += context.events.map((e) => `- ${e.author} in #${e.channel}: ${e.content.slice(0, 200)}...`).join("\n")
    }

    return formatted
  }
}

/**
 * Classify question complexity.
 * Used to decide between single-shot and iterative research.
 */
export async function classifyQuestionComplexity(question: string): Promise<"simple" | "complex"> {
  // Simple heuristics for now - can be enhanced with SLM later
  const complexIndicators = [
    /how (do|does|can|should|did|would)/i,
    /what (is the|are the|was the|were the) (best|correct|proper|right|standard)/i,
    /explain/i,
    /compare/i,
    /difference between/i,
    /steps to/i,
    /process for/i,
    /why (did|does|do|is|are|was|were)/i,
  ]

  const simpleIndicators = [/^who is/i, /^what is (?!the best)/i, /^when (did|is|was)/i, /^where (is|are|was|were)/i, /^(?:is|are|was|were|did|do|does|can|will) /i]

  // Check for complex patterns
  for (const pattern of complexIndicators) {
    if (pattern.test(question)) {
      return "complex"
    }
  }

  // Check for simple patterns
  for (const pattern of simpleIndicators) {
    if (pattern.test(question)) {
      return "simple"
    }
  }

  // Default to complex for longer questions
  return question.length > 100 ? "complex" : "simple"
}
