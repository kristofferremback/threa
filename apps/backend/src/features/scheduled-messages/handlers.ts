import { z } from "zod"
import type { Request, Response } from "express"
import { collectAttachmentReferenceIds, serializeToMarkdown } from "@threa/prosemirror"
import { ScheduledMessageStatuses, type JSONContent } from "@threa/types"
import type { ScheduledMessagesService } from "./service"

const contentJsonSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.any()),
})

const createScheduledSchema = z.object({
  streamId: z.string().min(1),
  contentJson: contentJsonSchema,
  contentMarkdown: z.string().optional(),
  attachmentIds: z.array(z.string().min(1)).optional(),
  scheduledAt: z.string().datetime(),
  clientMessageId: z.string().min(1).optional(),
})

const updateScheduledSchema = z.object({
  contentJson: contentJsonSchema.optional(),
  contentMarkdown: z.string().optional(),
  attachmentIds: z.array(z.string().min(1)).optional(),
  scheduledAt: z.string().datetime().optional(),
  status: z.enum([ScheduledMessageStatuses.SCHEDULED, ScheduledMessageStatuses.PAUSED]).optional(),
  expectedVersion: z.number().int().positive().optional(),
})

const versionSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
})

interface Dependencies {
  scheduledMessagesService: ScheduledMessagesService
}

export function createScheduledMessagesHandlers({ scheduledMessagesService }: Dependencies) {
  return {
    async list(req: Request, res: Response) {
      const scheduled = await scheduledMessagesService.list({
        workspaceId: req.workspaceId!,
        userId: req.user!.id,
      })
      res.json({ scheduled })
    },

    async create(req: Request, res: Response) {
      const result = createScheduledSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({ error: "Validation failed", details: z.flattenError(result.error).fieldErrors })
      }
      const data = result.data
      const attachmentIds = mergeAttachmentIds(data.attachmentIds, data.contentJson as JSONContent)
      const scheduled = await scheduledMessagesService.create({
        workspaceId: req.workspaceId!,
        userId: req.user!.id,
        streamId: data.streamId,
        contentJson: data.contentJson as JSONContent,
        contentMarkdown: data.contentMarkdown ?? serializeToMarkdown(data.contentJson as JSONContent),
        attachmentIds,
        scheduledAt: new Date(data.scheduledAt),
        clientMessageId: data.clientMessageId,
      })
      res.status(201).json({ scheduled })
    },

    async update(req: Request, res: Response) {
      const result = updateScheduledSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({ error: "Validation failed", details: z.flattenError(result.error).fieldErrors })
      }
      const data = result.data
      const contentJson = data.contentJson as JSONContent | undefined
      const scheduled = await scheduledMessagesService.update({
        workspaceId: req.workspaceId!,
        userId: req.user!.id,
        scheduledId: req.params.scheduledId,
        contentJson,
        contentMarkdown: contentJson
          ? (data.contentMarkdown ?? serializeToMarkdown(contentJson))
          : data.contentMarkdown,
        attachmentIds: contentJson ? mergeAttachmentIds(data.attachmentIds, contentJson) : data.attachmentIds,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
        status: data.status,
        expectedVersion: data.expectedVersion,
      })
      res.json({ scheduled })
    },

    async pause(req: Request, res: Response) {
      const data = parseVersion(req, res)
      if (!data) return
      const scheduled = await scheduledMessagesService.pause({
        workspaceId: req.workspaceId!,
        userId: req.user!.id,
        scheduledId: req.params.scheduledId,
        expectedVersion: data.expectedVersion,
      })
      res.json({ scheduled })
    },

    async resume(req: Request, res: Response) {
      const data = parseVersion(req, res)
      if (!data) return
      const scheduled = await scheduledMessagesService.resume({
        workspaceId: req.workspaceId!,
        userId: req.user!.id,
        scheduledId: req.params.scheduledId,
        expectedVersion: data.expectedVersion,
      })
      res.json({ scheduled })
    },

    async sendNow(req: Request, res: Response) {
      const data = parseVersion(req, res)
      if (!data) return
      const scheduled = await scheduledMessagesService.sendNow({
        workspaceId: req.workspaceId!,
        userId: req.user!.id,
        scheduledId: req.params.scheduledId,
        expectedVersion: data.expectedVersion,
      })
      res.json({ scheduled })
    },

    async editLock(req: Request, res: Response) {
      const data = parseVersion(req, res)
      if (!data) return
      const scheduled = await scheduledMessagesService.editLock({
        workspaceId: req.workspaceId!,
        userId: req.user!.id,
        scheduledId: req.params.scheduledId,
        expectedVersion: data.expectedVersion,
      })
      res.json({ scheduled })
    },

    async delete(req: Request, res: Response) {
      const data = parseVersion(req, res)
      if (!data) return
      await scheduledMessagesService.delete({
        workspaceId: req.workspaceId!,
        userId: req.user!.id,
        scheduledId: req.params.scheduledId,
        expectedVersion: data.expectedVersion,
      })
      res.json({ ok: true })
    },
  }
}

function parseVersion(req: Request, res: Response): z.infer<typeof versionSchema> | null {
  const result = versionSchema.safeParse(req.body ?? {})
  if (!result.success) {
    res.status(400).json({ error: "Validation failed", details: z.flattenError(result.error).fieldErrors })
    return null
  }
  return result.data
}

function mergeAttachmentIds(explicitIds: string[] | undefined, contentJson: JSONContent): string[] {
  return [...new Set([...(explicitIds ?? []), ...collectAttachmentReferenceIds(contentJson)])]
}
