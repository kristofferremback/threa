import type { Request, Response, NextFunction } from "express"
import type { Pool } from "pg"
import type { MessageLinkPreviewData } from "@threa/types"
import { getAvatarUrl } from "@threa/types"
import type { LinkPreviewService } from "./service"
import { LinkPreviewRepository } from "./repository"
import { MessageRepository } from "../messaging"
import { UserRepository } from "../workspaces"
import type { StreamService } from "../streams"

/** Max characters for the content preview in a message link card */
const CONTENT_PREVIEW_MAX_LENGTH = 200

interface HandlerDeps {
  pool: Pool
  linkPreviewService: LinkPreviewService
  streamService: StreamService
}

export function createLinkPreviewHandlers(deps: HandlerDeps) {
  const { pool, linkPreviewService, streamService } = deps

  return {
    /** GET /api/workspaces/:workspaceId/messages/:messageId/link-previews */
    async getForMessage(req: Request, res: Response, next: NextFunction) {
      try {
        const { workspaceId, messageId } = req.params
        const userId = req.user!.id

        const previews = await linkPreviewService.getPreviewsForMessage(workspaceId, messageId)
        const dismissals = await linkPreviewService.getDismissals(workspaceId, userId, [messageId])

        const result = previews.map((p) => ({
          ...p,
          dismissed: dismissals.has(`${messageId}:${p.id}`),
        }))

        res.json({ previews: result })
      } catch (err) {
        next(err)
      }
    },

    /** POST /api/workspaces/:workspaceId/messages/:messageId/link-previews/:linkPreviewId/dismiss */
    async dismiss(req: Request, res: Response, next: NextFunction) {
      try {
        const { workspaceId, messageId, linkPreviewId } = req.params
        const userId = req.user!.id

        await linkPreviewService.dismiss(workspaceId, userId, messageId, linkPreviewId)
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },

    /**
     * GET /api/workspaces/:workspaceId/link-previews/:linkPreviewId/resolve
     * Permission-checked resolve endpoint for message link previews.
     * Returns different data depending on the viewer's access tier.
     */
    async resolveMessageLink(req: Request, res: Response, next: NextFunction) {
      try {
        const { workspaceId, linkPreviewId } = req.params
        const userId = req.user!.id

        const preview = await LinkPreviewRepository.findById(pool, workspaceId, linkPreviewId)
        if (!preview || preview.contentType !== "message_link") {
          res.status(404).json({ error: "Not found" })
          return
        }

        const { targetWorkspaceId, targetStreamId, targetMessageId } = preview
        if (!targetWorkspaceId || !targetStreamId || !targetMessageId) {
          res.status(404).json({ error: "Not found" })
          return
        }

        // Cross-workspace: minimal info
        if (targetWorkspaceId !== workspaceId) {
          const data: MessageLinkPreviewData = { accessTier: "cross_workspace" }
          res.json(data)
          return
        }

        // Same workspace — check stream access
        const stream = await streamService.tryAccess(targetStreamId, workspaceId, userId)
        if (!stream) {
          const data: MessageLinkPreviewData = { accessTier: "private" }
          res.json(data)
          return
        }

        // Full access — look up message and author
        const message = await MessageRepository.findById(pool, targetMessageId)
        if (!message) {
          const data: MessageLinkPreviewData = { accessTier: "full", deleted: true }
          res.json(data)
          return
        }

        if (message.deletedAt) {
          const data: MessageLinkPreviewData = { accessTier: "full", deleted: true }
          res.json(data)
          return
        }

        // Look up author name
        let authorName: string | undefined
        let authorAvatarUrl: string | undefined
        if (message.authorType === "user") {
          const user = await UserRepository.findById(pool, workspaceId, message.authorId)
          if (user) {
            authorName = user.name
            authorAvatarUrl = getAvatarUrl(workspaceId, user.avatarUrl, 64) ?? undefined
          }
        }

        const contentPreview =
          message.contentMarkdown.length > CONTENT_PREVIEW_MAX_LENGTH
            ? message.contentMarkdown.slice(0, CONTENT_PREVIEW_MAX_LENGTH) + "…"
            : message.contentMarkdown

        const streamName = stream.displayName ?? stream.slug ?? undefined

        const data: MessageLinkPreviewData = {
          accessTier: "full",
          authorName,
          authorAvatarUrl,
          contentPreview,
          streamName,
        }
        res.json(data)
      } catch (err) {
        next(err)
      }
    },
  }
}
