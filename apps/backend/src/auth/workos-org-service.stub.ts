import { ulid } from "ulid"
import { logger } from "../lib/logger"
import type { WorkosOrgService } from "./workos-org-service"

export class StubWorkosOrgService implements WorkosOrgService {
  private orgsByExternalId = new Map<string, string>()

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

  async sendInvitation(params: {
    organizationId: string
    email: string
    inviterUserId: string
  }): Promise<{ id: string; expiresAt: Date }> {
    const id = `inv_stub_${ulid()}`
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    logger.info({ invitationId: id, email: params.email }, "Stub: Sent invitation (no email)")
    return { id, expiresAt }
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    logger.info({ invitationId }, "Stub: Revoked invitation")
  }

  async getOrganization(organizationId: string): Promise<{ id: string; domains: string[] } | null> {
    return { id: organizationId, domains: [] }
  }
}
