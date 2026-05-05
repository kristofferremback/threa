import { z } from "zod"
import type { Request, Response } from "express"
import { HttpError } from "../../lib/errors"
import type { InvitationService, InvitationLinkErrorCode } from "./service"
import { InvitationLinkError } from "./service"

const sendInvitationsSchema = z.object({
  emails: z
    .array(z.string().email("Invalid email address"))
    .min(1, "At least one email is required")
    .max(20, "Maximum 20 emails per request"),
  role: z.enum(["admin", "user"]).optional().default("user"),
})

const createLinkSchema = z.object({
  role: z.enum(["admin", "user"]),
  note: z.string().trim().max(200).optional(),
})

const claimLinkSchema = z.object({
  token: z.string().min(1).max(200),
  email: z.string().email(),
})

const LINK_ERROR_HTTP: Record<InvitationLinkErrorCode, { status: number }> = {
  INVITATION_NOT_FOUND: { status: 404 },
  INVITATION_REVOKED: { status: 409 },
  INVITATION_EXPIRED: { status: 409 },
  INVITATION_ALREADY_CLAIMED: { status: 409 },
}

interface Dependencies {
  invitationService: InvitationService
}

export function createInvitationHandlers({ invitationService }: Dependencies) {
  return {
    async send(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const userId = req.user!.id

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
        invitedBy: userId,
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

    /**
     * Admin-auth: create a single-use link invite. The plaintext token is
     * returned exactly once; only the SHA-256 hash is persisted.
     */
    async createLink(req: Request, res: Response) {
      const workspaceId = req.workspaceId!
      const userId = req.user!.id

      const result = createLinkSchema.safeParse(req.body)
      if (!result.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: z.flattenError(result.error).fieldErrors,
        })
      }

      const { invitation, token } = await invitationService.createLink({
        workspaceId,
        invitedBy: userId,
        role: result.data.role,
        note: result.data.note?.trim() || null,
      })

      // Token returned exactly once. Frontend constructs the join URL from
      // window.location.origin so we don't have to plumb a public-app-URL env
      // through to the regional backend (and it just-works across staging,
      // PR previews, and prod without per-env config).
      res.status(201).json({ invitation, token })
    },

    /**
     * Internal-only (called from CP): atomically claim a link by its token.
     * Translates `InvitationLinkError` into `HttpError` so the central error
     * middleware ships consistent error codes.
     */
    async claimLink(req: Request, res: Response) {
      const result = claimLinkSchema.safeParse(req.body)
      if (!result.success) {
        throw new HttpError("Invalid request body", { status: 400, code: "VALIDATION_ERROR" })
      }

      try {
        const claimResult = await invitationService.claimLinkByToken(result.data.token, result.data.email)
        res.json({ ok: true, ...(claimResult.alreadyMember ? { alreadyMember: claimResult.alreadyMember } : {}) })
      } catch (err) {
        if (err instanceof InvitationLinkError) {
          throw new HttpError(err.code, { status: LINK_ERROR_HTTP[err.code].status, code: err.code })
        }
        throw err
      }
    },
  }
}
