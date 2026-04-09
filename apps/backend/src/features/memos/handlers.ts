import { z } from "zod"
import type { Request, Response } from "express"
import type { Pool } from "pg"
import { KNOWLEDGE_TYPES, MEMO_TYPES } from "@threa/types"
import { resolveUserAccessibleStreamIds } from "../search"
import type { MemoExplorerDetail, MemoExplorerResult, MemoExplorerService } from "./explorer-service"
import type { Memo } from "./repository"

const memoSearchSchema = z.object({
  query: z.string().optional().default(""),
  in: z.array(z.string()).optional(),
  memoType: z.array(z.enum(MEMO_TYPES)).optional(),
  knowledgeType: z.array(z.enum(KNOWLEDGE_TYPES)).optional(),
  tags: z.array(z.string()).optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
  exact: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

function normalizeSearchMode(query: string, exact?: boolean): { query: string; exact: boolean } {
  const trimmed = query.trim()
  if (exact) {
    return { query: trimmed, exact: trimmed.length > 0 }
  }

  const isQuoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
  if (!isQuoted) {
    return { query: trimmed, exact: false }
  }

  const unquoted = trimmed.slice(1, -1).trim()
  return { query: unquoted, exact: unquoted.length > 0 }
}

function serializeMemo(memo: Memo) {
  return {
    ...memo,
    createdAt: memo.createdAt.toISOString(),
    updatedAt: memo.updatedAt.toISOString(),
    archivedAt: memo.archivedAt?.toISOString() ?? null,
  }
}

function serializeMemoResult(result: MemoExplorerResult) {
  return {
    memo: serializeMemo(result.memo),
    distance: result.distance,
    sourceStream: result.sourceStream,
    rootStream: result.rootStream,
  }
}

function serializeMemoDetail(detail: MemoExplorerDetail) {
  return {
    ...serializeMemoResult(detail),
    sourceMessages: detail.sourceMessages.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
  }
}

interface Dependencies {
  pool: Pool
  memoExplorerService: MemoExplorerService
}

export function createMemoHandlers({ pool, memoExplorerService }: Dependencies) {
  return {
    async search(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const result = memoSearchSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { query, exact, in: inStreams, memoType, knowledgeType, tags, before, after, limit } = result.data
      const normalized = normalizeSearchMode(query, exact)

      const accessibleStreamIds = await resolveUserAccessibleStreamIds(pool, workspaceId, userId, {
        archiveStatus: ["active", "archived"],
      })

      const results = await memoExplorerService.search({
        workspaceId,
        permissions: { accessibleStreamIds },
        query: normalized.query,
        exact: normalized.exact,
        filters: {
          streamIds: inStreams,
          memoTypes: memoType,
          knowledgeTypes: knowledgeType,
          tags,
          before: before ? new Date(before) : undefined,
          after: after ? new Date(after) : undefined,
        },
        limit,
      })

      res.json({ results: results.map(serializeMemoResult) })
    },

    async getById(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const { memoId } = req.params

      const accessibleStreamIds = await resolveUserAccessibleStreamIds(pool, workspaceId, userId, {
        archiveStatus: ["active", "archived"],
      })

      const memo = await memoExplorerService.getById(workspaceId, memoId, {
        accessibleStreamIds,
      })

      if (!memo) {
        return res.status(404).json({ error: "Memo not found" })
      }

      res.json({ memo: serializeMemoDetail(memo) })
    },
  }
}
