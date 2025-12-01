import { Router } from "express"
import { Pool } from "pg"
import { MemoService } from "../services/memo-service"
import { logger } from "../lib/logger"

export function createMemoRoutes(pool: Pool): Router {
  const router = Router()
  const memoService = new MemoService(pool)

  /**
   * GET /api/workspace/:workspaceId/memos
   *
   * List memos in the workspace.
   * Query params:
   * - limit: Max results (default 50)
   * - offset: Pagination offset (default 0)
   * - topics: Comma-separated topic filters
   * - includeContent: Include anchor message content (default true)
   */
  router.get("/:workspaceId/memos", async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
      const offset = parseInt(req.query.offset as string) || 0
      const topicsParam = req.query.topics as string | undefined
      const topics = topicsParam ? topicsParam.split(",").map((t) => t.trim()) : undefined
      const includeContent = req.query.includeContent !== "false"

      const memos = await memoService.getMemos(workspaceId, { limit, offset, topics, includeContent })

      logger.debug({ workspaceId, userId, memoCount: memos.length, topics }, "Memos listed")

      return res.json({ memos, total: memos.length })
    } catch (error) {
      next(error)
    }
  })

  /**
   * GET /api/workspace/:workspaceId/memos/:memoId
   *
   * Get a single memo by ID.
   */
  router.get("/:workspaceId/memos/:memoId", async (req, res, next) => {
    try {
      const { workspaceId, memoId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const memo = await memoService.getMemo(memoId)

      if (!memo) {
        return res.status(404).json({ error: "Memo not found" })
      }

      if (memo.workspaceId !== workspaceId) {
        return res.status(403).json({ error: "Access denied" })
      }

      return res.json({ memo })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/workspace/:workspaceId/memos
   *
   * Create a new memo from an anchor event.
   * Body:
   * - anchorEventIds: string[] - Key messages for this memo
   * - streamId: string - Stream context
   * - summary?: string - Optional summary (will be auto-generated if not provided)
   * - topics?: string[] - Topic tags
   */
  router.post("/:workspaceId/memos", async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const { anchorEventIds, streamId, summary, topics } = req.body

      if (!anchorEventIds || !Array.isArray(anchorEventIds) || anchorEventIds.length === 0) {
        return res.status(400).json({ error: "anchorEventIds is required and must be a non-empty array" })
      }

      if (!streamId) {
        return res.status(400).json({ error: "streamId is required" })
      }

      const memo = await memoService.createMemo({
        workspaceId,
        anchorEventIds,
        streamId,
        summary,
        topics,
        source: "user",
        createdBy: userId,
        confidence: 0.9, // User-created memos have high confidence
      })

      logger.info({ workspaceId, userId, memoId: memo.id, anchorEventIds }, "Memo created")

      return res.status(201).json({ memo })
    } catch (error) {
      next(error)
    }
  })

  /**
   * PATCH /api/workspace/:workspaceId/memos/:memoId
   *
   * Update a memo.
   * Body:
   * - summary?: string - Updated summary
   * - topics?: string[] - Updated topics
   */
  router.patch("/:workspaceId/memos/:memoId", async (req, res, next) => {
    try {
      const { workspaceId, memoId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const memo = await memoService.getMemo(memoId)

      if (!memo) {
        return res.status(404).json({ error: "Memo not found" })
      }

      if (memo.workspaceId !== workspaceId) {
        return res.status(403).json({ error: "Access denied" })
      }

      const { summary, topics } = req.body

      await memoService.updateMemo(memoId, { summary, topics })

      const updatedMemo = await memoService.getMemo(memoId)

      logger.info({ workspaceId, userId, memoId }, "Memo updated")

      return res.json({ memo: updatedMemo })
    } catch (error) {
      next(error)
    }
  })

  /**
   * DELETE /api/workspace/:workspaceId/memos/:memoId
   *
   * Archive a memo (soft delete).
   */
  router.delete("/:workspaceId/memos/:memoId", async (req, res, next) => {
    try {
      const { workspaceId, memoId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const memo = await memoService.getMemo(memoId)

      if (!memo) {
        return res.status(404).json({ error: "Memo not found" })
      }

      if (memo.workspaceId !== workspaceId) {
        return res.status(403).json({ error: "Access denied" })
      }

      await memoService.archiveMemo(memoId)

      logger.info({ workspaceId, userId, memoId }, "Memo archived")

      return res.status(204).send()
    } catch (error) {
      next(error)
    }
  })

  /**
   * GET /api/workspace/:workspaceId/experts
   *
   * Get experts for a topic.
   * Query params:
   * - topic: Topic to find experts for (required)
   * - limit: Max results (default 5)
   */
  router.get("/:workspaceId/experts", async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      const topic = req.query.topic as string
      if (!topic) {
        return res.status(400).json({ error: "topic query parameter is required" })
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 5, 20)

      const experts = await memoService.getExperts(workspaceId, topic, limit)

      return res.json({ experts, topic })
    } catch (error) {
      next(error)
    }
  })

  return router
}
