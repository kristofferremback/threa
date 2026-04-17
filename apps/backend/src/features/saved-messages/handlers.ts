import { z } from "zod"
import type { Request, Response } from "express"
import { SAVED_STATUSES } from "@threa/types"
import { HttpError } from "../../lib/errors"
import type { SavedMessagesService } from "./service"

const saveSchema = z.object({
  messageId: z.string().min(1),
  remindAt: z.string().datetime().nullable().optional(),
})

// Status and remindAt must be changed in separate requests so each mutation is
// one transaction and one socket event. A single PATCH that combined both
// would emit two outbox events and leave an observable intermediate state
// between them.
const updateSchema = z
  .object({
    status: z.enum(SAVED_STATUSES).optional(),
    remindAt: z.string().datetime().nullable().optional(),
  })
  .refine((d) => d.status !== undefined || d.remindAt !== undefined, {
    message: "Must provide exactly one of 'status' or 'remindAt'",
  })
  .refine((d) => !(d.status !== undefined && d.remindAt !== undefined), {
    message: "Must provide exactly one of 'status' or 'remindAt', not both",
  })

const listQuerySchema = z.object({
  status: z.enum(SAVED_STATUSES).default("saved"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
})

interface Dependencies {
  savedMessagesService: SavedMessagesService
}

export function createSavedMessagesHandlers({ savedMessagesService }: Dependencies) {
  return {
    async create(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const parsed = saveSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid save request", { status: 400, code: "VALIDATION_ERROR" })
      }

      const saved = await savedMessagesService.save({
        workspaceId,
        userId,
        messageId: parsed.data.messageId,
        remindAt: parsed.data.remindAt ? new Date(parsed.data.remindAt) : null,
      })

      res.json({ saved })
    },

    async list(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!

      const parsed = listQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        throw new HttpError("Invalid list request", { status: 400, code: "VALIDATION_ERROR" })
      }

      const result = await savedMessagesService.list({
        workspaceId,
        userId,
        status: parsed.data.status,
        limit: parsed.data.limit,
        cursor: parsed.data.cursor,
      })

      res.json(result)
    },

    async update(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const savedId = req.params.savedId!

      const parsed = updateSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid update request", { status: 400, code: "VALIDATION_ERROR" })
      }

      // Schema guarantees exactly one of remindAt or status is present.
      const saved =
        parsed.data.remindAt !== undefined
          ? await savedMessagesService.updateReminder({
              workspaceId,
              userId,
              savedId,
              remindAt: parsed.data.remindAt ? new Date(parsed.data.remindAt) : null,
            })
          : await savedMessagesService.updateStatus({
              workspaceId,
              userId,
              savedId,
              status: parsed.data.status!,
            })

      res.json({ saved })
    },

    async delete(req: Request, res: Response) {
      const userId = req.user!.id
      const workspaceId = req.workspaceId!
      const savedId = req.params.savedId!

      await savedMessagesService.delete({ workspaceId, userId, savedId })

      res.json({ ok: true })
    },
  }
}
