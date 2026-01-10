import type { Querier } from "../db"
import { sql } from "../db"
import { Visibilities, type StreamType } from "@threa/types"
import { parseArchiveStatusFilter, type ArchiveStatus } from "../lib/sql-filters"
import type { AgentAccessSpec } from "../agents/researcher/access-spec"

export interface GetAccessibleStreamsParams {
  workspaceId: string
  userId: string
  memberIds?: string[] // Can mix user_xxx and persona_xxx - ID prefix distinguishes
  streamTypes?: StreamType[]
  archiveStatus?: ArchiveStatus[] // ["active"] = active only, ["archived"] = archived only, ["active", "archived"] = all
}

export interface SearchResult {
  id: string
  streamId: string
  content: string
  authorId: string
  authorType: "user" | "persona"
  createdAt: Date
  rank: number
}

interface SearchResultRow {
  id: string
  stream_id: string
  content: string
  author_id: string
  author_type: string
  created_at: Date
  rank: number
}

function mapRowToSearchResult(row: SearchResultRow): SearchResult {
  return {
    id: row.id,
    streamId: row.stream_id,
    content: row.content,
    authorId: row.author_id,
    authorType: row.author_type as "user" | "persona",
    createdAt: row.created_at,
    rank: row.rank,
  }
}

/**
 * Resolved filters with validated/looked-up values.
 * All user-provided strings have been resolved to safe IDs or validated values.
 */
export interface ResolvedFilters {
  authorId?: string // Single author (from:@user)
  streamTypes?: StreamType[] // Stream types, OR logic (is:type)
  before?: Date // Exclusive (<)
  after?: Date // Inclusive (>=)
}

export interface FullTextSearchParams {
  query: string
  streamIds: string[]
  filters: ResolvedFilters
  limit: number
}

export interface HybridSearchParams {
  query: string
  embedding: number[]
  streamIds: string[]
  filters: ResolvedFilters
  limit: number
  keywordWeight?: number
  semanticWeight?: number
  k?: number
}

export const SearchRepository = {
  /**
   * Get stream IDs that a user can access, optionally filtered by required members.
   * Combines access control + member filtering in ONE query.
   *
   * Access rules:
   * - User is a member of the stream, OR
   * - Stream is public, OR
   * - For threads: user can access the root stream (member OR root is public)
   *
   * Member filtering (AND logic):
   * - If memberIds provided, stream must have ALL specified members
   * - Members can be users (stream_members) or personas (stream_persona_participants)
   *
   * Archive status:
   * - ["active"] (default) → only non-archived streams
   * - ["archived"] → only archived streams
   * - ["active", "archived"] → all streams
   */
  async getAccessibleStreamsWithMembers(db: Querier, params: GetAccessibleStreamsParams): Promise<string[]> {
    const { workspaceId, userId, memberIds, streamTypes, archiveStatus } = params
    const hasMemberFilter = memberIds && memberIds.length > 0
    const hasTypeFilter = streamTypes && streamTypes.length > 0

    const { includeActive, includeArchived, filterAll } = parseArchiveStatusFilter(archiveStatus)

    // If no member filter, simpler query
    if (!hasMemberFilter) {
      const result = await db.query<{ id: string }>(sql`
        SELECT DISTINCT s.id
        FROM streams s
        LEFT JOIN stream_members sm ON s.id = sm.stream_id AND sm.user_id = ${userId}
        LEFT JOIN streams root ON s.root_stream_id = root.id
        LEFT JOIN stream_members root_sm ON root.id = root_sm.stream_id AND root_sm.user_id = ${userId}
        WHERE s.workspace_id = ${workspaceId}
          AND (
            sm.user_id IS NOT NULL
            OR s.visibility = ${Visibilities.PUBLIC}
            OR (s.root_stream_id IS NOT NULL AND (root_sm.user_id IS NOT NULL OR root.visibility = ${Visibilities.PUBLIC}))
          )
          AND (${!hasTypeFilter} OR s.type = ANY(${streamTypes ?? []}))
          AND (${filterAll} OR (${includeArchived} AND s.archived_at IS NOT NULL) OR (${!includeArchived} AND s.archived_at IS NULL))
      `)
      return result.rows.map((r) => r.id)
    }

    // With member filter: combined query using UNION for users + personas
    const result = await db.query<{ id: string }>(sql`
      WITH accessible AS (
        SELECT DISTINCT s.id
        FROM streams s
        LEFT JOIN stream_members sm ON s.id = sm.stream_id AND sm.user_id = ${userId}
        LEFT JOIN streams root ON s.root_stream_id = root.id
        LEFT JOIN stream_members root_sm ON root.id = root_sm.stream_id AND root_sm.user_id = ${userId}
        WHERE s.workspace_id = ${workspaceId}
          AND (
            sm.user_id IS NOT NULL
            OR s.visibility = ${Visibilities.PUBLIC}
            OR (s.root_stream_id IS NOT NULL AND (root_sm.user_id IS NOT NULL OR root.visibility = ${Visibilities.PUBLIC}))
          )
          AND (${!hasTypeFilter} OR s.type = ANY(${streamTypes ?? []}))
          AND (${filterAll} OR (${includeArchived} AND s.archived_at IS NOT NULL) OR (${!includeArchived} AND s.archived_at IS NULL))
      ),
      member_streams AS (
        SELECT stream_id
        FROM (
          SELECT stream_id, user_id AS member_id
          FROM stream_members
          WHERE user_id = ANY(${memberIds})
          UNION ALL
          SELECT stream_id, persona_id AS member_id
          FROM stream_persona_participants
          WHERE persona_id = ANY(${memberIds})
        ) t
        GROUP BY stream_id
        HAVING COUNT(DISTINCT member_id) = ${memberIds.length}
      )
      SELECT a.id
      FROM accessible a
      JOIN member_streams m ON a.id = m.stream_id
    `)

    return result.rows.map((r) => r.id)
  },

  /**
   * Full-text search using PostgreSQL tsvector with websearch syntax.
   * Supports quoted phrases for exact matching: "chicken wingz"
   * Results are ranked by ts_rank.
   * If query is empty, returns recent messages matching filters.
   */
  async fullTextSearch(db: Querier, params: FullTextSearchParams): Promise<SearchResult[]> {
    const { query, streamIds, filters, limit } = params

    if (streamIds.length === 0) {
      return []
    }

    // If no search terms, return recent messages matching filters
    if (!query.trim()) {
      const result = await db.query<SearchResultRow>(sql`
        SELECT
          m.id,
          m.stream_id,
          m.content,
          m.author_id,
          m.author_type,
          m.created_at,
          0 as rank
        FROM messages m
        JOIN streams s ON m.stream_id = s.id
        WHERE m.stream_id = ANY(${streamIds})
          AND m.deleted_at IS NULL
          AND (${filters.authorId === undefined} OR m.author_id = ${filters.authorId ?? ""})
          AND (${filters.streamTypes === undefined || filters.streamTypes.length === 0} OR s.type = ANY(${filters.streamTypes ?? []}))
          AND (${filters.before === undefined} OR m.created_at < ${filters.before ?? new Date()})
          AND (${filters.after === undefined} OR m.created_at >= ${filters.after ?? new Date(0)})
        ORDER BY m.created_at DESC
        LIMIT ${limit}
      `)
      return result.rows.map(mapRowToSearchResult)
    }

    const result = await db.query<SearchResultRow>(sql`
      SELECT
        m.id,
        m.stream_id,
        m.content,
        m.author_id,
        m.author_type,
        m.created_at,
        ts_rank(m.search_vector, websearch_to_tsquery('english', ${query})) as rank
      FROM messages m
      JOIN streams s ON m.stream_id = s.id
      WHERE m.stream_id = ANY(${streamIds})
        AND m.deleted_at IS NULL
        AND m.search_vector @@ websearch_to_tsquery('english', ${query})
        AND (${filters.authorId === undefined} OR m.author_id = ${filters.authorId ?? ""})
        AND (${filters.streamTypes === undefined || filters.streamTypes.length === 0} OR s.type = ANY(${filters.streamTypes ?? []}))
        AND (${filters.before === undefined} OR m.created_at < ${filters.before ?? new Date()})
        AND (${filters.after === undefined} OR m.created_at >= ${filters.after ?? new Date(0)})
      ORDER BY rank DESC
      LIMIT ${limit}
    `)

    return result.rows.map(mapRowToSearchResult)
  },

  /**
   * Hybrid search combining full-text and semantic search with RRF ranking.
   * Supports quoted phrases for exact matching: "chicken wingz"
   * All done in a single query using CTEs.
   *
   * RRF formula: score(d) = Σ(weight / (k + rank(d)))
   */
  async hybridSearch(db: Querier, params: HybridSearchParams): Promise<SearchResult[]> {
    const { query, embedding, streamIds, filters, limit, keywordWeight = 0.6, semanticWeight = 0.4, k = 60 } = params

    if (streamIds.length === 0) {
      return []
    }

    // Format embedding as PostgreSQL vector literal
    const embeddingLiteral = `[${embedding.join(",")}]`

    // Internal limit for each search type before RRF combination
    const internalLimit = 50

    const result = await db.query<SearchResultRow>(sql`
      WITH keyword_ranked AS (
        SELECT
          m.id,
          m.stream_id,
          m.content,
          m.author_id,
          m.author_type,
          m.created_at,
          ROW_NUMBER() OVER (ORDER BY ts_rank(m.search_vector, websearch_to_tsquery('english', ${query})) DESC) as rank
        FROM messages m
        JOIN streams s ON m.stream_id = s.id
        WHERE m.stream_id = ANY(${streamIds})
          AND m.deleted_at IS NULL
          AND m.search_vector @@ websearch_to_tsquery('english', ${query})
          AND (${filters.authorId === undefined} OR m.author_id = ${filters.authorId ?? ""})
          AND (${filters.streamTypes === undefined || filters.streamTypes.length === 0} OR s.type = ANY(${filters.streamTypes ?? []}))
          AND (${filters.before === undefined} OR m.created_at < ${filters.before ?? new Date()})
          AND (${filters.after === undefined} OR m.created_at >= ${filters.after ?? new Date(0)})
        LIMIT ${internalLimit}
      ),
      semantic_ranked AS (
        SELECT
          m.id,
          m.stream_id,
          m.content,
          m.author_id,
          m.author_type,
          m.created_at,
          ROW_NUMBER() OVER (ORDER BY m.embedding <=> ${embeddingLiteral}::vector) as rank
        FROM messages m
        JOIN streams s ON m.stream_id = s.id
        WHERE m.stream_id = ANY(${streamIds})
          AND m.deleted_at IS NULL
          AND m.embedding IS NOT NULL
          AND (${filters.authorId === undefined} OR m.author_id = ${filters.authorId ?? ""})
          AND (${filters.streamTypes === undefined || filters.streamTypes.length === 0} OR s.type = ANY(${filters.streamTypes ?? []}))
          AND (${filters.before === undefined} OR m.created_at < ${filters.before ?? new Date()})
          AND (${filters.after === undefined} OR m.created_at >= ${filters.after ?? new Date(0)})
        LIMIT ${internalLimit}
      ),
      rrf_combined AS (
        SELECT
          COALESCE(k.id, s.id) as id,
          COALESCE(k.stream_id, s.stream_id) as stream_id,
          COALESCE(k.content, s.content) as content,
          COALESCE(k.author_id, s.author_id) as author_id,
          COALESCE(k.author_type, s.author_type) as author_type,
          COALESCE(k.created_at, s.created_at) as created_at,
          COALESCE(${keywordWeight}::float / (${k}::float + k.rank), 0) +
          COALESCE(${semanticWeight}::float / (${k}::float + s.rank), 0) as rank
        FROM keyword_ranked k
        FULL OUTER JOIN semantic_ranked s ON k.id = s.id
      )
      SELECT * FROM rrf_combined
      ORDER BY rank DESC
      LIMIT ${limit}
    `)

    return result.rows.map(mapRowToSearchResult)
  },

  /**
   * Exact substring search using ILIKE.
   * Finds messages containing the query as a literal substring.
   * Results are ordered by recency (most recent first).
   *
   * Use this for error messages, IDs, or other literal text matching.
   */
  async exactSearch(db: Querier, params: FullTextSearchParams): Promise<SearchResult[]> {
    const { query, streamIds, filters, limit } = params

    if (streamIds.length === 0 || !query.trim()) {
      return []
    }

    // Escape special LIKE characters (%, _, \) in the query
    const escapedQuery = query.replace(/[%_\\]/g, "\\$&")

    const result = await db.query<SearchResultRow>(sql`
      SELECT
        m.id,
        m.stream_id,
        m.content,
        m.author_id,
        m.author_type,
        m.created_at,
        0 as rank
      FROM messages m
      JOIN streams s ON m.stream_id = s.id
      WHERE m.stream_id = ANY(${streamIds})
        AND m.deleted_at IS NULL
        AND m.content ILIKE '%' || ${escapedQuery} || '%'
        AND (${filters.authorId === undefined} OR m.author_id = ${filters.authorId ?? ""})
        AND (${filters.streamTypes === undefined || filters.streamTypes.length === 0} OR s.type = ANY(${filters.streamTypes ?? []}))
        AND (${filters.before === undefined} OR m.created_at < ${filters.before ?? new Date()})
        AND (${filters.after === undefined} OR m.created_at >= ${filters.after ?? new Date(0)})
      ORDER BY m.created_at DESC
      LIMIT ${limit}
    `)

    return result.rows.map(mapRowToSearchResult)
  },

  /**
   * Get public stream IDs in a workspace.
   * Used by agent access control for public_only access spec.
   */
  async getPublicStreams(
    db: Querier,
    workspaceId: string,
    options?: { streamTypes?: StreamType[]; archiveStatus?: ArchiveStatus[] }
  ): Promise<string[]> {
    const hasTypeFilter = options?.streamTypes && options.streamTypes.length > 0
    const { includeActive, includeArchived, filterAll } = parseArchiveStatusFilter(options?.archiveStatus)

    const result = await db.query<{ id: string }>(sql`
      SELECT id FROM streams
      WHERE workspace_id = ${workspaceId}
        AND visibility = ${Visibilities.PUBLIC}
        AND (${!hasTypeFilter} OR type = ANY(${options?.streamTypes ?? []}))
        AND (${filterAll} OR (${includeArchived} AND archived_at IS NOT NULL) OR (${!includeArchived} AND archived_at IS NULL))
    `)

    return result.rows.map((r) => r.id)
  },

  /**
   * Get a stream and all its thread descendants.
   * Used by agent access control for public_plus_stream access spec.
   */
  async getStreamWithThreads(db: Querier, streamId: string): Promise<string[]> {
    // Get the stream itself and any threads that have this stream as root
    const result = await db.query<{ id: string }>(sql`
      SELECT id FROM streams
      WHERE id = ${streamId} OR root_stream_id = ${streamId}
    `)

    return result.rows.map((r) => r.id)
  },

  /**
   * Get accessible streams for an agent based on its access spec.
   *
   * Unlike getAccessibleStreamsWithMembers (which determines what a USER can access),
   * this determines what an AGENT can access based on invocation context.
   *
   * Access specs:
   * - user_full_access: Everything the specified user can access
   * - public_only: Only public streams
   * - public_plus_stream: Public streams + a specific stream and its threads
   * - user_union: Union of what multiple users can access (for DMs)
   */
  async getAccessibleStreamsForAgent(
    db: Querier,
    spec: AgentAccessSpec,
    workspaceId: string,
    options?: { streamTypes?: StreamType[]; archiveStatus?: ArchiveStatus[] }
  ): Promise<string[]> {
    switch (spec.type) {
      case "user_full_access":
        // Delegate to existing user access method
        return this.getAccessibleStreamsWithMembers(db, {
          workspaceId,
          userId: spec.userId,
          streamTypes: options?.streamTypes,
          archiveStatus: options?.archiveStatus,
        })

      case "public_only":
        return this.getPublicStreams(db, workspaceId, options)

      case "public_plus_stream": {
        // Get public streams and the specific stream with its threads
        const [publicIds, streamTreeIds] = await Promise.all([
          this.getPublicStreams(db, workspaceId, options),
          this.getStreamWithThreads(db, spec.streamId),
        ])

        // Combine and deduplicate
        return [...new Set([...publicIds, ...streamTreeIds])]
      }

      case "user_union": {
        // Get accessible streams for each user and union them
        const allResults = await Promise.all(
          spec.userIds.map((userId) =>
            this.getAccessibleStreamsWithMembers(db, {
              workspaceId,
              userId,
              streamTypes: options?.streamTypes,
              archiveStatus: options?.archiveStatus,
            })
          )
        )

        // Union all results
        return [...new Set(allResults.flat())]
      }
    }
  },
}
