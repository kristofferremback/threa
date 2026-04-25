import type { Request, Response } from "express"
import { z } from "zod"
import { filterWorkspacePermissionScopes, type WorkspaceAuthzSnapshot, type WorkspaceRole } from "@threa/types"
import { HttpError } from "../lib/errors"
import type { WorkspaceService } from "../features/workspaces"
import type { InvitationService } from "../features/invitations"

const createWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  ownerWorkosUserId: z.string().min(1),
  ownerEmail: z.string().email(),
  ownerName: z.string().min(1),
})

const acceptInvitationSchema = z.object({
  workosUserId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
})

const workspaceRoleSchema: z.ZodType<WorkspaceRole> = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  permissions: z.array(z.string()).transform(filterWorkspacePermissionScopes),
  type: z.string().min(1),
})

const workspaceAuthzSnapshotSchema: z.ZodType<WorkspaceAuthzSnapshot> = z.object({
  workspaceId: z.string().min(1),
  workosOrganizationId: z.string().min(1),
  revision: z.string().min(1),
  generatedAt: z.string().datetime(),
  roles: z.array(workspaceRoleSchema),
  memberships: z.array(
    z.object({
      organizationMembershipId: z.string().min(1),
      workosUserId: z.string().min(1),
      roleSlugs: z.array(z.string().min(1)),
    })
  ),
})

interface InternalHandlersDeps {
  workspaceService: WorkspaceService
  invitationService: InvitationService
}

export function createInternalHandlers(deps: InternalHandlersDeps) {
  const { workspaceService, invitationService } = deps

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

      const { id, name, slug, ownerWorkosUserId, ownerEmail, ownerName } = result.data

      const workspace = await workspaceService.createWorkspaceFromControlPlane({
        id,
        name,
        slug,
        ownerWorkosUserId,
        ownerEmail,
        ownerName,
      })

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

      const workspaceId = await invitationService.acceptInvitation(invitationId, result.data)

      if (!workspaceId) {
        throw new HttpError("Invitation not found or already processed", {
          status: 404,
          code: "INVITATION_NOT_FOUND",
        })
      }

      res.status(200).json({ workspaceId })
    },

    /**
     * PUT /internal/workspaces/:workspaceId/authz-snapshot
     * Called by the control-plane to replace the regional authz mirror for a workspace.
     */
    async applyWorkspaceAuthzSnapshot(req: Request, res: Response) {
      const workspaceId = req.params.workspaceId
      if (!workspaceId) {
        throw new HttpError("Missing workspace ID", { status: 400, code: "MISSING_WORKSPACE_ID" })
      }

      const result = workspaceAuthzSnapshotSchema.safeParse(req.body)
      if (!result.success || result.data.workspaceId !== workspaceId) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      const applied = await workspaceService.applyWorkosAuthzSnapshot(result.data)
      res.status(200).json({ applied })
    },
  }
}
