import type { Request, Response } from "express"
import type { Pool } from "pg"
import { z } from "zod"
import { HttpError } from "../lib/errors"
import type { WorkspaceService } from "../features/workspaces"
import type { InvitationService } from "../features/invitations"
import { PlatformAdminRepository } from "../features/platform-admins"

const createWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  ownerWorkosUserId: z.string().min(1),
  ownerEmail: z.string().email(),
  ownerName: z.string().min(1),
  /**
   * When true, the owner is a platform admin on the control plane. The
   * regional backend mirrors this into `platform_admins` so /api/auth/me can
   * report it without a cross-service call. Defaults to false for
   * back-compat with older control-plane versions.
   */
  isPlatformAdmin: z.boolean().optional(),
})

const acceptInvitationSchema = z.object({
  workosUserId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  isPlatformAdmin: z.boolean().optional(),
})

interface InternalHandlersDeps {
  pool: Pool
  workspaceService: WorkspaceService
  invitationService: InvitationService
}

export function createInternalHandlers(deps: InternalHandlersDeps) {
  const { pool, workspaceService, invitationService } = deps

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
        await PlatformAdminRepository.grant(pool, ownerWorkosUserId)
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
        await PlatformAdminRepository.grant(pool, identity.workosUserId)
      }

      res.status(200).json({ workspaceId })
    },
  }
}
