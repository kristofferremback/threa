import { z } from "zod"
import type { Request, Response } from "express"
import type { SearchService } from "../services/search-service"
import type { SearchResult } from "../repositories/search-repository"

const searchQuerySchema = z.object({
  q: z.string().min(1, "Search query is required"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

function serializeSearchResult(result: SearchResult) {
  return {
    id: result.id,
    streamId: result.streamId,
    content: result.content,
    authorId: result.authorId,
    authorType: result.authorType,
    createdAt: result.createdAt.toISOString(),
    rank: result.rank,
  }
}

interface Dependencies {
  searchService: SearchService
}

export function createSearchHandlers({ searchService }: Dependencies) {
  return {
    /**
     * Search messages across accessible streams.
     *
     * GET /api/workspaces/:workspaceId/search?q=<query>&limit=<n>
     *
     * Query supports filter operators:
     * - from:@user - messages by user
     * - with:@user - in streams where user is member
     * - in:#channel - messages in specific channel
     * - is:thread|dm|scratchpad|channel - filter by stream type
     * - before:YYYY-MM-DD - messages before date
     * - after:YYYY-MM-DD - messages after date
     *
     * Example: "redis caching from:@jane is:thread"
     */
    async search(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!

      const result = searchQuerySchema.safeParse(req.query)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { q, limit } = result.data

      const results = await searchService.search({
        workspaceId,
        userId,
        query: q,
        limit,
      })

      res.json({
        results: results.map(serializeSearchResult),
        total: results.length,
      })
    },
  }
}
