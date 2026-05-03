import { z } from "zod"
import type { Request, Response } from "express"
import { HttpError } from "../../lib/errors"
import type { ScheduledMessagesService } from "./service"

const contentJsonSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.any()),
})

const scheduleSchema = z.object({
  streamId: z.string().min(1),
  parentMessageId: z.string().min(1).nullable().optional(),
  contentJson: contentJsonSchema,
  contentMarkdown: z.string(),
  attachmentIds: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  scheduledFor: z.string().datetime(),
  clientMessageId: z.string().min(1).optional(),
})

// PATCH allows any subset of editable fields plus a required lockToken. The
// lock token is the mutual-exclusion primitive against the worker; without
// it, no edits are allowed.
const updateSchema = z
  .object({
    contentJson: contentJsonSchema.optional(),
    contentMarkdown: z.string().optional(),
    attachmentIds: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.string()).nullable().optional(),
    scheduledFor: z.string().datetime().optional(),
    lockToken: z.string().min(1),
  })
  .refine(
    (d) =>
      d.contentJson !== undefined ||
      d.contentMarkdown !== undefined ||
      d.attachmentIds !== undefined ||
      d.metadata !== undefined ||
      d.scheduledFor !== undefined,
    { message: "At least one editable field must be provided" }
  )

const listQuerySchema = z.object({
  status: z.enum(["pending", "sent", "failed", "cancelled"]).default("pending"),
  streamId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
})

const lockTokenSchema = z.object({ lockToken: z.string().min(1) })

interface Dependencies {
  scheduledMessagesService: ScheduledMessagesService
}

export function createScheduledMessagesHandlers({ scheduledMessagesService }: Dependencies) {
  return {
    async create(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const parsed = scheduleSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid schedule request", { status: 400, code: "VALIDATION_ERROR" })
      }
      const data = parsed.data

      const scheduled = await scheduledMessagesService.schedule({
        workspaceId,
        userId,
        streamId: data.streamId,
        parentMessageId: data.parentMessageId ?? null,
        contentJson: data.contentJson,
        contentMarkdown: data.contentMarkdown,
        attachmentIds: data.attachmentIds ?? [],
        metadata: data.metadata ?? null,
        scheduledFor: new Date(data.scheduledFor),
        clientMessageId: data.clientMessageId ?? null,
      })

      res.status(201).json({ scheduled })
    },

    async list(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const parsed = listQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        throw new HttpError("Invalid list request", { status: 400, code: "VALIDATION_ERROR" })
      }

      const result = await scheduledMessagesService.list({
        workspaceId,
        userId,
        status: parsed.data.status,
        streamId: parsed.data.streamId,
        limit: parsed.data.limit,
        cursor: parsed.data.cursor,
      })

      res.json(result)
    },

    async getById(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const id = req.params.id!

      const scheduled = await scheduledMessagesService.getById({ workspaceId, userId, id })
      if (!scheduled) {
        throw new HttpError("Scheduled message not found", {
          status: 404,
          code: "SCHEDULED_MESSAGE_NOT_FOUND",
        })
      }

      res.json({ scheduled })
    },

    async update(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const id = req.params.id!

      const parsed = updateSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid update request", { status: 400, code: "VALIDATION_ERROR" })
      }

      const scheduled = await scheduledMessagesService.update({
        workspaceId,
        userId,
        id,
        lockToken: parsed.data.lockToken,
        contentJson: parsed.data.contentJson,
        contentMarkdown: parsed.data.contentMarkdown,
        attachmentIds: parsed.data.attachmentIds,
        metadata: parsed.data.metadata,
        scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : undefined,
      })

      res.json({ scheduled })
    },

    async claim(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const id = req.params.id!

      const result = await scheduledMessagesService.claim({ workspaceId, userId, id })

      res.json({
        scheduled: result.scheduled,
        lockToken: result.lockToken,
        lockExpiresAt: result.lockExpiresAt.toISOString(),
        sync: result.sync,
      })
    },

    async heartbeat(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const id = req.params.id!

      const parsed = lockTokenSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid heartbeat request", { status: 400, code: "VALIDATION_ERROR" })
      }

      const result = await scheduledMessagesService.heartbeat({
        workspaceId,
        userId,
        id,
        lockToken: parsed.data.lockToken,
      })

      res.json({ lockExpiresAt: result.lockExpiresAt.toISOString() })
    },

    async release(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const id = req.params.id!

      const parsed = lockTokenSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid release request", { status: 400, code: "VALIDATION_ERROR" })
      }

      await scheduledMessagesService.release({
        workspaceId,
        userId,
        id,
        lockToken: parsed.data.lockToken,
      })

      res.json({ ok: true })
    },

    async sendNow(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const id = req.params.id!

      const scheduled = await scheduledMessagesService.sendNow({ workspaceId, userId, id })
      res.json({ scheduled })
    },

    async delete(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const id = req.params.id!

      await scheduledMessagesService.cancel({ workspaceId, userId, id })
      res.json({ ok: true })
    },
  }
}
