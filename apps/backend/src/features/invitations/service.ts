import { Pool } from "pg"
import { withTransaction, type Querier } from "../../db"
import { InvitationRepository, type Invitation } from "./repository"
import { UserRepository, type WorkspaceService } from "../workspaces"
import { PlatformAdminRepository } from "../platform-admins"
import { OutboxRepository } from "../../lib/outbox"
import { invitationId } from "../../lib/id"
import { logger } from "../../lib/logger"
import type { InvitationSkipReason, InvitationStatus } from "@threa/types"

interface AcceptInvitationOptions {
  /**
   * When true, grant platform-admin in the same transaction as the invitation
   * acceptance so the user's /api/auth/me reflects it without waiting for the
   * next control-plane reconcile sweep.
   */
  isPlatformAdmin?: boolean
}

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface SendInvitationsParams {
  workspaceId: string
  invitedBy: string // user_id
  emails: string[]
  role: "admin" | "user"
}

interface SendResult {
  sent: Invitation[]
  skipped: Array<{ email: string; reason: InvitationSkipReason }>
}

export interface AcceptPendingResult {
  accepted: string[] // workspace IDs
  failed: Array<{ invitationId: string; email: string; error: string }>
}

export interface WorkosIdentity {
  workosUserId: string
  email: string
  name: string
}

export class InvitationService {
  constructor(
    private pool: Pool,
    private workspaceService: WorkspaceService
  ) {}

  async sendInvitations(params: SendInvitationsParams): Promise<SendResult> {
    const { workspaceId, invitedBy, role } = params
    const emails = params.emails.map((e) => e.toLowerCase().trim())

    const skipped: SendResult["skipped"] = []

    // Look up the inviter's WorkOS user ID for the outbox payload
    // (the control-plane uses this to send the WorkOS email)
    const inviterWorkosUserId = (await this.getInviterWorkosUserId(workspaceId, invitedBy)) ?? undefined

    // Batch-fetch: existing members + pending invitations
    const existingUserEmails = await UserRepository.findEmails(this.pool, workspaceId, emails)

    const pendingInvitations = await InvitationRepository.findPendingByEmailsAndWorkspace(
      this.pool,
      emails,
      workspaceId
    )
    const pendingEmails = new Set(pendingInvitations.map((inv) => inv.email))

    // Build list of emails to send (filter skipped)
    const emailsToSend: string[] = []
    for (const email of emails) {
      if (existingUserEmails.has(email)) {
        skipped.push({ email, reason: "already_user" })
        continue
      }
      if (pendingEmails.has(email)) {
        skipped.push({ email, reason: "pending_invitation" })
        continue
      }
      emailsToSend.push(email)
    }

    if (emailsToSend.length === 0) return { sent: [], skipped }

    // Single transaction — all invitation inserts + outbox events
    const sent = await withTransaction(this.pool, async (client) => {
      const invitations: Invitation[] = []
      for (const email of emailsToSend) {
        const id = invitationId()
        const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS)

        const inv = await InvitationRepository.insert(client, {
          id,
          workspaceId,
          email,
          role,
          invitedBy,
          expiresAt,
        })

        await OutboxRepository.insert(client, "invitation:sent", {
          workspaceId,
          invitationId: id,
          email,
          role,
          inviterWorkosUserId,
        })

        invitations.push(inv)
      }
      return invitations
    })

    return { sent, skipped }
  }

  async acceptInvitation(
    invitationId: string,
    identity: WorkosIdentity,
    options?: AcceptInvitationOptions
  ): Promise<string | null> {
    return withTransaction(this.pool, async (client) => {
      return this.acceptInvitationInTransaction(client, invitationId, identity, options)
    })
  }

  private async acceptInvitationInTransaction(
    client: Querier,
    invitationId: string,
    identity: WorkosIdentity,
    options?: AcceptInvitationOptions
  ): Promise<string | null> {
    const now = new Date()
    const updated = await InvitationRepository.updateStatus(client, invitationId, "accepted", {
      acceptedAt: now,
      notExpiredAt: now,
    })

    if (!updated) {
      // Invitation not in pending state — check if this is an idempotent replay.
      // The control-plane retries acceptance if its local DB write failed after the
      // regional call succeeded, so we must return success when the user is already
      // a workspace member (rather than 404, which would leave the shadow stuck).
      const invitation = await InvitationRepository.findById(client, invitationId)
      if (invitation?.status === "accepted") {
        const isMember = await UserRepository.isMember(client, invitation.workspaceId, identity.workosUserId)
        if (isMember) return invitation.workspaceId
      }
      return null
    }

    const invitation = await InvitationRepository.findById(client, invitationId)
    if (!invitation) return null

    // Check if already in the workspace (race condition safety)
    const isMember = await UserRepository.isMember(client, invitation.workspaceId, identity.workosUserId)
    if (isMember) return invitation.workspaceId

    await this.workspaceService.createUserInTransaction(client, {
      workspaceId: invitation.workspaceId,
      workosUserId: identity.workosUserId,
      email: identity.email,
      name: identity.name,
      role: invitation.role,
      setupCompleted: false,
    })

    await OutboxRepository.insert(client, "invitation:accepted", {
      workspaceId: invitation.workspaceId,
      invitationId: invitation.id,
      email: invitation.email,
      workosUserId: identity.workosUserId,
      userName: identity.name,
    })

    if (options?.isPlatformAdmin) {
      await PlatformAdminRepository.grant(client, identity.workosUserId)
    }

    return invitation.workspaceId
  }

  async acceptPendingForEmail(email: string, identity: WorkosIdentity): Promise<AcceptPendingResult> {
    const pending = await InvitationRepository.findPendingByEmail(this.pool, email.toLowerCase())
    if (pending.length === 0) return { accepted: [], failed: [] }

    return withTransaction(this.pool, async (client) => {
      const accepted: string[] = []
      const failed: AcceptPendingResult["failed"] = []

      for (const invitation of pending) {
        try {
          // Savepoint allows partial success: if one invitation fails,
          // we rollback just that one and continue with the rest
          await client.query("SAVEPOINT accept_inv")
          const wsId = await this.acceptInvitationInTransaction(client, invitation.id, identity)
          await client.query("RELEASE SAVEPOINT accept_inv")

          if (wsId) {
            accepted.push(wsId)
          }
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT accept_inv")
          logger.error({ err, invitationId: invitation.id, email }, "Failed to accept invitation")
          failed.push({
            invitationId: invitation.id,
            email: invitation.email,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      return { accepted, failed }
    })
  }

  async revokeInvitation(invitationId: string, workspaceId: string): Promise<boolean> {
    // Update local status + outbox event in one transaction.
    // The outbox event triggers shadow sync → CP handles WorkOS revocation.
    const revoked = await withTransaction(this.pool, async (client) => {
      const inv = await InvitationRepository.findById(client, invitationId)
      if (!inv || inv.workspaceId !== workspaceId) return false

      const updated = await InvitationRepository.updateStatus(client, invitationId, "revoked", {
        revokedAt: new Date(),
      })

      if (updated) {
        await OutboxRepository.insert(client, "invitation:revoked", {
          workspaceId,
          invitationId,
        })
      }

      return updated
    })

    return revoked
  }

  async resendInvitation(invitationId: string, workspaceId: string): Promise<Invitation | null> {
    const invitation = await InvitationRepository.findById(this.pool, invitationId)
    if (!invitation || invitation.workspaceId !== workspaceId || invitation.status !== "pending") {
      return null
    }

    // Revoke old and create new
    await this.revokeInvitation(invitationId, workspaceId)

    const result = await this.sendInvitations({
      workspaceId,
      invitedBy: invitation.invitedBy,
      emails: [invitation.email],
      role: invitation.role,
    })

    return result.sent[0] ?? null
  }

  async listInvitations(workspaceId: string, status?: InvitationStatus): Promise<Invitation[]> {
    // Lazy expiration: mark expired before listing
    await InvitationRepository.markExpired(this.pool, workspaceId)
    return InvitationRepository.listByWorkspace(this.pool, workspaceId, status ? { status } : undefined)
  }

  private async getInviterWorkosUserId(workspaceId: string, invitedBy: string): Promise<string | null> {
    const inviterUser = await UserRepository.findById(this.pool, workspaceId, invitedBy)
    return inviterUser?.workosUserId ?? null
  }
}
