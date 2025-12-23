import { Pool, PoolClient } from "pg"
import { withClient } from "../db"
import { SearchRepository, type SearchResult, type ResolvedFilters } from "../repositories/search-repository"
import { StreamRepository } from "../repositories/stream-repository"
import { StreamMemberRepository } from "../repositories/stream-member-repository"
import { UserRepository } from "../repositories/user-repository"
import { parseQuery, type ParsedQuery } from "../lib/search/filter-parser"
import { combineWithRRF } from "../lib/search/rrf"
import { EmbeddingService } from "./embedding-service"
import { logger } from "../lib/logger"

export interface SearchParams {
  workspaceId: string
  userId: string
  query: string
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
    const { workspaceId, userId, query, limit = DEFAULT_LIMIT } = params

    // 1. Parse query into terms and filters
    const parsed = parseQuery(query)

    logger.debug({ parsed, workspaceId, userId }, "Search query parsed")

    return withClient(this.pool, async (client) => {
      // 2. Resolve filters to safe values (user IDs, validated types)
      const resolvedFilters = await this.resolveFilters(client, parsed.filters)

      // 3. Get accessible stream IDs for this user
      const streamIds = await this.getAccessibleStreamIds(client, workspaceId, userId, parsed)

      if (streamIds.length === 0) {
        logger.debug({ workspaceId, userId }, "No accessible streams for user")
        return []
      }

      logger.debug({ streamIds: streamIds.length }, "Found accessible streams")

      // 4. Run searches
      const searchParams = {
        streamIds,
        filters: resolvedFilters,
        limit: INTERNAL_LIMIT,
      }

      // If no search terms, skip keyword/semantic search and just return recent messages
      if (!parsed.terms.trim()) {
        return this.getRecentMessages(client, streamIds, resolvedFilters, limit)
      }

      // Run both searches in parallel
      const [keywordResults, semanticResults] = await Promise.all([
        this.fullTextSearch(client, parsed.terms, searchParams),
        this.semanticSearch(parsed.terms, searchParams),
      ])

      logger.debug(
        { keywordResults: keywordResults.length, semanticResults: semanticResults.length },
        "Search results before RRF"
      )

      // 5. Combine with RRF
      const combined = combineWithRRF(keywordResults, semanticResults, {
        keywordWeight: 0.6,
        semanticWeight: 0.4,
        k: 60,
      })

      return combined.slice(0, limit)
    })
  }

  /**
   * Resolve filter values to safe IDs/validated values.
   * This moves all user-input validation to the service layer.
   */
  private async resolveFilters(client: PoolClient, filters: ParsedQuery["filters"]): Promise<ResolvedFilters> {
    const resolved: ResolvedFilters = {}

    // Resolve from:@user to author IDs
    if (filters.from && filters.from.length > 0) {
      const users = await Promise.all(
        filters.from.map((username) => UserRepository.findByEmailOrDisplayName(client, username))
      )
      const authorIds = users.filter((u): u is NonNullable<typeof u> => u !== null).map((u) => u.id)
      if (authorIds.length > 0) {
        resolved.authorIds = authorIds
      }
    }

    // is:type is already validated by the filter parser (isValidStreamType)
    if (filters.is && filters.is.length > 0) {
      resolved.streamTypes = filters.is
    }

    // Date filters are already parsed as Date objects
    if (filters.before) {
      resolved.before = filters.before
    }
    if (filters.after) {
      resolved.after = filters.after
    }

    return resolved
  }

  /**
   * Get stream IDs the user can access, optionally filtered by search filters.
   */
  private async getAccessibleStreamIds(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    parsed: ParsedQuery
  ): Promise<string[]> {
    // Get all streams user is a member of
    const memberships = await StreamMemberRepository.list(client, { userId })
    const memberStreamIds = new Set(memberships.map((m) => m.streamId))

    // Get public streams in workspace
    const allStreams = await StreamRepository.list(client, workspaceId, {
      types: parsed.filters.is,
      userMembershipStreamIds: [...memberStreamIds],
    })

    // Apply with:@user filter - only streams where the specified user is also a member
    let accessibleStreams = allStreams
    if (parsed.filters.with && parsed.filters.with.length > 0) {
      accessibleStreams = await this.filterStreamsByUserMembership(client, allStreams, parsed.filters.with)
    }

    return accessibleStreams.map((s) => s.id)
  }

  /**
   * Filter streams to only those where all specified users are members.
   * Uses a single batch query instead of N+1 queries.
   */
  private async filterStreamsByUserMembership<T extends { id: string }>(
    client: PoolClient,
    streams: T[],
    usernames: string[]
  ): Promise<T[]> {
    if (streams.length === 0) {
      return streams
    }

    // Look up user IDs from usernames/emails
    const users = await Promise.all(
      usernames.map((username) => UserRepository.findByEmailOrDisplayName(client, username))
    )
    const userIds = users.filter((u): u is NonNullable<typeof u> => u !== null).map((u) => u.id)

    if (userIds.length === 0) {
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
