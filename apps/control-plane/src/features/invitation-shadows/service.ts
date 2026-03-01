import type { Pool } from "pg"
import {
  withTransaction,
  displayNameFromWorkos,
  getWorkosErrorCode,
  HttpError,
  logger,
  type WorkosOrgService,
} from "@threa/backend-common"
import { InvitationShadowRepository } from "./repository"
import { WorkspaceRegistryRepository } from "../workspaces/repository"
import type { RegionalClient } from "../../lib/regional-client"
import type { PendingInvitation } from "@threa/types"

const WORKOS_ERROR_CODES = {
  USER_ALREADY_MEMBER: "user_already_organization_member",
  EMAIL_ALREADY_INVITED: "email_already_invited_to_organization",
  INVITE_NOT_PENDING: "invite_not_pending",
} as const

/** User info for shadow acceptance — accepts either pre-derived name (stub) or WorkOS fields */
type ShadowUser =
  | { id: string; email: string; name: string }
  | { id: string; email: string; firstName?: string | null; lastName?: string | null }

interface Dependencies {
  pool: Pool
  regionalClient: RegionalClient
  workosOrgService: WorkosOrgService
}

export class InvitationShadowService {
  private pool: Pool
  private regionalClient: RegionalClient
  private workosOrgService: WorkosOrgService

  constructor({ pool, regionalClient, workosOrgService }: Dependencies) {
    this.pool = pool
    this.regionalClient = regionalClient
    this.workosOrgService = workosOrgService
  }

  private resolveDisplayName(user: ShadowUser): string {
    if ("name" in user && user.name) return user.name
    return displayNameFromWorkos(user)
  }

  /** List pending invitations for a user email, including workspace names */
  async listPendingForEmail(email: string): Promise<PendingInvitation[]> {
    const rows = await InvitationShadowRepository.findPendingByEmailWithWorkspace(this.pool, email)
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      expiresAt: row.expires_at.toISOString(),
    }))
  }

  /** Accept a single shadow invitation on behalf of a user */
  async acceptShadow(shadowId: string, user: ShadowUser): Promise<{ workspaceId: string }> {
    const shadow = await InvitationShadowRepository.findById(this.pool, shadowId)
    if (!shadow || shadow.status !== "pending") {
      throw new HttpError("Invitation not found", { status: 404, code: "NOT_FOUND" })
    }
    if (shadow.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new HttpError("Invitation not found", { status: 404, code: "NOT_FOUND" })
    }

    const name = this.resolveDisplayName(user)

    await this.regionalClient.acceptInvitation(shadow.region, shadow.id, {
      workosUserId: user.id,
      email: user.email,
      name,
    })
    await withTransaction(this.pool, async (client) => {
      await InvitationShadowRepository.updateStatus(client, shadow.id, "accepted")
      await WorkspaceRegistryRepository.insertMembership(client, shadow.workspace_id, user.id)
    })

    return { workspaceId: shadow.workspace_id }
  }

  /**
   * Create an invitation shadow and send the WorkOS invitation email.
   * The shadow is always created regardless of WorkOS outcome — WorkOS
   * state conflicts (already invited, already member) are logged as warnings.
   */
  async createShadow(params: {
    id: string
    workspaceId: string
    email: string
    region: string
    expiresAt: Date
    inviterWorkosUserId?: string
  }) {
    // Step 1: Insert shadow record (quick DB write)
    const shadow = await InvitationShadowRepository.insert(this.pool, params)

    // Step 2: Ensure WorkOS organization exists for this workspace (lazy create, cached)
    const orgId = await this.ensureWorkosOrganization(params.workspaceId)

    // Step 3: Send WorkOS invitation email (no DB connection held — INV-41)
    if (orgId && params.inviterWorkosUserId) {
      try {
        const workosInvitation = await this.workosOrgService.sendInvitation({
          organizationId: orgId,
          email: params.email,
          inviterUserId: params.inviterWorkosUserId,
        })
        await InvitationShadowRepository.setWorkosInvitationId(this.pool, shadow.id, workosInvitation.id)
      } catch (error) {
        const errorCode = getWorkosErrorCode(error)
        const isKnownStateConflict =
          errorCode === WORKOS_ERROR_CODES.USER_ALREADY_MEMBER || errorCode === WORKOS_ERROR_CODES.EMAIL_ALREADY_INVITED

        if (isKnownStateConflict) {
          logger.warn(
            { errorCode, email: params.email, shadowId: shadow.id },
            "WorkOS state conflict when sending invitation (noop)"
          )
        } else {
          logger.error({ err: error, email: params.email, shadowId: shadow.id }, "Failed to send WorkOS invitation")
        }
      }
    }

    return shadow
  }

  /**
   * Update shadow status. When revoking, also revoke the WorkOS invitation
   * if one was sent.
   */
  async updateStatus(id: string, status: "accepted" | "revoked") {
    if (status === "revoked") {
      // Look up shadow to get workos_invitation_id for revocation
      const shadow = await InvitationShadowRepository.findById(this.pool, id)
      if (shadow?.workos_invitation_id) {
        try {
          await this.workosOrgService.revokeInvitation(shadow.workos_invitation_id)
        } catch (error) {
          const errorCode = getWorkosErrorCode(error)
          if (errorCode === WORKOS_ERROR_CODES.INVITE_NOT_PENDING) {
            logger.warn({ errorCode, shadowId: id }, "WorkOS state conflict when revoking invitation (noop)")
          } else {
            logger.error({ err: error, shadowId: id }, "Failed to revoke WorkOS invitation")
          }
        }
      }
    }

    return InvitationShadowRepository.updateStatus(this.pool, id, status)
  }

  /**
   * Ensure a WorkOS organization exists for the given workspace.
   * Uses 3-tier lookup: local cache → WorkOS by external ID → create new.
   * No DB connection is held during WorkOS API calls (INV-41).
   */
  private async ensureWorkosOrganization(workspaceId: string): Promise<string | null> {
    // Tier 1: Check local DB cache
    const cachedOrgId = await WorkspaceRegistryRepository.getWorkosOrganizationId(this.pool, workspaceId)
    if (cachedOrgId) return cachedOrgId

    // Tier 2: Check WorkOS by external ID — survives local DB wipes
    const existingOrg = await this.workosOrgService.getOrganizationByExternalId(workspaceId)
    if (existingOrg) {
      await WorkspaceRegistryRepository.setWorkosOrganizationId(this.pool, workspaceId, existingOrg.id)
      return existingOrg.id
    }

    // Tier 3: Create new org in WorkOS
    const workspace = await WorkspaceRegistryRepository.findById(this.pool, workspaceId)
    if (!workspace) return null

    try {
      const org = await this.workosOrgService.createOrganization({
        name: workspace.name,
        externalId: workspaceId,
      })
      // Optimistic guard: WHERE workos_organization_id IS NULL
      // Concurrent losers no-op (INV-20)
      await WorkspaceRegistryRepository.setWorkosOrganizationId(this.pool, workspaceId, org.id)
    } catch (error) {
      logger.error({ err: error, workspaceId }, "Failed to create WorkOS organization")
    }

    // Re-read to get the winning org ID (handles concurrent creation race)
    return WorkspaceRegistryRepository.getWorkosOrganizationId(this.pool, workspaceId)
  }
}
