import type { RequestHandler } from "express"
import { SearchService, TypedSearchFilters } from "../services/search-service"
import { logger } from "../lib/logger"

export interface SearchDeps {
  searchService: SearchService
}

export function createSearchHandlers({ searchService }: SearchDeps) {
  const search: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { query = "", filters = {}, limit = 50, offset = 0, type = "all" } = req.body

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
        userId,
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

      res.json(results)
    } catch (error) {
      next(error)
    }
  }

  const searchGet: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const query = (req.query.query as string) || (req.query.q as string) || ""
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
      const offset = parseInt(req.query.offset as string) || 0
      const type = (req.query.type as string) || "all"

      const searchOptions = {
        limit,
        offset,
        searchMessages: type === "all" || type === "messages",
        searchKnowledge: type === "all" || type === "knowledge",
        userId,
      }

      const results = await searchService.search(workspaceId, query, searchOptions)

      logger.debug(
        {
          workspaceId,
          userId,
          query,
          resultCount: results.total,
        },
        "Search executed (GET)",
      )

      res.json(results)
    } catch (error) {
      next(error)
    }
  }

  const getSuggestions: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      res.json({
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
  }

  return { search, searchGet, getSuggestions }
}
