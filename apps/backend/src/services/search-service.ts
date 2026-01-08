import { Pool, PoolClient } from "pg"
import { withClient } from "../db"
import { SearchRepository, type SearchResult, type ResolvedFilters } from "../repositories/search-repository"
import type { EmbeddingServiceLike } from "./embedding-service"
import { logger } from "../lib/logger"
import type { StreamType } from "@threa/types"

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
  userId: string
  query: string
  filters?: SearchFilters
  limit?: number
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
   */
  async search(params: SearchParams): Promise<SearchResult[]> {
    const { workspaceId, userId, query, filters = {}, limit = DEFAULT_LIMIT } = params

    logger.debug({ query, filters, workspaceId, userId }, "Search request")

    // Generate embedding for search query (do this before DB connection)
    let embedding: number[] = []
    if (query.trim()) {
      try {
        embedding = await this.embeddingService.embed(query, { workspaceId })
      } catch (error) {
        logger.warn({ error }, "Failed to generate embedding, falling back to keyword-only search")
      }
    }

    return withClient(this.pool, async (client) => {
      // 1. Get accessible stream IDs for this user
      const streamIds = await this.getAccessibleStreamIds(client, workspaceId, userId, filters)

      if (streamIds.length === 0) {
        logger.debug({ workspaceId, userId }, "No accessible streams for user")
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

      // 3. If no search terms, return recent messages
      if (!query.trim()) {
        return SearchRepository.fullTextSearch(client, {
          query: "",
          streamIds,
          filters: repoFilters,
          limit,
        })
      }

      // 4. If no embedding (generation failed), fall back to keyword-only
      if (embedding.length === 0) {
        return SearchRepository.fullTextSearch(client, {
          query,
          streamIds,
          filters: repoFilters,
          limit,
        })
      }

      // 5. Full hybrid search with RRF ranking in a single query
      return SearchRepository.hybridSearch(client, {
        query,
        embedding,
        streamIds,
        filters: repoFilters,
        limit,
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
    userId: string,
    filters: SearchFilters
  ): Promise<string[]> {
    // Use combined query for access + member filtering
    const accessibleStreamIds = await SearchRepository.getAccessibleStreamsWithMembers(client, {
      workspaceId,
      userId,
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
