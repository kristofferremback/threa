import { WorkOS } from "@workos-inc/node"
import { logger } from "../lib/logger"
import type { WorkosConfig } from "../lib/env"

export interface WorkosOrgService {
  createOrganization(name: string): Promise<{ id: string }>
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

  async createOrganization(name: string): Promise<{ id: string }> {
    const org = await this.workos.organizations.createOrganization({
      name,
    })
    logger.info({ orgId: org.id }, "Created WorkOS organization")
    return { id: org.id }
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
