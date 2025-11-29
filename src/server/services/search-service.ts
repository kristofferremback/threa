import { Pool } from "pg"
import { sql } from "../lib/db"
import { generateEmbedding, estimateTokens, calculateCost, Models } from "../lib/ai-providers"
import { AIUsageService } from "./ai-usage-service"
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

/** Stream types that can be searched */
export type SearchableStreamType = "channel" | "thread" | "thinking_space"

/**
 * Typed search filters - IDs are resolved by the caller (frontend or LLM tool wrapper)
 */
export interface TypedSearchFilters {
  /** Filter by user IDs (messages FROM these users) */
  userIds?: string[]
  /** Filter by user IDs (messages in conversations WITH these users - they participated in the same stream) */
  withUserIds?: string[]
  /** Filter by stream IDs (messages in these streams) */
  streamIds?: string[]
  /** Filter by stream types (channel, thread, thinking_space) */
  streamTypes?: SearchableStreamType[]
  /** Filter messages before this date */
  before?: Date
  /** Filter messages after this date */
  after?: Date
  /** Content filters */
  has?: ("code" | "link")[]
  /** Type filters (legacy - use streamTypes for stream filtering) */
  is?: ("thread" | "knowledge")[]
}

/**
 * Search scope determines what content Ariadne can access based on invocation context.
 * - public: Only public streams (when invoked from a public channel)
 * - private: Current private stream + public streams (when invoked from private channel/DM)
 * - user: All content the user can access (when invoked from thinking space)
 */
export interface SearchScope {
  type: "public" | "private" | "user"
  /** For private scope, the specific stream ID that's allowed */
  currentStreamId?: string
}

export interface SearchOptions {
  limit?: number
  offset?: number
  searchKnowledge?: boolean
  searchMessages?: boolean
  /** Pre-resolved typed filters (IDs, not names/slugs) */
  filters?: TypedSearchFilters
  /** User ID for permission filtering - REQUIRED for secure searches */
  userId?: string
  /** Search scope for Ariadne - determines information boundaries based on context */
  scope?: SearchScope
}

export class SearchService {
  private usageService: AIUsageService

  constructor(private pool: Pool) {
    this.usageService = new AIUsageService(pool)
  }

  /**
   * Hybrid search combining vector similarity with full-text search.
   * Filters are pre-resolved typed filters (IDs, not names/slugs).
   */
  async search(
    workspaceId: string,
    query: string,
    options: SearchOptions = {},
  ): Promise<{
    results: SearchResult[]
    total: number
    filters: TypedSearchFilters
  }> {
    const filters = options.filters ?? {}
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0
    const userId = options.userId
    const scope = options.scope

    // Check if searching knowledge only
    const searchKnowledgeOnly = filters.is?.includes("knowledge")
    const searchMessagesOnly = options.searchMessages && !options.searchKnowledge

    const results: SearchResult[] = []

    // Search messages (if not knowledge-only)
    if (!searchKnowledgeOnly && options.searchMessages !== false) {
      const messageResults = await this.searchMessages(workspaceId, query, filters, {
        limit,
        offset,
        userId,
        scope,
      })
      results.push(...messageResults)
    }

    // Search knowledge (if not messages-only and knowledge search enabled)
    // Knowledge is only accessible in "user" scope (thinking spaces) or when no scope is set (UI search)
    const canSearchKnowledge = !scope || scope.type === "user"
    if (!searchMessagesOnly && options.searchKnowledge !== false && canSearchKnowledge) {
      const knowledgeResults = await this.searchKnowledge(workspaceId, query, filters, {
        limit: Math.max(10, limit - results.length),
        offset: 0,
        userId,
      })
      results.push(...knowledgeResults)
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score)
    const finalResults = results.slice(0, limit)

    return {
      results: finalResults,
      total: finalResults.length,
      filters,
    }
  }

  /**
   * Search messages using hybrid vector + full-text search.
   *
   * Permission filtering (base - what user CAN access):
   * - Thinking spaces: only visible to owner (created_by)
   * - Private streams: only visible to members
   * - Public streams: visible to all workspace members
   *
   * Scope filtering (context - what Ariadne SHOULD access):
   * - public: Only public streams (invoked from public channel)
   * - private: Current private stream + public streams (invoked from private channel)
   * - user: All content user can access (invoked from thinking space)
   */
  private async searchMessages(
    workspaceId: string,
    freeText: string,
    filters: TypedSearchFilters,
    options: { limit: number; offset: number; userId?: string; scope?: SearchScope },
  ): Promise<SearchResult[]> {
    // Build filter clauses
    const filterClauses: string[] = []
    const filterValues: unknown[] = []
    let paramIndex = 1

    // Workspace filter (always applied)
    filterClauses.push(`s.workspace_id = $${paramIndex++}`)
    filterValues.push(workspaceId)

    // Scope-based filtering (for Ariadne context awareness)
    // This restricts WHAT Ariadne can see based on where she was invoked
    // Note: threads may have visibility='inherit' - treat them as public if parent is public
    if (options.scope) {
      switch (options.scope.type) {
        case "public":
          // Only public streams (or threads inheriting from public parents)
          // No private content, no thinking spaces
          filterClauses.push(`(
            s.visibility = 'public'
            OR (s.visibility = 'inherit' AND EXISTS (
              SELECT 1 FROM streams parent WHERE parent.id = s.parent_stream_id AND parent.visibility = 'public'
            ))
          )`)
          filterClauses.push(`s.stream_type != 'thinking_space'`)
          break
        case "private":
          // Current private stream + all public streams (no thinking spaces, no other private streams)
          // Threads inheriting from public parents are also allowed
          if (options.scope.currentStreamId) {
            filterClauses.push(`(
              s.visibility = 'public'
              OR s.id = $${paramIndex++}
              OR (s.visibility = 'inherit' AND EXISTS (
                SELECT 1 FROM streams parent WHERE parent.id = s.parent_stream_id AND parent.visibility = 'public'
              ))
            )`)
            filterValues.push(options.scope.currentStreamId)
          } else {
            filterClauses.push(`(
              s.visibility = 'public'
              OR (s.visibility = 'inherit' AND EXISTS (
                SELECT 1 FROM streams parent WHERE parent.id = s.parent_stream_id AND parent.visibility = 'public'
              ))
            )`)
          }
          filterClauses.push(`s.stream_type != 'thinking_space'`)
          break
        case "user":
          // Full user access - apply standard permission filter below
          break
      }
    }

    // Permission filter: user can only see streams they have access to
    // This is the base permission check - applied when scope is "user" or no scope
    // For "public" and "private" scopes, the scope filter above is more restrictive
    // Note: thinking spaces are private streams where only the owner is a member,
    // so the membership check handles them automatically
    // Threads can have visibility='inherit' which means check parent stream's visibility
    if (options.userId && (!options.scope || options.scope.type === "user")) {
      filterClauses.push(`(
        (s.visibility = 'private' AND EXISTS (
          SELECT 1 FROM stream_members sm WHERE sm.stream_id = s.id AND sm.user_id = $${paramIndex++}
        ))
        OR (s.visibility = 'public')
        OR (s.visibility = 'inherit' AND EXISTS (
          SELECT 1 FROM streams parent
          WHERE parent.id = s.parent_stream_id
            AND (
              parent.visibility = 'public'
              OR (parent.visibility = 'private' AND EXISTS (
                SELECT 1 FROM stream_members psm WHERE psm.stream_id = parent.id AND psm.user_id = $${paramIndex++}
              ))
            )
        ))
      )`)
      filterValues.push(options.userId, options.userId)
    }

    // User IDs filter (pre-resolved)
    if (filters.userIds?.length) {
      const userPlaceholders = filters.userIds.map(() => `$${paramIndex++}`).join(", ")
      filterClauses.push(`e.actor_id IN (${userPlaceholders})`)
      filterValues.push(...filters.userIds)
    }

    // Stream IDs filter (pre-resolved)
    if (filters.streamIds?.length) {
      const streamPlaceholders = filters.streamIds.map(() => `$${paramIndex++}`).join(", ")
      filterClauses.push(`e.stream_id IN (${streamPlaceholders})`)
      filterValues.push(...filters.streamIds)
    }

    // With user IDs filter - messages in streams where these users have also participated
    // For threads, the root message author counts as a participant even though their
    // message is technically in the parent stream
    if (filters.withUserIds?.length) {
      const withPlaceholders = filters.withUserIds.map(() => `$${paramIndex++}`).join(", ")
      filterClauses.push(`e.stream_id IN (
        SELECT stream_id FROM (
          -- Direct participation: messages sent in the stream
          SELECT stream_id, actor_id
          FROM stream_events
          WHERE event_type = 'message' AND deleted_at IS NULL

          UNION ALL

          -- For threads: root message author is also a participant
          SELECT s.id as stream_id, root_event.actor_id
          FROM streams s
          JOIN stream_events root_event ON s.branched_from_event_id = root_event.id
          WHERE s.branched_from_event_id IS NOT NULL
        ) participants
        WHERE actor_id IN (${withPlaceholders})
        GROUP BY stream_id
        HAVING COUNT(DISTINCT actor_id) = ${filters.withUserIds.length}
      )`)
      filterValues.push(...filters.withUserIds)
    }

    // Stream types filter (channel, thread, thinking_space)
    if (filters.streamTypes?.length) {
      const typePlaceholders = filters.streamTypes.map(() => `$${paramIndex++}`).join(", ")
      filterClauses.push(`s.stream_type IN (${typePlaceholders})`)
      filterValues.push(...filters.streamTypes)
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
   * Knowledge is workspace-wide and not stream-scoped for now.
   * TODO: Consider adding source_stream permission checks if knowledge
   * should inherit visibility from its source stream.
   */
  private async searchKnowledge(
    workspaceId: string,
    freeText: string,
    _filters: TypedSearchFilters,
    options: { limit: number; offset: number; userId?: string },
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

  // ==========================================================================
  // Resolver methods for LLM tools (name/slug → ID)
  // ==========================================================================

  /**
   * Resolve user names/emails to user IDs within a workspace.
   * Used by LLM tools to convert human-readable names to IDs.
   */
  async resolveUserNames(workspaceId: string, names: string[]): Promise<Map<string, string>> {
    if (names.length === 0) return new Map()

    const patterns = names.map((n) => `%${n.toLowerCase()}%`)
    const result = await this.pool.query(
      sql`SELECT u.id, u.email, u.name, wp.display_name
          FROM users u
          INNER JOIN workspace_members wm ON u.id = wm.user_id
          LEFT JOIN workspace_profiles wp ON u.id = wp.user_id AND wp.workspace_id = wm.workspace_id
          WHERE wm.workspace_id = ${workspaceId}
            AND wm.status = 'active'
            AND (
              LOWER(u.email) LIKE ANY(${patterns})
              OR LOWER(u.name) LIKE ANY(${patterns})
              OR LOWER(wp.display_name) LIKE ANY(${patterns})
            )`,
    )

    // Map each input name to its best matching user ID
    const resolved = new Map<string, string>()
    for (const name of names) {
      const lowerName = name.toLowerCase()
      const match = result.rows.find(
        (r) =>
          r.email.toLowerCase().includes(lowerName) ||
          r.name?.toLowerCase().includes(lowerName) ||
          r.display_name?.toLowerCase().includes(lowerName),
      )
      if (match) {
        resolved.set(name, match.id)
      }
    }

    return resolved
  }

  /**
   * Resolve stream slugs/names to stream IDs within a workspace.
   * Used by LLM tools to convert human-readable slugs to IDs.
   */
  async resolveStreamSlugs(workspaceId: string, slugs: string[]): Promise<Map<string, string>> {
    if (slugs.length === 0) return new Map()

    const lowerSlugs = slugs.map((s) => s.toLowerCase())
    const result = await this.pool.query(
      sql`SELECT id, slug, name
          FROM streams
          WHERE workspace_id = ${workspaceId}
            AND archived_at IS NULL
            AND (
              LOWER(slug) = ANY(${lowerSlugs})
              OR LOWER(name) = ANY(${lowerSlugs})
            )`,
    )

    // Map each input slug to its matching stream ID
    const resolved = new Map<string, string>()
    for (const slug of slugs) {
      const lowerSlug = slug.toLowerCase()
      const match = result.rows.find(
        (r) => r.slug?.toLowerCase() === lowerSlug || r.name?.toLowerCase() === lowerSlug,
      )
      if (match) {
        resolved.set(slug, match.id)
      }
    }

    return resolved
  }
}

