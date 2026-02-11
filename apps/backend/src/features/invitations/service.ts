import { Pool } from "pg"
import { withTransaction, type Querier } from "../../db"
import { InvitationRepository, type Invitation } from "./repository"
import { WorkspaceRepository, type WorkspaceService } from "../workspaces"
import { MemberRepository } from "../workspaces"
import { UserRepository } from "../../auth/user-repository"
import { OutboxRepository } from "../../lib/outbox"
import { invitationId } from "../../lib/id"
import { logger } from "../../lib/logger"
import { getWorkosErrorCode, type WorkosOrgService } from "../../auth/workos-org-service"
import type { InvitationSkipReason, InvitationStatus } from "@threa/types"

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

const WORKOS_ERROR_CODES = {
  USER_ALREADY_MEMBER: "user_already_organization_member",
  INVITE_NOT_PENDING: "invite_not_pending",
} as const

interface SendInvitationsParams {
  workspaceId: string
  invitedBy: string // member_id
  emails: string[]
  role: "admin" | "member"
}

interface SendResult {
  sent: Invitation[]
  skipped: Array<{ email: string; reason: InvitationSkipReason }>
}

export interface AcceptPendingResult {
  accepted: string[] // workspace IDs
  failed: Array<{ invitationId: string; email: string; error: string }>
}

export class InvitationService {
  constructor(
    private pool: Pool,
    private workosOrgService: WorkosOrgService,
    private workspaceService: WorkspaceService
  ) {}

  async sendInvitations(params: SendInvitationsParams): Promise<SendResult> {
    const { workspaceId, invitedBy, role } = params
    const emails = params.emails.map((e) => e.toLowerCase().trim())

    const skipped: SendResult["skipped"] = []

    // Ensure workspace has a WorkOS organization (lazy creation)
    const orgId = await this.ensureWorkosOrganization(workspaceId)

    // Look up the inviter's WorkOS user ID for WorkOS API
    const inviterMember = await MemberRepository.findById(this.pool, invitedBy)
    let inviterWorkosUserId: string | undefined
    if (inviterMember) {
      const user = await UserRepository.findById(this.pool, inviterMember.userId)
      inviterWorkosUserId = user?.workosUserId ?? undefined
    }

    // Batch-fetch: users by email, existing members, pending invitations
    const existingUsers = await UserRepository.findByEmails(this.pool, emails)
    const usersByEmail = new Map(existingUsers.map((u) => [u.email, u]))

    const userIds = existingUsers.map((u) => u.id)
    const memberUserIds = await WorkspaceRepository.findMemberUserIds(this.pool, workspaceId, userIds)

    const pendingInvitations = await InvitationRepository.findPendingByEmailsAndWorkspace(
      this.pool,
      emails,
      workspaceId
    )
    const pendingEmails = new Set(pendingInvitations.map((inv) => inv.email))

    // Build list of emails to send (filter skipped)
    const emailsToSend: string[] = []
    for (const email of emails) {
      const user = usersByEmail.get(email)
      if (user && memberUserIds.has(user.id)) {
        skipped.push({ email, reason: "already_member" })
        continue
      }
      if (pendingEmails.has(email)) {
        skipped.push({ email, reason: "pending_invitation" })
        continue
      }
      emailsToSend.push(email)
    }

    if (emailsToSend.length === 0) return { sent: [], skipped }

    // Phase 1: Single transaction — all invitation inserts + outbox events
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
        })

        invitations.push(inv)
      }
      return invitations
    })

    // Phase 2: Parallel WorkOS API calls (no DB connection held)
    if (orgId && inviterWorkosUserId) {
      const results = await Promise.allSettled(
        sent.map((inv) =>
          this.workosOrgService.sendInvitation({
            organizationId: orgId!,
            email: inv.email,
            inviterUserId: inviterWorkosUserId!,
          })
        )
      )

      // Phase 3: Update WorkOS IDs for successful sends
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === "fulfilled") {
          await InvitationRepository.setWorkosInvitationId(this.pool, sent[i].id, result.value.id)
        } else {
          const errorCode = getWorkosErrorCode(result.reason)
          const isKnownStateConflict = errorCode === WORKOS_ERROR_CODES.USER_ALREADY_MEMBER

          if (isKnownStateConflict) {
            logger.warn(
              { errorCode, email: sent[i].email, invitationId: sent[i].id },
              "WorkOS state conflict when sending invitation (user already member)"
            )
          } else {
            logger.error(
              { err: result.reason, email: sent[i].email, invitationId: sent[i].id },
              "Failed to send WorkOS invitation"
            )
          }
        }
      }
    }

    return { sent, skipped }
  }

  async acceptInvitation(invitationId: string, userId: string): Promise<string | null> {
    return withTransaction(this.pool, async (client) => {
      return this.acceptInvitationInTransaction(client, invitationId, userId)
    })
  }

  private async acceptInvitationInTransaction(
    client: Querier,
    invitationId: string,
    userId: string
  ): Promise<string | null> {
    const now = new Date()
    const updated = await InvitationRepository.updateStatus(client, invitationId, "accepted", {
      acceptedAt: now,
      notExpiredAt: now,
    })

    if (!updated) {
      return null // Already accepted, expired, or revoked
    }

    const invitation = await InvitationRepository.findById(client, invitationId)
    if (!invitation) return null

    // Check if already a member (race condition safety)
    const isMember = await WorkspaceRepository.isMember(client, invitation.workspaceId, userId)
    if (isMember) return invitation.workspaceId

    await this.workspaceService.createMemberInTransaction(client, {
      workspaceId: invitation.workspaceId,
      userId,
      role: invitation.role,
      setupCompleted: false,
    })

    await OutboxRepository.insert(client, "invitation:accepted", {
      workspaceId: invitation.workspaceId,
      invitationId: invitation.id,
      email: invitation.email,
      userId,
    })

    return invitation.workspaceId
  }

  async acceptPendingForEmail(email: string, userId: string): Promise<AcceptPendingResult> {
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
          const wsId = await this.acceptInvitationInTransaction(client, invitation.id, userId)
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
    // Phase 1: Update local status in transaction
    const invitation = await withTransaction(this.pool, async (client) => {
      const inv = await InvitationRepository.findById(client, invitationId)
      if (!inv || inv.workspaceId !== workspaceId) return null

      const updated = await InvitationRepository.updateStatus(client, invitationId, "revoked", {
        revokedAt: new Date(),
      })

      return updated ? inv : null
    })

    if (!invitation) return false

    // Phase 2: Revoke in WorkOS (no DB connection held)
    if (invitation.workosInvitationId) {
      try {
        await this.workosOrgService.revokeInvitation(invitation.workosInvitationId)
      } catch (error) {
        const errorCode = getWorkosErrorCode(error)
        const isKnownStateConflict = errorCode === WORKOS_ERROR_CODES.INVITE_NOT_PENDING

        if (isKnownStateConflict) {
          logger.warn(
            { errorCode, invitationId },
            "WorkOS state conflict when revoking invitation (invite not pending)"
          )
        } else {
          logger.error({ err: error, invitationId }, "Failed to revoke WorkOS invitation")
        }
      }
    }

    return true
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

  private async ensureWorkosOrganization(workspaceId: string): Promise<string | null> {
    // Phase 1: Check local DB (no connection held after query)
    const existingOrgId = await WorkspaceRepository.getWorkosOrganizationId(this.pool, workspaceId)
    if (existingOrgId) return existingOrgId

    // Phase 2: Check WorkOS by external ID — survives local DB wipes
    const existingOrg = await this.workosOrgService.getOrganizationByExternalId(workspaceId)
    if (existingOrg) {
      await WorkspaceRepository.setWorkosOrganizationId(this.pool, workspaceId, existingOrg.id)
      return existingOrg.id
    }

    // Phase 3: Create new org in WorkOS (no connection held)
    const workspace = await WorkspaceRepository.findById(this.pool, workspaceId)
    if (!workspace) return null

    try {
      const org = await this.workosOrgService.createOrganization({ name: workspace.name, externalId: workspaceId })

      // Save with optimistic guard — setWorkosOrganizationId uses
      // WHERE workos_organization_id IS NULL, so concurrent losers no-op
      await WorkspaceRepository.setWorkosOrganizationId(this.pool, workspaceId, org.id)
    } catch (error) {
      logger.error({ err: error, workspaceId }, "Failed to create WorkOS organization")
    }

    // Re-read to get the winning org ID (handles race where another caller saved first)
    return WorkspaceRepository.getWorkosOrganizationId(this.pool, workspaceId)
  }
}
