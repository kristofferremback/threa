import { Pool } from "pg"
import { sql } from "../lib/db"
import { generateEmbedding, estimateTokens, calculateCost, Models } from "../lib/ai-providers"
import { AIUsageService } from "./ai-usage-service"
import { parseSearchQuery, SearchFilters } from "../lib/search-parser"
import { logger } from "../lib/logger"
import { getTextMessageEmbeddingTable, getKnowledgeEmbeddingTable } from "../lib/embedding-tables"

export interface SearchResult {
  type: "message" | "knowledge"
  id: string
  streamId?: string
  streamSlug?: string
  streamName?: string
  content: string
  score: number
  highlights?: string
  createdAt: string
  actor?: {
    id: string
    name: string
    email: string
  }
}

export interface SearchOptions {
  limit?: number
  offset?: number
  searchKnowledge?: boolean
  searchMessages?: boolean
}

export class SearchService {
  private usageService: AIUsageService

  constructor(private pool: Pool) {
    this.usageService = new AIUsageService(pool)
  }

  /**
   * Hybrid search combining vector similarity with full-text search.
   */
  async search(
    workspaceId: string,
    query: string,
    options: SearchOptions = {},
  ): Promise<{
    results: SearchResult[]
    total: number
    parsedQuery: { filters: SearchFilters; freeText: string }
  }> {
    const { filters, freeText } = parseSearchQuery(query)
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0

    // Check if searching knowledge only
    const searchKnowledgeOnly = filters.is?.includes("knowledge")
    const searchMessagesOnly = options.searchMessages && !options.searchKnowledge

    const results: SearchResult[] = []

    // Search messages (if not knowledge-only)
    if (!searchKnowledgeOnly && options.searchMessages !== false) {
      const messageResults = await this.searchMessages(workspaceId, freeText, filters, {
        limit,
        offset,
      })
      results.push(...messageResults)
    }

    // Search knowledge (if not messages-only and knowledge search enabled)
    if (!searchMessagesOnly && options.searchKnowledge !== false) {
      const knowledgeResults = await this.searchKnowledge(workspaceId, freeText, filters, {
        limit: Math.max(10, limit - results.length),
        offset: 0,
      })
      results.push(...knowledgeResults)
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score)
    const finalResults = results.slice(0, limit)

    return {
      results: finalResults,
      total: finalResults.length,
      parsedQuery: { filters, freeText },
    }
  }

  /**
   * Search messages using hybrid vector + full-text search.
   */
  private async searchMessages(
    workspaceId: string,
    freeText: string,
    filters: SearchFilters,
    options: { limit: number; offset: number },
  ): Promise<SearchResult[]> {
    // Build filter clauses
    const filterClauses: string[] = []
    const filterValues: unknown[] = []
    let paramIndex = 1

    // Workspace filter (always applied)
    filterClauses.push(`s.workspace_id = $${paramIndex++}`)
    filterValues.push(workspaceId)

    // from: filter (user)
    if (filters.from?.length) {
      const userPlaceholders = filters.from.map(() => `$${paramIndex++}`).join(", ")
      filterClauses.push(`(u.email ILIKE ANY(ARRAY[${userPlaceholders}]) OR COALESCE(wp.display_name, u.name) ILIKE ANY(ARRAY[${userPlaceholders}]))`)
      // Add % wildcards for ILIKE
      const patterns = filters.from.map((f) => `%${f}%`)
      filterValues.push(...patterns, ...patterns)
    }

    // in: filter (stream)
    if (filters.in?.length) {
      const streamPlaceholders = filters.in.map(() => `$${paramIndex++}`).join(", ")
      filterClauses.push(`(s.slug IN (${streamPlaceholders}) OR s.id IN (${streamPlaceholders}))`)
      filterValues.push(...filters.in, ...filters.in)
    }

    // before: filter
    if (filters.before) {
      filterClauses.push(`e.created_at < $${paramIndex++}`)
      filterValues.push(filters.before)
    }

    // after: filter
    if (filters.after) {
      filterClauses.push(`e.created_at > $${paramIndex++}`)
      filterValues.push(filters.after)
    }

    // has:code filter
    if (filters.has?.includes("code")) {
      filterClauses.push(`tm.content ~ $${paramIndex++}`)
      filterValues.push("```")
    }

    // has:link filter
    if (filters.has?.includes("link")) {
      filterClauses.push(`tm.content ~ $${paramIndex++}`)
      filterValues.push("https?://")
    }

    // is:thread filter
    if (filters.is?.includes("thread")) {
      filterClauses.push(`s.stream_type = 'thread'`)
    }

    const whereClause = filterClauses.length > 0 ? filterClauses.join(" AND ") : "TRUE"

    // If we have free text, do hybrid search
    if (freeText.trim()) {
      // Generate embedding for semantic search
      const embedding = await generateEmbedding(freeText)

      // Track embedding usage
      await this.usageService.trackUsage({
        workspaceId,
        jobType: "embed",
        model: Models.EMBEDDING,
        inputTokens: estimateTokens(freeText),
        costCents: calculateCost(Models.EMBEDDING, { inputTokens: estimateTokens(freeText) }),
        metadata: { purpose: "search" },
      })

      // Hybrid search query
      const embeddingJson = JSON.stringify(embedding.embedding)
      const tsQuery = freeText
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .join(" & ")

      // Get the appropriate embedding table based on provider
      const embeddingTable = getTextMessageEmbeddingTable()

      const queryText = `
        WITH filtered_events AS (
          SELECT
            e.id,
            e.stream_id,
            e.actor_id,
            e.created_at,
            tm.id as text_message_id,
            tm.content,
            emb.embedding,
            s.slug as stream_slug,
            s.name as stream_name,
            u.email as actor_email,
            COALESCE(wp.display_name, u.name) as actor_name
          FROM stream_events e
          INNER JOIN text_messages tm ON e.content_id = tm.id AND e.content_type = 'text_message'
          INNER JOIN streams s ON e.stream_id = s.id
          INNER JOIN users u ON e.actor_id = u.id
          LEFT JOIN workspace_profiles wp ON u.id = wp.user_id AND wp.workspace_id = s.workspace_id
          LEFT JOIN ${embeddingTable} emb ON emb.text_message_id = tm.id
          WHERE e.deleted_at IS NULL
            AND e.event_type = 'message'
            AND ${whereClause}
        ),
        semantic AS (
          SELECT id, 1 - (embedding <=> $${paramIndex++}::vector) as score
          FROM filtered_events
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $${paramIndex - 1}::vector
          LIMIT 100
        ),
        fulltext AS (
          SELECT id, ts_rank(to_tsvector('english', content), to_tsquery('english', $${paramIndex++})) as score
          FROM filtered_events
          WHERE to_tsvector('english', content) @@ to_tsquery('english', $${paramIndex - 1})
          LIMIT 100
        )
        SELECT
          f.*,
          'message' as type,
          COALESCE(s.score, 0) * 0.6 + COALESCE(t.score, 0) * 0.4 as combined_score,
          ts_headline('english', f.content, to_tsquery('english', $${paramIndex++}),
            'MaxWords=50, MinWords=20, StartSel=**, StopSel=**') as highlights
        FROM filtered_events f
        LEFT JOIN semantic s ON f.id = s.id
        LEFT JOIN fulltext t ON f.id = t.id
        WHERE s.id IS NOT NULL OR t.id IS NOT NULL
        ORDER BY combined_score DESC
        LIMIT $${paramIndex++}
        OFFSET $${paramIndex++}
      `

      filterValues.push(embeddingJson, tsQuery, tsQuery, options.limit, options.offset)

      const result = await this.pool.query(queryText, filterValues)

      return result.rows.map((row) => ({
        type: "message" as const,
        id: row.id,
        streamId: row.stream_id,
        streamSlug: row.stream_slug,
        streamName: row.stream_name,
        content: row.content,
        score: parseFloat(row.combined_score) || 0,
        highlights: row.highlights,
        createdAt: row.created_at.toISOString(),
        actor: {
          id: row.actor_id,
          name: row.actor_name || row.actor_email,
          email: row.actor_email,
        },
      }))
    } else {
      // No free text - just filter and return by recency
      const queryText = `
        SELECT
          e.id,
          e.stream_id,
          e.actor_id,
          e.created_at,
          tm.content,
          s.slug as stream_slug,
          s.name as stream_name,
          u.email as actor_email,
          COALESCE(wp.display_name, u.name) as actor_name
        FROM stream_events e
        INNER JOIN text_messages tm ON e.content_id = tm.id AND e.content_type = 'text_message'
        INNER JOIN streams s ON e.stream_id = s.id
        INNER JOIN users u ON e.actor_id = u.id
        LEFT JOIN workspace_profiles wp ON u.id = wp.user_id AND wp.workspace_id = s.workspace_id
        WHERE e.deleted_at IS NULL
          AND e.event_type = 'message'
          AND ${whereClause}
        ORDER BY e.created_at DESC
        LIMIT $${paramIndex++}
        OFFSET $${paramIndex++}
      `

      filterValues.push(options.limit, options.offset)

      const result = await this.pool.query(queryText, filterValues)

      return result.rows.map((row) => ({
        type: "message" as const,
        id: row.id,
        streamId: row.stream_id,
        streamSlug: row.stream_slug,
        streamName: row.stream_name,
        content: row.content,
        score: 1, // No semantic score, just recency
        createdAt: row.created_at.toISOString(),
        actor: {
          id: row.actor_id,
          name: row.actor_name || row.actor_email,
          email: row.actor_email,
        },
      }))
    }
  }

  /**
   * Search knowledge base using hybrid vector + full-text search.
   */
  private async searchKnowledge(
    workspaceId: string,
    freeText: string,
    filters: SearchFilters,
    options: { limit: number; offset: number },
  ): Promise<SearchResult[]> {
    if (!freeText.trim()) {
      // No free text - return recent knowledge
      const result = await this.pool.query(
        sql`SELECT
          k.id, k.title, k.summary, k.content, k.created_at,
          k.source_stream_id as stream_id,
          s.slug as stream_slug, s.name as stream_name,
          u.id as actor_id, u.email as actor_email, COALESCE(wp.display_name, u.name) as actor_name
        FROM knowledge k
        LEFT JOIN streams s ON k.source_stream_id = s.id
        INNER JOIN users u ON k.created_by = u.id
        LEFT JOIN workspace_profiles wp ON u.id = wp.user_id AND wp.workspace_id = k.workspace_id
        WHERE k.workspace_id = ${workspaceId}
          AND k.archived_at IS NULL
        ORDER BY k.created_at DESC
        LIMIT ${options.limit}
        OFFSET ${options.offset}`,
      )

      return result.rows.map((row) => ({
        type: "knowledge" as const,
        id: row.id,
        streamId: row.stream_id,
        streamSlug: row.stream_slug,
        streamName: row.stream_name,
        content: `**${row.title}**\n\n${row.summary}`,
        score: 1,
        createdAt: row.created_at.toISOString(),
        actor: {
          id: row.actor_id,
          name: row.actor_name || row.actor_email,
          email: row.actor_email,
        },
      }))
    }

    // Generate embedding for semantic search
    const embedding = await generateEmbedding(freeText)

    // Track embedding usage
    await this.usageService.trackUsage({
      workspaceId,
      jobType: "embed",
      model: Models.EMBEDDING,
      inputTokens: estimateTokens(freeText),
      costCents: calculateCost(Models.EMBEDDING, { inputTokens: estimateTokens(freeText) }),
      metadata: { purpose: "search_knowledge" },
    })

    const embeddingJson = JSON.stringify(embedding.embedding)
    const tsQuery = freeText
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .join(" & ")

    // Get the appropriate knowledge embedding table based on provider
    const knowledgeEmbeddingTable = getKnowledgeEmbeddingTable()

    const result = await this.pool.query(
      sql`WITH semantic AS (
        SELECT k.id, 1 - (emb.embedding <=> ${embeddingJson}::vector) as score
        FROM knowledge k
        INNER JOIN ${sql.raw(knowledgeEmbeddingTable)} emb ON emb.knowledge_id = k.id
        WHERE k.workspace_id = ${workspaceId}
          AND k.archived_at IS NULL
        ORDER BY emb.embedding <=> ${embeddingJson}::vector
        LIMIT 50
      ),
      fulltext AS (
        SELECT id, ts_rank(search_vector, to_tsquery('english', ${tsQuery})) as score
        FROM knowledge
        WHERE workspace_id = ${workspaceId}
          AND archived_at IS NULL
          AND search_vector @@ to_tsquery('english', ${tsQuery})
        LIMIT 50
      )
      SELECT
        k.id, k.title, k.summary, k.content, k.created_at,
        k.source_stream_id as stream_id,
        s.slug as stream_slug, s.name as stream_name,
        u.id as actor_id, u.email as actor_email, COALESCE(wp.display_name, u.name) as actor_name,
        COALESCE(sem.score, 0) * 0.6 + COALESCE(ft.score, 0) * 0.4 as combined_score,
        ts_headline('english', k.title || ' ' || k.summary, to_tsquery('english', ${tsQuery}),
          'MaxWords=30, MinWords=10, StartSel=**, StopSel=**') as highlights
      FROM knowledge k
      LEFT JOIN streams s ON k.source_stream_id = s.id
      INNER JOIN users u ON k.created_by = u.id
      LEFT JOIN workspace_profiles wp ON u.id = wp.user_id AND wp.workspace_id = k.workspace_id
      LEFT JOIN semantic sem ON k.id = sem.id
      LEFT JOIN fulltext ft ON k.id = ft.id
      WHERE k.workspace_id = ${workspaceId}
        AND k.archived_at IS NULL
        AND (sem.id IS NOT NULL OR ft.id IS NOT NULL)
      ORDER BY combined_score DESC
      LIMIT ${options.limit}
      OFFSET ${options.offset}`,
    )

    return result.rows.map((row) => ({
      type: "knowledge" as const,
      id: row.id,
      streamId: row.stream_id,
      streamSlug: row.stream_slug,
      streamName: row.stream_name,
      content: `**${row.title}**\n\n${row.summary}`,
      score: parseFloat(row.combined_score) || 0,
      highlights: row.highlights,
      createdAt: row.created_at.toISOString(),
      actor: {
        id: row.actor_id,
        name: row.actor_name || row.actor_email,
        email: row.actor_email,
      },
    }))
  }

  /**
   * Search for messages similar to a given embedding.
   * Used by Ariadne for RAG context retrieval.
   */
  async searchSimilar(
    workspaceId: string,
    embedding: number[],
    options: { limit?: number; streamId?: string } = {},
  ): Promise<SearchResult[]> {
    const limit = options.limit ?? 10
    const embeddingJson = JSON.stringify(embedding)
    const embeddingTable = getTextMessageEmbeddingTable()

    let query = sql`
      SELECT
        e.id,
        e.stream_id,
        e.actor_id,
        e.created_at,
        tm.content,
        s.slug as stream_slug,
        s.name as stream_name,
        u.email as actor_email,
        COALESCE(wp.display_name, u.name) as actor_name,
        1 - (emb.embedding <=> ${embeddingJson}::vector) as score
      FROM stream_events e
      INNER JOIN text_messages tm ON e.content_id = tm.id AND e.content_type = 'text_message'
      INNER JOIN ${sql.raw(embeddingTable)} emb ON emb.text_message_id = tm.id
      INNER JOIN streams s ON e.stream_id = s.id
      INNER JOIN users u ON e.actor_id = u.id
      LEFT JOIN workspace_profiles wp ON u.id = wp.user_id AND wp.workspace_id = s.workspace_id
      WHERE s.workspace_id = ${workspaceId}
        AND e.deleted_at IS NULL
        AND e.event_type = 'message'`

    if (options.streamId) {
      query = sql`${query} AND e.stream_id = ${options.streamId}`
    }

    query = sql`${query}
      ORDER BY emb.embedding <=> ${embeddingJson}::vector
      LIMIT ${limit}`

    const result = await this.pool.query(query)

    return result.rows.map((row) => ({
      type: "message" as const,
      id: row.id,
      streamId: row.stream_id,
      streamSlug: row.stream_slug,
      streamName: row.stream_name,
      content: row.content,
      score: parseFloat(row.score) || 0,
      createdAt: row.created_at.toISOString(),
      actor: {
        id: row.actor_id,
        name: row.actor_name || row.actor_email,
        email: row.actor_email,
      },
    }))
  }
}

