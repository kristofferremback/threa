import type { Request, Response } from "express"
import { z } from "zod"
import { HttpError } from "../lib/errors"
import type { WorkspaceService } from "../features/workspaces"
import type { InvitationService } from "../features/invitations"
import type { PlatformAdminService } from "../features/platform-admins"

const createWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  ownerWorkosUserId: z.string().min(1),
  ownerEmail: z.string().email(),
  ownerName: z.string().min(1),
  // Optional for back-compat with pre-mirror control planes.
  isPlatformAdmin: z.boolean().optional(),
})

const acceptInvitationSchema = z.object({
  workosUserId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  isPlatformAdmin: z.boolean().optional(),
})

interface InternalHandlersDeps {
  workspaceService: WorkspaceService
  invitationService: InvitationService
  platformAdminService: PlatformAdminService
}

export function createInternalHandlers(deps: InternalHandlersDeps) {
  const { workspaceService, invitationService, platformAdminService } = deps

  return {
    /**
     * POST /internal/workspaces
     * Called by the control-plane to create a workspace in this region.
     * Accepts a pre-generated workspace ID and slug.
     */
    async createWorkspace(req: Request, res: Response) {
      const result = createWorkspaceSchema.safeParse(req.body)
      if (!result.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      const { id, name, slug, ownerWorkosUserId, ownerEmail, ownerName, isPlatformAdmin } = result.data

      const workspace = await workspaceService.createWorkspaceFromControlPlane({
        id,
        name,
        slug,
        ownerWorkosUserId,
        ownerEmail,
        ownerName,
      })

      if (isPlatformAdmin) {
        await platformAdminService.set(ownerWorkosUserId, true)
      }

      res.status(201).json({ workspace })
    },

    /**
     * POST /internal/invitations/:id/accept
     * Called by the control-plane to accept a specific invitation in this region.
     */
    async acceptInvitation(req: Request, res: Response) {
      const invitationId = req.params.id
      if (!invitationId) {
        throw new HttpError("Missing invitation ID", { status: 400, code: "MISSING_INVITATION_ID" })
      }

      const result = acceptInvitationSchema.safeParse(req.body)
      if (!result.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      const { isPlatformAdmin, ...identity } = result.data
      const workspaceId = await invitationService.acceptInvitation(invitationId, identity)

      if (!workspaceId) {
        throw new HttpError("Invitation not found or already processed", {
          status: 404,
          code: "INVITATION_NOT_FOUND",
        })
      }

      if (isPlatformAdmin) {
        await platformAdminService.set(identity.workosUserId, true)
      }

      res.status(200).json({ workspaceId })
    },
  }
}
