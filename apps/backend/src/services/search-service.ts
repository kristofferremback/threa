import { Pool, PoolClient } from "pg"
import { withClient } from "../db"
import { SearchRepository, type SearchResult, type ResolvedFilters } from "../repositories/search-repository"
import { StreamRepository } from "../repositories/stream-repository"
import { StreamMemberRepository } from "../repositories/stream-member-repository"
import { combineWithRRF } from "../lib/search/rrf"
import { EmbeddingService } from "./embedding-service"
import { logger } from "../lib/logger"
import type { StreamType } from "@threa/types"

/**
 * Client-provided filters with pre-resolved IDs.
 * All lookups (username to ID, etc.) happen client-side.
 */
export interface SearchFilters {
  authorId?: string // Single author (from:@user)
  withUserIds?: string[] // Multiple users, AND logic (with:@user)
  streamIds?: string[] // Stream IDs (in:#channel)
  streamTypes?: StreamType[] // Stream types, OR logic (is:type)
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
  embeddingService: EmbeddingService
}

const DEFAULT_LIMIT = 20
const INTERNAL_LIMIT = 50

export class SearchService {
  private pool: Pool
  private embeddingService: EmbeddingService

  constructor(deps: SearchServiceDependencies) {
    this.pool = deps.pool
    this.embeddingService = deps.embeddingService
  }

  /**
   * Perform hybrid search combining full-text and semantic search.
   */
  async search(params: SearchParams): Promise<SearchResult[]> {
    const { workspaceId, userId, query, filters = {}, limit = DEFAULT_LIMIT } = params

    logger.debug({ query, filters, workspaceId, userId }, "Search request")

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

      // 3. Run searches
      const searchParams = {
        streamIds,
        filters: repoFilters,
        limit: INTERNAL_LIMIT,
      }

      // If no search terms, skip keyword/semantic search and just return recent messages
      if (!query.trim()) {
        return this.getRecentMessages(client, streamIds, repoFilters, limit)
      }

      // Run both searches in parallel
      const [keywordResults, semanticResults] = await Promise.all([
        this.fullTextSearch(client, query, searchParams),
        this.semanticSearch(query, searchParams),
      ])

      logger.debug(
        { keywordResults: keywordResults.length, semanticResults: semanticResults.length },
        "Search results before RRF"
      )

      // 4. Combine with RRF
      const combined = combineWithRRF(keywordResults, semanticResults, {
        keywordWeight: 0.6,
        semanticWeight: 0.4,
        k: 60,
      })

      return combined.slice(0, limit)
    })
  }

  /**
   * Get stream IDs the user can access, optionally filtered by search filters.
   */
  private async getAccessibleStreamIds(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    filters: SearchFilters
  ): Promise<string[]> {
    // If specific stream IDs provided, verify user has access
    if (filters.streamIds && filters.streamIds.length > 0) {
      return this.filterAccessibleStreams(client, workspaceId, userId, filters.streamIds, filters)
    }

    // Get all streams user is a member of
    const memberships = await StreamMemberRepository.list(client, { userId })
    const memberStreamIds = new Set(memberships.map((m) => m.streamId))

    // Get public streams in workspace
    const allStreams = await StreamRepository.list(client, workspaceId, {
      types: filters.streamTypes,
      userMembershipStreamIds: [...memberStreamIds],
    })

    // Apply with:user filter - only streams where the specified users are also members
    let accessibleStreams = allStreams
    if (filters.withUserIds && filters.withUserIds.length > 0) {
      accessibleStreams = await this.filterStreamsByUserMembership(client, allStreams, filters.withUserIds)
    }

    return accessibleStreams.map((s) => s.id)
  }

  /**
   * Filter requested stream IDs to only those the user can access.
   */
  private async filterAccessibleStreams(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    requestedStreamIds: string[],
    filters: SearchFilters
  ): Promise<string[]> {
    // Get user memberships
    const memberships = await StreamMemberRepository.list(client, { userId })
    const memberStreamIds = new Set(memberships.map((m) => m.streamId))

    // Get public streams in workspace
    const allStreams = await StreamRepository.list(client, workspaceId, {
      types: filters.streamTypes,
      userMembershipStreamIds: [...memberStreamIds],
    })
    const accessibleIds = new Set(allStreams.map((s) => s.id))

    // Filter to requested streams that user can access
    let result = requestedStreamIds.filter((id) => accessibleIds.has(id))

    // Apply with:user filter if present
    if (filters.withUserIds && filters.withUserIds.length > 0 && result.length > 0) {
      const validStreamIds = await StreamMemberRepository.filterStreamsWithAllUsers(client, result, filters.withUserIds)
      result = result.filter((id) => validStreamIds.has(id))
    }

    return result
  }

  /**
   * Filter streams to only those where all specified users are members.
   * Uses a single batch query instead of N+1 queries.
   */
  private async filterStreamsByUserMembership<T extends { id: string }>(
    client: PoolClient,
    streams: T[],
    userIds: string[]
  ): Promise<T[]> {
    if (streams.length === 0 || userIds.length === 0) {
      return streams
    }

    // Use batch query to find streams where all users are members
    const streamIds = streams.map((s) => s.id)
    const validStreamIds = await StreamMemberRepository.filterStreamsWithAllUsers(client, streamIds, userIds)

    return streams.filter((s) => validStreamIds.has(s.id))
  }

  /**
   * Full-text search using PostgreSQL tsvector.
   */
  private async fullTextSearch(
    client: PoolClient,
    terms: string,
    params: { streamIds: string[]; filters: ResolvedFilters; limit: number }
  ): Promise<SearchResult[]> {
    return SearchRepository.fullTextSearch(client, {
      query: terms,
      streamIds: params.streamIds,
      filters: params.filters,
      limit: params.limit,
    })
  }

  /**
   * Semantic search using pgvector.
   */
  private async semanticSearch(
    terms: string,
    params: { streamIds: string[]; filters: ResolvedFilters; limit: number }
  ): Promise<SearchResult[]> {
    try {
      // Generate embedding for search query
      const embedding = await this.embeddingService.embed(terms)

      return withClient(this.pool, (client) =>
        SearchRepository.vectorSearch(client, {
          embedding,
          streamIds: params.streamIds,
          filters: params.filters,
          limit: params.limit,
        })
      )
    } catch (error) {
      // Log but don't fail - semantic search is enhancement, not critical
      logger.warn({ error }, "Semantic search failed, falling back to keyword-only")
      return []
    }
  }

  /**
   * Get recent messages when no search terms are provided.
   * Used for filter-only queries like "is:thread from:@jane"
   */
  private async getRecentMessages(
    client: PoolClient,
    streamIds: string[],
    filters: ResolvedFilters,
    limit: number
  ): Promise<SearchResult[]> {
    if (streamIds.length === 0) {
      return []
    }

    return SearchRepository.fullTextSearch(client, {
      query: "",
      streamIds,
      filters,
      limit,
    })
  }
}
