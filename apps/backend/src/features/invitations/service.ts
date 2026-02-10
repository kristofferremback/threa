import { Pool } from "pg"
import { withTransaction } from "../../db"
import { InvitationRepository, type Invitation } from "./repository"
import { WorkspaceRepository, MemberRepository } from "../workspaces"
import { UserRepository } from "../../auth/user-repository"
import { OutboxRepository } from "../../lib/outbox"
import { invitationId } from "../../lib/id"
import { memberId as generateMemberId } from "../../lib/id"
import { generateUniqueSlug } from "../../lib/slug"
import { logger } from "../../lib/logger"
import type { WorkosOrgService } from "../../auth/workos-org-service"
import type { InvitationStatus } from "@threa/types"

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface SendInvitationsParams {
  workspaceId: string
  invitedBy: string // member_id
  emails: string[]
  role: "admin" | "member"
}

interface SendResult {
  sent: Invitation[]
  skipped: Array<{ email: string; reason: string }>
}

export class InvitationService {
  constructor(
    private pool: Pool,
    private workosOrgService: WorkosOrgService
  ) {}

  async sendInvitations(params: SendInvitationsParams): Promise<SendResult> {
    const { workspaceId, invitedBy, role } = params
    const emails = params.emails.map((e) => e.toLowerCase().trim())

    const sent: Invitation[] = []
    const skipped: Array<{ email: string; reason: string }> = []

    // Ensure workspace has a WorkOS organization (lazy creation)
    const orgId = await this.ensureWorkosOrganization(workspaceId)

    // Look up the inviter's WorkOS user ID for WorkOS API
    const inviterMember = await MemberRepository.findById(this.pool, invitedBy)
    let inviterWorkosUserId: string | undefined
    if (inviterMember) {
      const user = await UserRepository.findById(this.pool, inviterMember.userId)
      inviterWorkosUserId = user?.workosUserId ?? undefined
    }

    for (const email of emails) {
      // Check if already a member (by email → user → member)
      const user = await UserRepository.findByEmail(this.pool, email)
      if (user) {
        const isMember = await WorkspaceRepository.isMember(this.pool, workspaceId, user.id)
        if (isMember) {
          skipped.push({ email, reason: "Already a member" })
          continue
        }
      }

      // Check for existing pending invitation
      const existing = await InvitationRepository.findPendingByEmailAndWorkspace(this.pool, email, workspaceId)
      if (existing) {
        skipped.push({ email, reason: "Invitation already pending" })
        continue
      }

      // Phase 1: Insert local invitation record
      const id = invitationId()
      const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS)

      const invitation = await withTransaction(this.pool, async (client) => {
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

        return inv
      })

      // Phase 2: Send via WorkOS (no DB connection held)
      if (orgId && inviterWorkosUserId) {
        try {
          const workosResult = await this.workosOrgService.sendInvitation({
            organizationId: orgId,
            email,
            inviterUserId: inviterWorkosUserId,
          })

          // Phase 3: Update with WorkOS invitation ID
          await InvitationRepository.setWorkosInvitationId(this.pool, id, workosResult.id)
        } catch (error) {
          logger.error({ err: error, email, invitationId: id }, "Failed to send WorkOS invitation")
          // Local invitation still exists — admin can resend later
        }
      }

      sent.push(invitation)
    }

    return { sent, skipped }
  }

  async acceptInvitation(invitationId: string, userId: string): Promise<string | null> {
    return withTransaction(this.pool, async (client) => {
      // Atomic update with WHERE status = 'pending' AND expires_at > NOW()
      const updated = await InvitationRepository.updateStatus(client, invitationId, "accepted", {
        acceptedAt: new Date(),
      })

      if (!updated) {
        return null // Already accepted, expired, or revoked
      }

      const invitation = await InvitationRepository.findById(client, invitationId)
      if (!invitation) return null

      // Check if already a member (race condition safety)
      const isMember = await WorkspaceRepository.isMember(client, invitation.workspaceId, userId)
      if (isMember) return invitation.workspaceId

      // Create workspace member with setup_completed = false
      const user = await UserRepository.findById(client, userId)
      const memberSlug = user
        ? await generateUniqueSlug(user.name, (s) =>
            WorkspaceRepository.memberSlugExists(client, invitation.workspaceId, s)
          )
        : `member-${generateMemberId().slice(7, 15)}`

      await WorkspaceRepository.addMember(client, {
        id: generateMemberId(),
        workspaceId: invitation.workspaceId,
        userId,
        slug: memberSlug,
        name: user?.name ?? "",
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
    })
  }

  async acceptPendingForEmail(email: string, userId: string): Promise<string[]> {
    const pending = await InvitationRepository.findPendingByEmail(this.pool, email.toLowerCase())
    const acceptedWorkspaceIds: string[] = []

    for (const invitation of pending) {
      const wsId = await this.acceptInvitation(invitation.id, userId)
      if (wsId) {
        acceptedWorkspaceIds.push(wsId)
      }
    }

    return acceptedWorkspaceIds
  }

  async revokeInvitation(invitationId: string, workspaceId: string): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      const invitation = await InvitationRepository.findById(client, invitationId)
      if (!invitation || invitation.workspaceId !== workspaceId) return false

      const updated = await InvitationRepository.updateStatus(client, invitationId, "revoked", {
        revokedAt: new Date(),
      })

      if (!updated) return false

      // Revoke in WorkOS if we have an ID
      if (invitation.workosInvitationId) {
        try {
          await this.workosOrgService.revokeInvitation(invitation.workosInvitationId)
        } catch (error) {
          logger.error({ err: error, invitationId }, "Failed to revoke WorkOS invitation")
        }
      }

      return true
    })
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
    // Check if workspace already has an org
    const existingOrgId = await WorkspaceRepository.getWorkosOrganizationId(this.pool, workspaceId)
    if (existingOrgId) return existingOrgId

    // Lazy create
    const workspace = await WorkspaceRepository.findById(this.pool, workspaceId)
    if (!workspace) return null

    try {
      const org = await this.workosOrgService.createOrganization(workspace.name)
      await WorkspaceRepository.setWorkosOrganizationId(this.pool, workspaceId, org.id)
      return org.id
    } catch (error) {
      logger.error({ err: error, workspaceId }, "Failed to create WorkOS organization")
      return null
    }
  }
}
