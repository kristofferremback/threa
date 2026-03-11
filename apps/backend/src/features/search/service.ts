import { Pool } from "pg"
import { SearchRepository, type SearchResult, type ResolvedFilters } from "./repository"
import type { EmbeddingServiceLike } from "../memos"
import { logger } from "../../lib/logger"
import type { StreamType } from "@threa/types"
import { SEMANTIC_DISTANCE_THRESHOLD } from "./config"

export type ArchiveStatus = "active" | "archived"

/**
 * Client-provided filters with pre-resolved IDs.
 * All lookups (username to ID, etc.) happen client-side.
 */
export interface SearchFilters {
  authorId?: string // Single author (from:@user)
  userIds?: string[] // Multiple users/personas, AND logic (with:@user or with:@persona)
  streamIds?: string[] // Stream IDs (in:#channel)
  streamTypes?: StreamType[] // Stream types, OR logic (type:scratchpad)
  archiveStatus?: ArchiveStatus[] // Archive status (is:archived, is:active)
  before?: Date // Exclusive (<)
  after?: Date // Inclusive (>=)
}

/**
 * Caller-resolved access boundary.
 * The caller resolves what the requester can see and passes it here.
 * This keeps SearchService auth-agnostic.
 */
export interface SearchPermissions {
  accessibleStreamIds: string[]
}

export interface SearchParams {
  workspaceId: string
  permissions: SearchPermissions
  query: string
  filters?: SearchFilters
  limit?: number
  /** If true, use exact substring matching (ILIKE) instead of full-text search */
  exact?: boolean
}

export interface SearchServiceDependencies {
  pool: Pool
  embeddingService: EmbeddingServiceLike
}

const DEFAULT_LIMIT = 20

export class SearchService {
  private pool: Pool
  private embeddingService: EmbeddingServiceLike

  constructor(deps: SearchServiceDependencies) {
    this.pool = deps.pool
    this.embeddingService = deps.embeddingService
  }

  /**
   * Perform hybrid search combining full-text and semantic search.
   * Uses a single SQL query with RRF ranking.
   *
   * When exact=true, uses ILIKE for true substring matching instead of full-text search.
   * This is useful for error messages, IDs, or other literal text.
   *
   * The caller resolves access boundaries and passes them via `permissions`.
   * This keeps SearchService auth-agnostic — it works for session auth, API keys, and agents.
   */
  async search(params: SearchParams): Promise<SearchResult[]> {
    const { workspaceId, permissions, query, filters = {}, limit = DEFAULT_LIMIT, exact = false } = params

    logger.debug({ query, filters, workspaceId, exact }, "Search request")

    // Intersect caller-provided accessible streams with any filter-requested streams
    const streamIds = this.resolveStreamIds(permissions.accessibleStreamIds, filters)

    if (streamIds.length === 0) {
      logger.debug({ workspaceId }, "No accessible streams")
      return []
    }

    const repoFilters: ResolvedFilters = {
      authorId: filters.authorId,
      streamTypes: filters.streamTypes,
      before: filters.before,
      after: filters.after,
    }

    // For exact matching, skip embedding generation - use ILIKE directly (INV-30: single query, pass pool)
    if (exact) {
      return SearchRepository.exactSearch(this.pool, {
        query,
        streamIds,
        filters: repoFilters,
        limit,
      })
    }

    // Generate embedding for search query (do this before DB connection - INV-41)
    let embedding: number[] = []
    if (query.trim()) {
      try {
        embedding = await this.embeddingService.embed(query, { workspaceId, functionId: "search-query" })
      } catch (error) {
        logger.warn({ error }, "Failed to generate embedding, falling back to keyword-only search")
      }
    }

    // INV-30: each branch issues a single query, pass pool directly
    const normalizedQuery = query.trim()
    const hasQuery = normalizedQuery.length > 0
    const hasEmbedding = embedding.length > 0

    if (!hasQuery || !hasEmbedding) {
      return SearchRepository.fullTextSearch(this.pool, {
        query: normalizedQuery,
        streamIds,
        filters: repoFilters,
        limit,
      })
    }

    return SearchRepository.hybridSearch(this.pool, {
      query: normalizedQuery,
      embedding,
      streamIds,
      filters: repoFilters,
      limit,
      semanticDistanceThreshold: SEMANTIC_DISTANCE_THRESHOLD,
    })
  }

  /**
   * Intersect caller-provided accessible streams with user-requested stream filter.
   * If the user doesn't filter by stream, use all accessible streams.
   */
  private resolveStreamIds(accessibleStreamIds: string[], filters: SearchFilters): string[] {
    if (filters.streamIds && filters.streamIds.length > 0) {
      const accessibleSet = new Set(accessibleStreamIds)
      return filters.streamIds.filter((id) => accessibleSet.has(id))
    }
    return accessibleStreamIds
  }
}
