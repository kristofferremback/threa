import { PoolClient } from "pg"
import { sql } from "../db"
import type { StreamType } from "@threa/types"
import type { SearchFilters } from "../lib/search/filter-parser"

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

export interface FullTextSearchParams {
  query: string
  streamIds: string[]
  filters: SearchFilters
  limit: number
  workspaceId: string
}

export interface VectorSearchParams {
  embedding: number[]
  streamIds: string[]
  filters: SearchFilters
  limit: number
  workspaceId: string
}

export const SearchRepository = {
  /**
   * Full-text search using PostgreSQL tsvector.
   * Results are ranked by ts_rank.
   * If query is empty, returns recent messages matching filters.
   */
  async fullTextSearch(client: PoolClient, params: FullTextSearchParams): Promise<SearchResult[]> {
    const { query, streamIds, filters, limit, workspaceId } = params

    if (streamIds.length === 0) {
      return []
    }

    // Build dynamic WHERE clauses for filters
    const filterClauses = buildFilterClauses(filters, workspaceId)

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
          ${sql.raw(filterClauses)}
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
        ${sql.raw(filterClauses)}
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
    const { embedding, streamIds, filters, limit, workspaceId } = params

    if (streamIds.length === 0 || embedding.length === 0) {
      return []
    }

    // Build dynamic WHERE clauses for filters
    const filterClauses = buildFilterClauses(filters, workspaceId)

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
        ${sql.raw(filterClauses)}
      ORDER BY m.embedding <=> ${embeddingLiteral}::vector
      LIMIT ${limit}
    `)

    return result.rows.map(mapRowToSearchResult)
  },
}

/**
 * Builds SQL filter clauses from search filters.
 * Returns an empty string if no filters apply.
 */
function buildFilterClauses(filters: SearchFilters, _workspaceId: string): string {
  const clauses: string[] = []

  // from:@user - filter by author
  if (filters.from && filters.from.length > 0) {
    // Look up users by username/email (case-insensitive)
    const fromConditions = filters.from.map((username) => {
      const escaped = escapeString(username)
      return `m.author_id IN (SELECT id FROM users WHERE LOWER(email) LIKE '%${escaped}%' OR LOWER(display_name) LIKE '%${escaped}%')`
    })
    clauses.push(`(${fromConditions.join(" OR ")})`)
  }

  // is:type - filter by stream type
  if (filters.is && filters.is.length > 0) {
    const types = filters.is.map((t) => `'${escapeString(t)}'`).join(", ")
    clauses.push(`s.type IN (${types})`)
  }

  // in:#channel - filter by stream slug or name
  if (filters.in && filters.in.length > 0) {
    const inConditions = filters.in.map((channel) => {
      const escaped = escapeString(channel)
      return `(s.slug = '${escaped}' OR LOWER(s.display_name) LIKE '%${escaped}%')`
    })
    clauses.push(`(${inConditions.join(" OR ")})`)
  }

  // before:date
  if (filters.before) {
    clauses.push(`m.created_at < '${filters.before.toISOString()}'`)
  }

  // after:date
  if (filters.after) {
    clauses.push(`m.created_at > '${filters.after.toISOString()}'`)
  }

  // Note: with:@user requires checking stream membership, which is handled
  // at the service layer by filtering streamIds before calling the repository

  if (clauses.length === 0) {
    return ""
  }

  return " AND " + clauses.join(" AND ")
}

/**
 * Escapes a string for safe use in SQL.
 * Basic protection against SQL injection for dynamic values.
 */
function escapeString(value: string): string {
  return value.replace(/'/g, "''").replace(/\\/g, "\\\\")
}
