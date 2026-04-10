import type { Request, Response } from "express"
import { z } from "zod/v4"
import { HttpError, displayNameFromWorkos } from "@threa/backend-common"
import type { BackofficeService } from "./service"

interface Dependencies {
  backofficeService: BackofficeService
}

const createInvitationSchema = z.object({
  email: z.string().email(),
})

export function createBackofficeHandlers({ backofficeService }: Dependencies) {
  return {
    /**
     * Returns the authenticated user together with their backoffice authorisation
     * state. Deliberately NOT behind the platform-admin gate so the frontend can
     * render a useful "not authorised" screen instead of a bare 403 fetch error.
     */
    async me(req: Request, res: Response) {
      if (!req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }

      const name = displayNameFromWorkos(req.authUser)
      const isPlatformAdmin = await backofficeService.isPlatformAdmin(req.authUser.id)

      res.json({
        id: req.authUser.id,
        email: req.authUser.email,
        name,
        isPlatformAdmin,
      })
    },

    /** Invite someone to become a new workspace owner (WorkOS app-level invitation). */
    async createWorkspaceOwnerInvitation(req: Request, res: Response) {
      if (!req.authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }

      const parsed = createInvitationSchema.safeParse(req.body)
      if (!parsed.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      const invitation = await backofficeService.createWorkspaceOwnerInvitation({
        email: parsed.data.email,
        inviterWorkosUserId: req.authUser.id,
      })

      res.status(201).json({ invitation })
    },
  }
}
