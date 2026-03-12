import { z } from "zod"
import type { Request, Response } from "express"
import type { SearchService } from "../search"
import type { SearchResult } from "../search"
import type { ApiKeyChannelService } from "./service"
import { STREAM_TYPES } from "@threa/types"

const PUBLIC_SEARCH_MAX_LIMIT = 50

const publicSearchSchema = z.object({
  query: z.string().min(1, "query is required"),
  streams: z.array(z.string()).optional(),
  from: z.string().optional(),
  type: z.array(z.enum(STREAM_TYPES)).optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(PUBLIC_SEARCH_MAX_LIMIT).optional().default(20),
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
  apiKeyChannelService: ApiKeyChannelService
}

export function createPublicApiHandlers({ searchService, apiKeyChannelService }: Dependencies) {
  return {
    /**
     * Search messages via public API.
     *
     * POST /api/v1/workspaces/:workspaceId/messages/search
     */
    async searchMessages(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const apiKey = req.apiKey!

      const result = publicSearchSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { query, streams, from, type, before, after, limit } = result.data

      const accessibleStreamIds = await apiKeyChannelService.getAccessibleStreamIdsForApiKey(workspaceId, apiKey.id)

      if (accessibleStreamIds.length === 0) {
        return res.json({ results: [] })
      }

      const results = await searchService.search({
        workspaceId,
        permissions: { accessibleStreamIds },
        query,
        filters: {
          streamIds: streams,
          authorId: from,
          streamTypes: type,
          before: before ? new Date(before) : undefined,
          after: after ? new Date(after) : undefined,
        },
        limit,
      })

      res.json({
        results: results.map(serializeSearchResult),
      })
    },
  }
}
