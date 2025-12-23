import { PoolClient } from "pg"
import { sql } from "../db"
import type { StreamType } from "@threa/types"

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
   * Full-text search using PostgreSQL tsvector.
   * Results are ranked by ts_rank.
   * If query is empty, returns recent messages matching filters.
   */
  async fullTextSearch(client: PoolClient, params: FullTextSearchParams): Promise<SearchResult[]> {
    const { query, streamIds, filters, limit } = params

    if (streamIds.length === 0) {
      return []
    }

    // If no search terms, return recent messages matching filters
    if (!query.trim()) {
      const result = await client.query<SearchResultRow>(sql`
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

    const result = await client.query<SearchResultRow>(sql`
      SELECT
        m.id,
        m.stream_id,
        m.content,
        m.author_id,
        m.author_type,
        m.created_at,
        ts_rank(m.search_vector, plainto_tsquery('english', ${query})) as rank
      FROM messages m
      JOIN streams s ON m.stream_id = s.id
      WHERE m.stream_id = ANY(${streamIds})
        AND m.deleted_at IS NULL
        AND m.search_vector @@ plainto_tsquery('english', ${query})
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
   * All done in a single query using CTEs.
   *
   * RRF formula: score(d) = Σ(weight / (k + rank(d)))
   */
  async hybridSearch(client: PoolClient, params: HybridSearchParams): Promise<SearchResult[]> {
    const { query, embedding, streamIds, filters, limit, keywordWeight = 0.6, semanticWeight = 0.4, k = 60 } = params

    if (streamIds.length === 0) {
      return []
    }

    // Format embedding as PostgreSQL vector literal
    const embeddingLiteral = `[${embedding.join(",")}]`

    // Internal limit for each search type before RRF combination
    const internalLimit = 50

    const result = await client.query<SearchResultRow>(sql`
      WITH keyword_ranked AS (
        SELECT
          m.id,
          m.stream_id,
          m.content,
          m.author_id,
          m.author_type,
          m.created_at,
          ROW_NUMBER() OVER (ORDER BY ts_rank(m.search_vector, plainto_tsquery('english', ${query})) DESC) as rank
        FROM messages m
        JOIN streams s ON m.stream_id = s.id
        WHERE m.stream_id = ANY(${streamIds})
          AND m.deleted_at IS NULL
          AND m.search_vector @@ plainto_tsquery('english', ${query})
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
}
