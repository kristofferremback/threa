import { Router } from "express"
import { SearchService, TypedSearchFilters } from "../services/search-service"
import { logger } from "../lib/logger"

export function createSearchRoutes(searchService: SearchService): Router {
  const router = Router()

  /**
   * POST /api/workspace/:workspaceId/search
   *
   * Search messages and knowledge base with typed filters.
   *
   * Body:
   * - query: Search query text (semantic/full-text search)
   * - filters: { userIds?: string[], streamIds?: string[], before?: string, after?: string, has?: string[], is?: string[] }
   * - limit: Max results (default 50)
   * - offset: Pagination offset (default 0)
   * - type: "all" | "messages" | "knowledge" (default "all")
   */
  router.post("/:workspaceId/search", async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const { query = "", filters = {}, limit = 50, offset = 0, type = "all" } = req.body

      // Parse typed filters from request body
      const typedFilters: TypedSearchFilters = {
        userIds: filters.userIds,
        withUserIds: filters.withUserIds,
        streamIds: filters.streamIds,
        streamTypes: filters.streamTypes,
        before: filters.before ? new Date(filters.before) : undefined,
        after: filters.after ? new Date(filters.after) : undefined,
        has: filters.has,
        is: filters.is,
      }

      const searchOptions = {
        limit: Math.min(limit, 100),
        offset,
        searchMessages: type === "all" || type === "messages",
        searchKnowledge: type === "all" || type === "knowledge",
        filters: typedFilters,
        userId, // Permission scoping - only return content user can access
      }

      const results = await searchService.search(workspaceId, query, searchOptions)

      logger.debug(
        {
          workspaceId,
          userId,
          query,
          filters: typedFilters,
          resultCount: results.total,
        },
        "Search executed",
      )

      return res.json(results)
    } catch (error) {
      next(error)
    }
  })

  /**
   * GET /api/workspace/:workspaceId/search (legacy - for backwards compatibility)
   * Accepts query string parameters, no filters.
   */
  router.get("/:workspaceId/search", async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const query = (req.query.q as string) || ""
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
      const offset = parseInt(req.query.offset as string) || 0
      const type = (req.query.type as string) || "all"

      const searchOptions = {
        limit,
        offset,
        searchMessages: type === "all" || type === "messages",
        searchKnowledge: type === "all" || type === "knowledge",
        userId, // Permission scoping - only return content user can access
      }

      const results = await searchService.search(workspaceId, query, searchOptions)

      logger.debug(
        {
          workspaceId,
          userId,
          query,
          resultCount: results.total,
        },
        "Search executed (legacy GET)",
      )

      return res.json(results)
    } catch (error) {
      next(error)
    }
  })

  /**
   * GET /api/workspace/:workspaceId/search/suggestions
   *
   * Get search suggestions based on recent activity.
   * For autocomplete in the search UI.
   */
  router.get("/:workspaceId/search/suggestions", async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      // Return recent searches, popular searches, and filter suggestions
      // For now, just return empty - can be expanded later
      return res.json({
        recentSearches: [],
        popularFilters: [
          { label: "from:@me", description: "Your messages" },
          { label: "has:code", description: "Messages with code" },
          { label: "has:link", description: "Messages with links" },
          { label: "is:knowledge", description: "Knowledge base only" },
        ],
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

