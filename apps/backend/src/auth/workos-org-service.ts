import { WorkOS } from "@workos-inc/node"
import { logger } from "../lib/logger"
import type { WorkosConfig } from "../lib/env"

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

export interface WorkosOrgService {
  createOrganization(params: { name: string; externalId: string }): Promise<{ id: string }>
  getOrganizationByExternalId(externalId: string): Promise<{ id: string } | null>
  sendInvitation(params: {
    organizationId: string
    email: string
    inviterUserId: string
  }): Promise<{ id: string; expiresAt: Date }>
  revokeInvitation(invitationId: string): Promise<void>
  getOrganization(organizationId: string): Promise<{ id: string; domains: string[] } | null>
}

export class WorkosOrgServiceImpl implements WorkosOrgService {
  private workos: WorkOS

  constructor(config: WorkosConfig) {
    this.workos = new WorkOS(config.apiKey, { clientId: config.clientId })
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

  async sendInvitation(params: {
    organizationId: string
    email: string
    inviterUserId: string
  }): Promise<{ id: string; expiresAt: Date }> {
    const invitation = await this.workos.userManagement.sendInvitation({
      email: params.email,
      organizationId: params.organizationId,
      inviterUserId: params.inviterUserId,
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
}
