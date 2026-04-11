import { ulid } from "ulid"
import { logger } from "../logger"
import type { WorkosAppInvitation, WorkosOrgService, WorkosUserSummary } from "./workos-org-service"

export class StubWorkosOrgService implements WorkosOrgService {
  private orgsByExternalId = new Map<string, string>()
  private appInvitations: WorkosAppInvitation[] = []
  /** Test helper: let callers pre-populate a user lookup table. */
  public users = new Map<string, WorkosUserSummary>()

  async createOrganization(params: { name: string; externalId: string }): Promise<{ id: string }> {
    const id = `org_stub_${ulid()}`
    this.orgsByExternalId.set(params.externalId, id)
    logger.info({ orgId: id, name: params.name, externalId: params.externalId }, "Stub: Created organization")
    return { id }
  }

  async getOrganizationByExternalId(externalId: string): Promise<{ id: string } | null> {
    const id = this.orgsByExternalId.get(externalId)
    return id ? { id } : null
  }

  async hasAcceptedWorkspaceCreationInvitation(_email: string): Promise<boolean> {
    return true
  }

  async sendInvitation(params: {
    organizationId?: string
    email: string
    inviterUserId: string
  }): Promise<{ id: string; expiresAt: Date }> {
    const id = `inv_stub_${ulid()}`
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    if (params.organizationId == null) {
      const now = new Date().toISOString()
      this.appInvitations.push({
        id,
        email: params.email,
        state: "pending",
        acceptedAt: null,
        revokedAt: null,
        expiresAt: expiresAt.toISOString(),
        createdAt: now,
        updatedAt: now,
        acceptedUserId: null,
      })
    }
    logger.info({ invitationId: id, email: params.email }, "Stub: Sent invitation (no email)")
    return { id, expiresAt }
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    const existing = this.appInvitations.find((i) => i.id === invitationId)
    if (existing) {
      existing.state = "revoked"
      existing.revokedAt = new Date().toISOString()
      existing.updatedAt = existing.revokedAt
    }
    logger.info({ invitationId }, "Stub: Revoked invitation")
  }

  async resendInvitation(invitationId: string): Promise<{ id: string; expiresAt: Date }> {
    const existing = this.appInvitations.find((i) => i.id === invitationId)
    if (!existing) {
      const id = `inv_stub_${ulid()}`
      return { id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
    }
    // Mirror the real service: mark the old as revoked and create a new one.
    existing.state = "revoked"
    existing.revokedAt = new Date().toISOString()
    existing.updatedAt = existing.revokedAt
    const fresh = await this.sendInvitation({ email: existing.email, inviterUserId: "stub" })
    logger.info({ oldInvitationId: invitationId, newInvitationId: fresh.id }, "Stub: Resent invitation")
    return fresh
  }

  async listAppInvitations(): Promise<WorkosAppInvitation[]> {
    return [...this.appInvitations]
  }

  async getUser(workosUserId: string): Promise<WorkosUserSummary | null> {
    return this.users.get(workosUserId) ?? null
  }

  async getOrganization(organizationId: string): Promise<{ id: string; domains: string[] } | null> {
    return { id: organizationId, domains: [] }
  }

  async ensureOrganizationMembership(params: {
    organizationId: string
    userId: string
    roleSlug: string
  }): Promise<void> {
    logger.info(
      { organizationId: params.organizationId, userId: params.userId, roleSlug: params.roleSlug },
      "Stub: Ensured organization membership"
    )
  }

  async getWidgetToken(_params: { organizationId: string; userId: string; scopes: string[] }): Promise<string> {
    return "stub_widget_token"
  }
}
