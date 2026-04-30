import { z } from "zod"
import type { Request, Response } from "express"
import { HttpError } from "../../lib/errors"
import type { ScheduledMessagesService } from "./service"

const scheduleSchema = z.object({
  streamId: z.string().nullable(),
  parentMessageId: z.string().nullable(),
  parentStreamId: z.string().nullable(),
  contentJson: z.unknown(),
  contentMarkdown: z.string(),
  attachmentIds: z.array(z.string()).default([]),
  scheduledAt: z.string().datetime(),
})

const updateSchema = z.object({
  contentJson: z.unknown().optional(),
  contentMarkdown: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
})

const listQuerySchema = z.object({
  streamId: z.string().optional(),
})

interface Dependencies {
  scheduledMessagesService: ScheduledMessagesService
}

export function createScheduledMessagesHandlers({ scheduledMessagesService }: Dependencies) {
  return {
    async schedule(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const parsed = scheduleSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid schedule request", { status: 400, code: "VALIDATION_ERROR" })
      }

      const result = await scheduledMessagesService.schedule({
        workspaceId,
        authorId: userId,
        streamId: parsed.data.streamId,
        parentMessageId: parsed.data.parentMessageId,
        parentStreamId: parsed.data.parentStreamId,
        contentJson: parsed.data.contentJson as import("@threa/types").JSONContent,
        contentMarkdown: parsed.data.contentMarkdown,
        attachmentIds: parsed.data.attachmentIds,
        scheduledAt: new Date(parsed.data.scheduledAt),
      })

      res.json({ scheduled: result.view, sentNow: result.sentNow })
    },

    async list(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const parsed = listQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        throw new HttpError("Invalid list request", { status: 400, code: "VALIDATION_ERROR" })
      }

      const scheduled = await scheduledMessagesService.listByUser({
        workspaceId,
        authorId: userId,
        streamId: parsed.data.streamId,
      })

      res.json({ scheduled })
    },

    async update(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const scheduledId = req.params.id!

      const parsed = updateSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid update request", { status: 400, code: "VALIDATION_ERROR" })
      }

      const scheduled = await scheduledMessagesService.update({
        workspaceId,
        authorId: userId,
        scheduledId,
        contentJson: parsed.data.contentJson as import("@threa/types").JSONContent | undefined,
        contentMarkdown: parsed.data.contentMarkdown,
        attachmentIds: parsed.data.attachmentIds,
        scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
      })

      res.json({ scheduled })
    },

    async cancel(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const scheduledId = req.params.id!

      await scheduledMessagesService.cancel({
        workspaceId,
        authorId: userId,
        scheduledId,
      })

      res.json({ ok: true })
    },
  }
}
