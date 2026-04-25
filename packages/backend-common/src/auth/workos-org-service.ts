import { WorkOS } from "@workos-inc/node"
import { filterWorkspacePermissionScopes, type WorkspacePermissionScope } from "@threa/types"
import { logger } from "../logger"
import type { WorkosConfig } from "./types"

const WORKOS_REQUEST_TIMEOUT_MS = 10_000

type WidgetScope =
  | "widgets:api-keys:manage"
  | "widgets:users-table:manage"
  | "widgets:sso:manage"
  | "widgets:domain-verification:manage"

/**
 * Extract error code from WorkOS SDK exceptions.
 * Duck-typed to handle both BadRequestException (.code) and GenericServerException (.rawData.code).
 */
export function getWorkosErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  if ("code" in error && typeof error.code === "string") return error.code
  if ("rawData" in error && error.rawData && typeof error.rawData === "object" && "code" in error.rawData) {
    return typeof error.rawData.code === "string" ? error.rawData.code : null
  }
  return null
}

/** Shape of an app-level WorkOS invitation as the backoffice needs it. */
export interface WorkosAppInvitation {
  id: string
  email: string
  state: "pending" | "accepted" | "revoked" | "expired"
  acceptedAt: string | null
  revokedAt: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  /** Populated after the invitee signs up; null until accepted. */
  acceptedUserId: string | null
}

/** Minimal WorkOS user shape the backoffice needs for resolving owners. */
export interface WorkosUserSummary {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

export interface WorkosRoleSummary {
  slug: string
  name: string
  description: string | null
  permissions: WorkspacePermissionScope[]
  type: string
}

export interface WorkosMembershipRoleRef {
  slug: string
}

export interface WorkosEventSummary {
  id: string
  event: string
  createdAt: string
  data: Record<string, unknown>
}

export interface WorkosOrganizationMembership {
  id: string
  userId: string
  organizationId: string
  status: "active" | "inactive" | "pending"
  role: WorkosMembershipRoleRef | null
  roles: WorkosMembershipRoleRef[]
}

function mapOrganizationMembership(membership: {
  id: string
  userId: string
  organizationId: string
  status: "active" | "inactive" | "pending"
  role?: { slug: string } | null
  roles?: Array<{ slug: string }> | null
}): WorkosOrganizationMembership {
  return {
    id: membership.id,
    userId: membership.userId,
    organizationId: membership.organizationId,
    status: membership.status,
    role: membership.role ? { slug: membership.role.slug } : null,
    roles: membership.roles?.map((role) => ({ slug: role.slug })) ?? [],
  }
}

export interface WorkosOrgService {
  createOrganization(params: { name: string; externalId: string }): Promise<{ id: string }>
  getOrganizationByExternalId(externalId: string): Promise<{ id: string } | null>
  hasAcceptedWorkspaceCreationInvitation(email: string): Promise<boolean>
  sendInvitation(params: {
    organizationId?: string
    email: string
    inviterUserId: string
  }): Promise<{ id: string; expiresAt: Date }>
  revokeInvitation(invitationId: string): Promise<void>
  /** Resend an existing invitation. WorkOS issues a fresh token + expiry. */
  resendInvitation(invitationId: string): Promise<{ id: string; expiresAt: Date }>
  /**
   * List every app-level WorkOS invitation (no organizationId). Paginates
   * through the full WorkOS result set — backoffice-only surface, not meant
   * for large tenants.
   */
  listAppInvitations(): Promise<WorkosAppInvitation[]>
  /** Look up a user by WorkOS id. Returns null if the user no longer exists. */
  getUser(workosUserId: string): Promise<WorkosUserSummary | null>
  getOrganization(organizationId: string): Promise<{ id: string; domains: string[] } | null>
  listRolesForOrganization(organizationId: string): Promise<WorkosRoleSummary[]>
  listOrganizationMemberships(organizationId: string): Promise<WorkosOrganizationMembership[]>
  getOrganizationMembership(params: {
    organizationId: string
    userId: string
  }): Promise<WorkosOrganizationMembership | null>
  ensureOrganizationMembership(params: {
    organizationId: string
    userId: string
    roleSlug?: string
    roleSlugs?: string[]
  }): Promise<void>
  updateOrganizationMembership(params: {
    organizationMembershipId: string
    roleSlug?: string
    roleSlugs?: string[]
  }): Promise<WorkosOrganizationMembership>
  listEvents(params: { events: string[]; after?: string; limit?: number }): Promise<{
    data: WorkosEventSummary[]
    after: string | null
  }>
  getWidgetToken(params: { organizationId: string; userId: string; scopes: string[] }): Promise<string>
}

export class WorkosOrgServiceImpl implements WorkosOrgService {
  private workos: WorkOS
  private apiKey: string

  constructor(config: WorkosConfig) {
    this.apiKey = config.apiKey
    this.workos = new WorkOS(config.apiKey, { clientId: config.clientId })
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.workos.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(WORKOS_REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`WorkOS ${method} ${path} failed with ${response.status}: ${await response.text()}`)
    }

    return response.json() as Promise<T>
  }

  async createOrganization(params: { name: string; externalId: string }): Promise<{ id: string }> {
    const org = await this.workos.organizations.createOrganization({
      name: params.name,
      externalId: params.externalId,
    })
    logger.info({ orgId: org.id, externalId: params.externalId }, "Created WorkOS organization")
    return { id: org.id }
  }

  async getOrganizationByExternalId(externalId: string): Promise<{ id: string } | null> {
    try {
      const org = await this.workos.organizations.getOrganizationByExternalId(externalId)
      return { id: org.id }
    } catch {
      return null
    }
  }

  async hasAcceptedWorkspaceCreationInvitation(email: string): Promise<boolean> {
    try {
      const normalizedEmail = email.toLowerCase()
      let after: string | undefined

      for (;;) {
        const invitations = await this.workos.userManagement.listInvitations({
          email: normalizedEmail,
          limit: 100,
          ...(after ? { after } : {}),
        })

        const hasAcceptedAppInvitation = invitations.data.some(
          (invitation) => invitation.state === "accepted" && invitation.organizationId == null
        )
        if (hasAcceptedAppInvitation) {
          return true
        }

        after = invitations.listMetadata.after ?? undefined
        if (!after) {
          return false
        }
      }
    } catch (error) {
      logger.error({ err: error, email }, "Failed to list WorkOS invitations")
      throw error
    }
  }

  async sendInvitation(params: {
    organizationId?: string
    email: string
    inviterUserId: string
  }): Promise<{ id: string; expiresAt: Date }> {
    const invitation = await this.workos.userManagement.sendInvitation({
      email: params.email,
      inviterUserId: params.inviterUserId,
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
    })
    logger.info({ invitationId: invitation.id, email: params.email }, "Sent WorkOS invitation")
    return {
      id: invitation.id,
      expiresAt: new Date(invitation.expiresAt),
    }
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    await this.workos.userManagement.revokeInvitation(invitationId)
    logger.info({ invitationId }, "Revoked WorkOS invitation")
  }

  async resendInvitation(invitationId: string): Promise<{ id: string; expiresAt: Date }> {
    const fresh = await this.workos.userManagement.resendInvitation(invitationId)
    logger.info({ invitationId, newInvitationId: fresh.id }, "Resent WorkOS invitation")
    return { id: fresh.id, expiresAt: new Date(fresh.expiresAt) }
  }

  async getUser(workosUserId: string): Promise<WorkosUserSummary | null> {
    try {
      const user = await this.workos.userManagement.getUser(workosUserId)
      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      }
    } catch (error) {
      logger.warn({ err: error, workosUserId }, "Failed to load WorkOS user")
      return null
    }
  }

  async listAppInvitations(): Promise<WorkosAppInvitation[]> {
    const results: WorkosAppInvitation[] = []
    let after: string | undefined

    for (;;) {
      const page = await this.workos.userManagement.listInvitations({
        limit: 100,
        ...(after ? { after } : {}),
      })

      for (const invite of page.data) {
        // App-level invitations only — scoped invites are handled inside
        // their owning workspace, not the global backoffice.
        if (invite.organizationId != null) continue
        results.push({
          id: invite.id,
          email: invite.email,
          state: invite.state,
          acceptedAt: invite.acceptedAt ?? null,
          revokedAt: invite.revokedAt ?? null,
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt,
          updatedAt: invite.updatedAt,
          acceptedUserId: invite.acceptedUserId ?? null,
        })
      }

      after = page.listMetadata.after ?? undefined
      if (!after) return results
    }
  }

  async getOrganization(organizationId: string): Promise<{ id: string; domains: string[] } | null> {
    try {
      const org = await this.workos.organizations.getOrganization(organizationId)
      const domains = org.domains?.map((d) => d.domain).filter(Boolean) ?? []
      return { id: org.id, domains }
    } catch (error) {
      logger.error({ err: error, organizationId }, "Failed to get WorkOS organization")
      return null
    }
  }

  async listRolesForOrganization(organizationId: string): Promise<WorkosRoleSummary[]> {
    const roles = await this.request<{
      data: Array<{
        slug: string
        name: string
        description: string | null
        permissions: string[]
        type: string
      }>
    }>("GET", `/authorization/organizations/${organizationId}/roles`)
    return roles.data.map((role) => ({
      slug: role.slug,
      name: role.name,
      description: role.description ?? null,
      permissions: filterWorkspacePermissionScopes(role.permissions),
      type: role.type,
    }))
  }

  async listOrganizationMemberships(organizationId: string): Promise<WorkosOrganizationMembership[]> {
    const results: WorkosOrganizationMembership[] = []
    let after: string | undefined

    for (;;) {
      const page = await this.workos.userManagement.listOrganizationMemberships({
        organizationId,
        statuses: ["active", "inactive", "pending"],
        limit: 100,
        ...(after ? { after } : {}),
      })

      results.push(...page.data.map(mapOrganizationMembership))
      after = page.listMetadata.after ?? undefined
      if (!after) return results
    }
  }

  async getOrganizationMembership(params: {
    organizationId: string
    userId: string
  }): Promise<WorkosOrganizationMembership | null> {
    const memberships = await this.workos.userManagement.listOrganizationMemberships({
      organizationId: params.organizationId,
      userId: params.userId,
      statuses: ["active", "inactive", "pending"],
      limit: 1,
    })
    const membership = memberships.data[0]
    if (!membership) {
      return null
    }

    return mapOrganizationMembership(membership)
  }

  async ensureOrganizationMembership(params: {
    organizationId: string
    userId: string
    roleSlug?: string
    roleSlugs?: string[]
  }): Promise<void> {
    try {
      await this.workos.userManagement.createOrganizationMembership({
        organizationId: params.organizationId,
        userId: params.userId,
        ...(params.roleSlug ? { roleSlug: params.roleSlug } : {}),
        ...(params.roleSlugs ? { roleSlugs: params.roleSlugs } : {}),
      })
      logger.info(
        {
          organizationId: params.organizationId,
          userId: params.userId,
          roleSlug: params.roleSlug,
          roleSlugs: params.roleSlugs,
        },
        "Created WorkOS organization membership"
      )
    } catch (error) {
      const code = getWorkosErrorCode(error)
      if (code === "user_already_organization_member") {
        if (!params.roleSlug && !params.roleSlugs) {
          return
        }
        const existing = await this.getOrganizationMembership({
          organizationId: params.organizationId,
          userId: params.userId,
        })
        if (!existing) {
          return
        }
        await this.updateOrganizationMembership({
          organizationMembershipId: existing.id,
          ...(params.roleSlug ? { roleSlug: params.roleSlug } : {}),
          ...(params.roleSlugs ? { roleSlugs: params.roleSlugs } : {}),
        })
        return
      }
      throw error
    }
  }

  async updateOrganizationMembership(params: {
    organizationMembershipId: string
    roleSlug?: string
    roleSlugs?: string[]
  }): Promise<WorkosOrganizationMembership> {
    const membership = await this.workos.userManagement.updateOrganizationMembership(params.organizationMembershipId, {
      ...(params.roleSlug ? { roleSlug: params.roleSlug } : {}),
      ...(params.roleSlugs ? { roleSlugs: params.roleSlugs } : {}),
    })

    return {
      id: membership.id,
      userId: membership.userId,
      organizationId: membership.organizationId,
      status: membership.status,
      role: membership.role ? { slug: membership.role.slug } : null,
      roles: membership.roles?.map((role) => ({ slug: role.slug })) ?? [],
    }
  }

  async listEvents(params: { events: string[]; after?: string; limit?: number }): Promise<{
    data: WorkosEventSummary[]
    after: string | null
  }> {
    const response = await this.workos.events.listEvents({
      events: params.events as never,
      after: params.after,
      limit: params.limit,
    })

    return {
      data: response.data.map((event) => ({
        id: event.id,
        event: event.event,
        createdAt: event.createdAt,
        data: event.data as Record<string, unknown>,
      })),
      after: response.listMetadata.after ?? null,
    }
  }

  async getWidgetToken(params: { organizationId: string; userId: string; scopes: string[] }): Promise<string> {
    const token = await this.workos.widgets.getToken({
      organizationId: params.organizationId,
      userId: params.userId,
      scopes: params.scopes as WidgetScope[],
    })
    return token
  }
}
