import type { Request, Response } from "express"
import { z } from "zod/v4"
import { HttpError } from "@threa/backend-common"
import type { InvitationShadowService } from "./service"

interface Dependencies {
  shadowService: InvitationShadowService
}

const createShadowSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  email: z.string().email(),
  region: z.string().min(1),
  expiresAt: z.string().datetime(),
})

const updateShadowSchema = z.object({
  status: z.enum(["revoked"]),
})

export function createInvitationShadowHandlers({ shadowService }: Dependencies) {
  return {
    async create(req: Request, res: Response) {
      const parsed = createShadowSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      const shadow = await shadowService.createShadow({
        ...parsed.data,
        expiresAt: new Date(parsed.data.expiresAt),
      })

      res.status(201).json({ shadow })
    },

    async update(req: Request, res: Response) {
      const { id } = req.params
      const parsed = updateShadowSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      const updated = await shadowService.updateStatus(id, parsed.data.status)
      if (!updated) {
        throw new HttpError("Invitation shadow not found", { status: 404, code: "NOT_FOUND" })
      }

      res.json({ ok: true })
    },
  }
}
