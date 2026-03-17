import type { Request, Response, NextFunction } from "express"
import { z } from "zod"
import { HttpError } from "@threa/backend-common"
import type { LinkPreviewService } from "./service"

interface HandlerDeps {
  linkPreviewService: LinkPreviewService
}

const dismissBodySchema = z.object({
  messageId: z.string().min(1),
})

export function createLinkPreviewHandlers(deps: HandlerDeps) {
  const { linkPreviewService } = deps

  return {
    /** GET /api/workspaces/:workspaceId/messages/:messageId/link-previews */
    async getForMessage(req: Request, res: Response, next: NextFunction) {
      try {
        const { messageId } = req.params
        const userId = (req as any).workspaceUser.id
        const workspaceId = req.params.workspaceId

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

    /** POST /api/workspaces/:workspaceId/link-previews/:linkPreviewId/dismiss */
    async dismiss(req: Request, res: Response, next: NextFunction) {
      try {
        const { workspaceId, linkPreviewId } = req.params
        const userId = (req as any).workspaceUser.id

        const body = dismissBodySchema.safeParse(req.body)
        if (!body.success) {
          throw new HttpError("messageId is required", { status: 400, code: "VALIDATION_ERROR" })
        }

        await linkPreviewService.dismiss(workspaceId, userId, body.data.messageId, linkPreviewId)
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },

    /** DELETE /api/workspaces/:workspaceId/link-previews/:linkPreviewId/dismiss */
    async undismiss(req: Request, res: Response, next: NextFunction) {
      try {
        const { workspaceId, linkPreviewId } = req.params
        const userId = (req as any).workspaceUser.id

        const body = dismissBodySchema.safeParse(req.body)
        if (!body.success) {
          throw new HttpError("messageId is required", { status: 400, code: "VALIDATION_ERROR" })
        }

        await linkPreviewService.undismiss(workspaceId, userId, body.data.messageId, linkPreviewId)
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  }
}
