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
  authorIds?: string[] // Resolved from from:@user
  streamTypes?: StreamType[] // Validated against STREAM_TYPES
  before?: Date
  after?: Date
}

export interface FullTextSearchParams {
  query: string
  streamIds: string[]
  filters: ResolvedFilters
  limit: number
}

export interface VectorSearchParams {
  embedding: number[]
  streamIds: string[]
  filters: ResolvedFilters
  limit: number
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
          AND (${filters.authorIds === undefined || filters.authorIds.length === 0} OR m.author_id = ANY(${filters.authorIds ?? []}))
          AND (${filters.streamTypes === undefined || filters.streamTypes.length === 0} OR s.type = ANY(${filters.streamTypes ?? []}))
          AND (${filters.before === undefined} OR m.created_at < ${filters.before ?? new Date()})
          AND (${filters.after === undefined} OR m.created_at > ${filters.after ?? new Date(0)})
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
        AND (${filters.authorIds === undefined || filters.authorIds.length === 0} OR m.author_id = ANY(${filters.authorIds ?? []}))
        AND (${filters.streamTypes === undefined || filters.streamTypes.length === 0} OR s.type = ANY(${filters.streamTypes ?? []}))
        AND (${filters.before === undefined} OR m.created_at < ${filters.before ?? new Date()})
        AND (${filters.after === undefined} OR m.created_at > ${filters.after ?? new Date(0)})
      ORDER BY rank DESC
      LIMIT ${limit}
    `)

    return result.rows.map(mapRowToSearchResult)
  },

  /**
   * Vector/semantic search using pgvector.
   * Results are ranked by cosine similarity.
   */
  async vectorSearch(client: PoolClient, params: VectorSearchParams): Promise<SearchResult[]> {
    const { embedding, streamIds, filters, limit } = params

    if (streamIds.length === 0 || embedding.length === 0) {
      return []
    }

    // Format embedding as PostgreSQL vector literal
    const embeddingLiteral = `[${embedding.join(",")}]`

    const result = await client.query<SearchResultRow>(sql`
      SELECT
        m.id,
        m.stream_id,
        m.content,
        m.author_id,
        m.author_type,
        m.created_at,
        1 - (m.embedding <=> ${embeddingLiteral}::vector) as rank
      FROM messages m
      JOIN streams s ON m.stream_id = s.id
      WHERE m.stream_id = ANY(${streamIds})
        AND m.deleted_at IS NULL
        AND m.embedding IS NOT NULL
        AND (${filters.authorIds === undefined || filters.authorIds.length === 0} OR m.author_id = ANY(${filters.authorIds ?? []}))
        AND (${filters.streamTypes === undefined || filters.streamTypes.length === 0} OR s.type = ANY(${filters.streamTypes ?? []}))
        AND (${filters.before === undefined} OR m.created_at < ${filters.before ?? new Date()})
        AND (${filters.after === undefined} OR m.created_at > ${filters.after ?? new Date(0)})
      ORDER BY m.embedding <=> ${embeddingLiteral}::vector
      LIMIT ${limit}
    `)

    return result.rows.map(mapRowToSearchResult)
  },
}
