import type { Request, Response, NextFunction } from "express"
import type { LinkPreviewService } from "./service"

interface HandlerDeps {
  linkPreviewService: LinkPreviewService
}

export function createLinkPreviewHandlers(deps: HandlerDeps) {
  const { linkPreviewService } = deps

  return {
    /** GET /api/workspaces/:workspaceId/messages/:messageId/link-previews */
    async getForMessage(req: Request, res: Response, next: NextFunction) {
      try {
        const { workspaceId, messageId } = req.params
        const userId = (req as any).workspaceUser.id

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
        const userId = (req as any).workspaceUser.id

        await linkPreviewService.dismiss(workspaceId, userId, messageId, linkPreviewId)
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },

    /** DELETE /api/workspaces/:workspaceId/messages/:messageId/link-previews/:linkPreviewId/dismiss */
    async undismiss(req: Request, res: Response, next: NextFunction) {
      try {
        const { workspaceId, messageId, linkPreviewId } = req.params
        const userId = (req as any).workspaceUser.id

        await linkPreviewService.undismiss(workspaceId, userId, messageId, linkPreviewId)
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  }
}
