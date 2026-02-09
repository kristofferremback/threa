import { Pool, PoolClient } from "pg"
import { withClient } from "../../db"
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
  memberIds?: string[] // Multiple users/personas, AND logic (with:@user or with:@persona)
  streamIds?: string[] // Stream IDs (in:#channel)
  streamTypes?: StreamType[] // Stream types, OR logic (type:scratchpad)
  archiveStatus?: ArchiveStatus[] // Archive status (is:archived, is:active)
  before?: Date // Exclusive (<)
  after?: Date // Inclusive (>=)
}

export interface SearchParams {
  workspaceId: string
  memberId: string
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
   */
  async search(params: SearchParams): Promise<SearchResult[]> {
    const { workspaceId, memberId, query, filters = {}, limit = DEFAULT_LIMIT, exact = false } = params

    logger.debug({ query, filters, workspaceId, memberId, exact }, "Search request")

    // For exact matching, skip embedding generation - use ILIKE directly
    if (exact) {
      return withClient(this.pool, async (client) => {
        const streamIds = await this.getAccessibleStreamIds(client, workspaceId, memberId, filters)

        if (streamIds.length === 0) {
          logger.debug({ workspaceId, memberId }, "No accessible streams for member")
          return []
        }

        const repoFilters: ResolvedFilters = {
          authorId: filters.authorId,
          streamTypes: filters.streamTypes,
          before: filters.before,
          after: filters.after,
        }

        return SearchRepository.exactSearch(client, {
          query,
          streamIds,
          filters: repoFilters,
          limit,
        })
      })
    }

    // Generate embedding for search query (do this before DB connection)
    let embedding: number[] = []
    if (query.trim()) {
      try {
        embedding = await this.embeddingService.embed(query, { workspaceId, functionId: "search-query" })
      } catch (error) {
        logger.warn({ error }, "Failed to generate embedding, falling back to keyword-only search")
      }
    }

    return withClient(this.pool, async (client) => {
      // 1. Get accessible stream IDs for this member
      const streamIds = await this.getAccessibleStreamIds(client, workspaceId, memberId, filters)

      if (streamIds.length === 0) {
        logger.debug({ workspaceId, memberId }, "No accessible streams for member")
        return []
      }

      logger.debug({ streamIds: streamIds.length }, "Found accessible streams")

      // 2. Map client filters to repository filters
      const repoFilters: ResolvedFilters = {
        authorId: filters.authorId,
        streamTypes: filters.streamTypes,
        before: filters.before,
        after: filters.after,
      }

      const normalizedQuery = query.trim()
      const hasQuery = normalizedQuery.length > 0
      const hasEmbedding = embedding.length > 0

      if (!hasQuery || !hasEmbedding) {
        return SearchRepository.fullTextSearch(client, {
          query: normalizedQuery,
          streamIds,
          filters: repoFilters,
          limit,
        })
      }

      return SearchRepository.hybridSearch(client, {
        query: normalizedQuery,
        embedding,
        streamIds,
        filters: repoFilters,
        limit,
        semanticDistanceThreshold: SEMANTIC_DISTANCE_THRESHOLD,
      })
    })
  }

  /**
   * Get stream IDs the user can access, optionally filtered by search filters.
   * Uses combined query for access control + member filtering.
   */
  private async getAccessibleStreamIds(
    client: PoolClient,
    workspaceId: string,
    memberId: string,
    filters: SearchFilters
  ): Promise<string[]> {
    // Use combined query for access + member filtering
    const accessibleStreamIds = await SearchRepository.getAccessibleStreamsWithMembers(client, {
      workspaceId,
      memberId,
      memberIds: filters.memberIds,
      streamTypes: filters.streamTypes,
      archiveStatus: filters.archiveStatus,
    })

    // If specific stream IDs requested, filter to those
    if (filters.streamIds && filters.streamIds.length > 0) {
      const requestedSet = new Set(filters.streamIds)
      return accessibleStreamIds.filter((id) => requestedSet.has(id))
    }

    return accessibleStreamIds
  }
}
