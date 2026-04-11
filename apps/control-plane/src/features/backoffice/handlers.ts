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

    async listWorkspaceOwnerInvitations(_req: Request, res: Response) {
      const invitations = await backofficeService.listWorkspaceOwnerInvitations()
      res.json({ invitations })
    },

    async revokeWorkspaceOwnerInvitation(req: Request, res: Response) {
      const id = req.params.id
      if (!id) {
        throw new HttpError("Missing invitation id", { status: 400, code: "VALIDATION_ERROR" })
      }
      await backofficeService.revokeWorkspaceOwnerInvitation(id)
      res.status(204).end()
    },

    async resendWorkspaceOwnerInvitation(req: Request, res: Response) {
      const id = req.params.id
      if (!id) {
        throw new HttpError("Missing invitation id", { status: 400, code: "VALIDATION_ERROR" })
      }
      const invitation = await backofficeService.resendWorkspaceOwnerInvitation(id)
      res.status(201).json({ invitation })
    },

    async listWorkspaces(_req: Request, res: Response) {
      const workspaces = await backofficeService.listAllWorkspaces()
      res.json({ workspaces })
    },

    async getWorkspace(req: Request, res: Response) {
      const id = req.params.id
      if (!id) {
        throw new HttpError("Missing workspace id", { status: 400, code: "VALIDATION_ERROR" })
      }
      const workspace = await backofficeService.getWorkspaceDetail(id)
      res.json({ workspace })
    },

    async getConfig(_req: Request, res: Response) {
      res.json({ config: backofficeService.getConfig() })
    },
  }
}
