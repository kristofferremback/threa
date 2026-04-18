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
  roleSlug: z.string().min(1),
  region: z.string().min(1),
  expiresAt: z.string().datetime(),
  inviterWorkosUserId: z.string().min(1).optional(),
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
        id: parsed.data.id,
        workspaceId: parsed.data.workspaceId,
        email: parsed.data.email,
        roleSlug: parsed.data.roleSlug,
        region: parsed.data.region,
        expiresAt: new Date(parsed.data.expiresAt),
        inviterWorkosUserId: parsed.data.inviterWorkosUserId,
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

    /** User-facing: accept a pending invitation */
    async accept(req: Request, res: Response) {
      if (!req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }

      const { workspaceId } = await shadowService.acceptShadow(req.params.id, {
        id: req.authUser.id,
        email: req.authUser.email,
        firstName: req.authUser.firstName,
        lastName: req.authUser.lastName,
      })

      res.json({ workspaceId })
    },
  }
}
