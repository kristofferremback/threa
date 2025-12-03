import type { RequestHandler } from "express"
import { Pool } from "pg"
import { MemoService } from "../services/memo-service"
import { logger } from "../lib/logger"

export interface MemoDeps {
  pool: Pool
}

export function createMemoHandlers({ pool }: MemoDeps) {
  const memoService = new MemoService(pool)

  const listMemos: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
      const offset = parseInt(req.query.offset as string) || 0
      const topicsParam = req.query.topics as string | undefined
      const topics = topicsParam ? topicsParam.split(",").map((t) => t.trim()) : undefined
      const includeContent = req.query.includeContent !== "false"

      const memos = await memoService.getMemos(workspaceId, { limit, offset, topics, includeContent })

      logger.debug({ workspaceId, userId, memoCount: memos.length, topics }, "Memos listed")

      res.json({ memos, total: memos.length })
    } catch (error) {
      next(error)
    }
  }

  const getMemo: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId, memoId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const memo = await memoService.getMemo(memoId)

      if (!memo) {
        res.status(404).json({ error: "Memo not found" })
        return
      }

      if (memo.workspaceId !== workspaceId) {
        res.status(403).json({ error: "Access denied" })
        return
      }

      res.json({ memo })
    } catch (error) {
      next(error)
    }
  }

  const createMemo: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const { anchorEventIds, streamId, summary, topics } = req.body

      if (!anchorEventIds || !Array.isArray(anchorEventIds) || anchorEventIds.length === 0) {
        res.status(400).json({ error: "anchorEventIds is required and must be a non-empty array" })
        return
      }

      if (!streamId) {
        res.status(400).json({ error: "streamId is required" })
        return
      }

      const memo = await memoService.createMemo({
        workspaceId,
        anchorEventIds,
        streamId,
        summary,
        topics,
        source: "user",
        createdBy: userId,
        confidence: 0.9,
      })

      logger.info({ workspaceId, userId, memoId: memo.id, anchorEventIds }, "Memo created")

      res.status(201).json({ memo })
    } catch (error) {
      next(error)
    }
  }

  const updateMemo: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId, memoId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const memo = await memoService.getMemo(memoId)

      if (!memo) {
        res.status(404).json({ error: "Memo not found" })
        return
      }

      if (memo.workspaceId !== workspaceId) {
        res.status(403).json({ error: "Access denied" })
        return
      }

      const { summary, topics } = req.body

      await memoService.updateMemo(memoId, { summary, topics })

      const updatedMemo = await memoService.getMemo(memoId)

      logger.info({ workspaceId, userId, memoId }, "Memo updated")

      res.json({ memo: updatedMemo })
    } catch (error) {
      next(error)
    }
  }

  const archiveMemo: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId, memoId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const memo = await memoService.getMemo(memoId)

      if (!memo) {
        res.status(404).json({ error: "Memo not found" })
        return
      }

      if (memo.workspaceId !== workspaceId) {
        res.status(403).json({ error: "Access denied" })
        return
      }

      await memoService.archiveMemo(memoId)

      logger.info({ workspaceId, userId, memoId }, "Memo archived")

      res.status(204).send()
    } catch (error) {
      next(error)
    }
  }

  const getExperts: RequestHandler = async (req, res, next) => {
    try {
      const { workspaceId } = req.params
      const userId = req.user?.id

      if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
      }

      const topic = req.query.topic as string
      if (!topic) {
        res.status(400).json({ error: "topic query parameter is required" })
        return
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 5, 20)

      const experts = await memoService.getExperts(workspaceId, topic, limit)

      res.json({ experts, topic })
    } catch (error) {
      next(error)
    }
  }

  return { listMemos, getMemo, createMemo, updateMemo, archiveMemo, getExperts }
}
