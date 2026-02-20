import { z } from "zod"
import type { Request, Response } from "express"
import type { InvitationService } from "./service"

const sendInvitationsSchema = z.object({
  emails: z
    .array(z.string().email("Invalid email address"))
    .min(1, "At least one email is required")
    .max(20, "Maximum 20 emails per request"),
  role: z.enum(["admin", "member"]).optional().default("member"),
})

const sendWorkspaceCreationInvitationsSchema = z.object({
  emails: z
    .array(z.string().email("Invalid email address"))
    .min(1, "At least one email is required")
    .max(20, "Maximum 20 emails per request"),
})

interface Dependencies {
  invitationService: InvitationService
}

export function createInvitationHandlers({ invitationService }: Dependencies) {
  return {
    async send(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const memberId = req.member!.id

      const result = sendInvitationsSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { emails, role } = result.data

      const sendResult = await invitationService.sendInvitations({
        workspaceId,
        invitedBy: memberId,
        emails,
        role,
      })

      res.status(201).json(sendResult)
    },

    async list(req: Request, res: Response) {
      const workspaceId = req.workspaceId!

      const invitations = await invitationService.listInvitations(workspaceId)

      res.json({ invitations })
    },

    async sendWorkspaceCreation(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const memberId = req.member!.id

      const result = sendWorkspaceCreationInvitationsSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const sendResult = await invitationService.sendWorkspaceCreationInvitations({
        workspaceId,
        invitedBy: memberId,
        emails: result.data.emails,
      })

      res.status(201).json(sendResult)
    },

    async revoke(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { invitationId } = req.params

      const revoked = await invitationService.revokeInvitation(invitationId, workspaceId)

      if (!revoked) {
        return res.status(404).json({ error: "Invitation not found or already processed" })
      }

      res.json({ success: true })
    },

    async resend(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const { invitationId } = req.params

      const invitation = await invitationService.resendInvitation(invitationId, workspaceId)

      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found or not pending" })
      }

      res.json({ invitation })
    },
  }
}
