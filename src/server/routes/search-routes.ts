import { Router } from "express"
import { SearchService } from "../services/search-service"
import { logger } from "../lib/logger"

export function createSearchRoutes(searchService: SearchService): Router {
  const router = Router()

  /**
   * GET /api/workspace/:workspaceId/search
   * 
   * Search messages and knowledge base.
   * 
   * Query parameters:
   * - q: Search query (supports filters like from:@user, in:#channel, etc.)
   * - limit: Max results (default 50)
   * - offset: Pagination offset (default 0)
   * - type: "all" | "messages" | "knowledge" (default "all")
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

      if (!query.trim()) {
        return res.json({
          results: [],
          total: 0,
          parsedQuery: { filters: {}, freeText: "" },
        })
      }

      const searchOptions = {
        limit,
        offset,
        searchMessages: type === "all" || type === "messages",
        searchKnowledge: type === "all" || type === "knowledge",
      }

      const results = await searchService.search(workspaceId, query, searchOptions)

      logger.debug(
        {
          workspaceId,
          userId,
          query,
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

