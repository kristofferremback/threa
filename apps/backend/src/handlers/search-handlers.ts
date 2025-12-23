import { z } from "zod"
import type { Request, Response } from "express"
import type { SearchService } from "../services/search-service"
import type { SearchResult } from "../repositories/search-repository"
import { STREAM_TYPES } from "@threa/types"

const searchQuerySchema = z.object({
  query: z.string().optional().default(""),
  from: z.array(z.string()).optional(),
  with: z.array(z.string()).optional(),
  in: z.array(z.string()).optional(),
  is: z.array(z.enum(STREAM_TYPES)).optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
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
     * POST /api/workspaces/:workspaceId/search
     *
     * Body:
     * - query: string (optional) - text search terms
     * - from: string[] (optional) - filter by author user IDs
     * - with: string[] (optional) - filter to streams where these users are members
     * - in: string[] (optional) - filter to specific stream IDs
     * - is: StreamType[] (optional) - filter by stream type
     * - before: ISO datetime (optional) - messages before date
     * - after: ISO datetime (optional) - messages after date
     * - limit: number (optional) - max results (1-100)
     */
    async search(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!

      const result = searchQuerySchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { query, from, with: withUsers, in: inStreams, is, before, after, limit } = result.data

      const results = await searchService.search({
        workspaceId,
        userId,
        query,
        filters: {
          authorIds: from,
          withUserIds: withUsers,
          streamIds: inStreams,
          streamTypes: is,
          before: before ? new Date(before) : undefined,
          after: after ? new Date(after) : undefined,
        },
        limit,
      })

      res.json({
        results: results.map(serializeSearchResult),
        total: results.length,
      })
    },
  }
}
