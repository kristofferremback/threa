import { ulid } from "ulid"
import { WORKSPACE_PERMISSION_SCOPES, type WorkspacePermissionScope } from "@threa/types"
import { logger } from "../logger"
import type {
  WorkosAppInvitation,
  WorkosOrgService,
  WorkosOrganizationMembership,
  WorkosRoleSummary,
  WorkosUserSummary,
} from "./workos-org-service"

const DEFAULT_SYSTEM_ROLES: WorkosRoleSummary[] = [
  {
    slug: "admin",
    name: "Admin",
    description: "Full workspace administration including integrations, bots, and member management",
    permissions: [
      WORKSPACE_PERMISSION_SCOPES.MESSAGES_SEARCH,
      WORKSPACE_PERMISSION_SCOPES.STREAMS_READ,
      WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ,
      WORKSPACE_PERMISSION_SCOPES.MESSAGES_WRITE,
      WORKSPACE_PERMISSION_SCOPES.USERS_READ,
      WORKSPACE_PERMISSION_SCOPES.MEMOS_READ,
      WORKSPACE_PERMISSION_SCOPES.ATTACHMENTS_READ,
      WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE,
      WORKSPACE_PERMISSION_SCOPES.WORKSPACE_ADMIN,
    ] satisfies WorkspacePermissionScope[],
    type: "system",
  },
  {
    slug: "member",
    name: "Member",
    description: "Default workspace member",
    permissions: [
      WORKSPACE_PERMISSION_SCOPES.MESSAGES_SEARCH,
      WORKSPACE_PERMISSION_SCOPES.STREAMS_READ,
      WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ,
      WORKSPACE_PERMISSION_SCOPES.MESSAGES_WRITE,
      WORKSPACE_PERMISSION_SCOPES.USERS_READ,
      WORKSPACE_PERMISSION_SCOPES.MEMOS_READ,
      WORKSPACE_PERMISSION_SCOPES.ATTACHMENTS_READ,
    ] satisfies WorkspacePermissionScope[],
    type: "system",
  },
]

function cloneRoles(roles: WorkosRoleSummary[]): WorkosRoleSummary[] {
  return roles.map((role) => ({
    ...role,
    permissions: [...role.permissions],
  }))
}

export class StubWorkosOrgService implements WorkosOrgService {
  private orgsByExternalId = new Map<string, string>()
  private appInvitations: WorkosAppInvitation[] = []
  private orgRoles = new Map<string, WorkosRoleSummary[]>()
  private memberships = new Map<string, WorkosOrganizationMembership>()
  /** Test helper: let callers pre-populate a user lookup table. */
  public users = new Map<string, WorkosUserSummary>()

  async createOrganization(params: { name: string; externalId: string }): Promise<{ id: string }> {
    const id = `org_stub_${ulid()}`
    this.orgsByExternalId.set(params.externalId, id)
    this.orgRoles.set(id, cloneRoles(DEFAULT_SYSTEM_ROLES))
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

  async listRolesForOrganization(organizationId: string): Promise<WorkosRoleSummary[]> {
    return cloneRoles(this.orgRoles.get(organizationId) ?? DEFAULT_SYSTEM_ROLES)
  }

  async listOrganizationMemberships(organizationId: string): Promise<WorkosOrganizationMembership[]> {
    return [...this.memberships.values()].filter((membership) => membership.organizationId === organizationId)
  }

  async getOrganizationMembership(params: {
    organizationId: string
    userId: string
  }): Promise<WorkosOrganizationMembership | null> {
    return this.memberships.get(`${params.organizationId}:${params.userId}`) ?? null
  }

  async ensureOrganizationMembership(params: {
    organizationId: string
    userId: string
    roleSlug?: string
    roleSlugs?: string[]
  }): Promise<void> {
    const roles = params.roleSlugs ?? (params.roleSlug ? [params.roleSlug] : [])
    this.memberships.set(`${params.organizationId}:${params.userId}`, {
      id: `om_stub_${ulid()}`,
      userId: params.userId,
      organizationId: params.organizationId,
      status: "active",
      role: roles[0] ? { slug: roles[0] } : null,
      roles: roles.map((slug) => ({ slug })),
    })
    logger.info(
      {
        organizationId: params.organizationId,
        userId: params.userId,
        roleSlug: params.roleSlug,
        roleSlugs: params.roleSlugs,
      },
      "Stub: Ensured organization membership"
    )
  }

  async updateOrganizationMembership(params: {
    organizationMembershipId: string
    roleSlug?: string
    roleSlugs?: string[]
  }): Promise<WorkosOrganizationMembership> {
    const membership =
      [...this.memberships.values()].find((value) => value.id === params.organizationMembershipId) ?? null
    if (!membership) {
      throw new Error(`Stub organization membership not found: ${params.organizationMembershipId}`)
    }

    const roles = params.roleSlugs ?? (params.roleSlug ? [params.roleSlug] : [])
    const updated: WorkosOrganizationMembership = {
      ...membership,
      role: roles[0] ? { slug: roles[0] } : null,
      roles: roles.map((slug) => ({ slug })),
    }
    this.memberships.set(`${membership.organizationId}:${membership.userId}`, updated)
    return updated
  }

  async getWidgetToken(_params: { organizationId: string; userId: string; scopes: string[] }): Promise<string> {
    return "stub_widget_token"
  }
}
