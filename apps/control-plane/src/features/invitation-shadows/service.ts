import type { Pool } from "pg"
import { withTransaction, decodeAndSanitizeRedirectState, displayNameFromWorkos, logger } from "@threa/backend-common"
import { InvitationShadowRepository } from "./repository"
import { WorkspaceRegistryRepository } from "../workspaces/repository"
import type { RegionalClient } from "../../lib/regional-client"

/** User info for shadow acceptance — accepts either pre-derived name (stub) or WorkOS fields */
type ShadowUser =
  | { id: string; email: string; name: string }
  | { id: string; email: string; firstName?: string | null; lastName?: string | null }

interface Dependencies {
  pool: Pool
  regionalClient: RegionalClient
}

export class InvitationShadowService {
  private pool: Pool
  private regionalClient: RegionalClient

  constructor({ pool, regionalClient }: Dependencies) {
    this.pool = pool
    this.regionalClient = regionalClient
  }

  private resolveDisplayName(user: ShadowUser): string {
    if ("name" in user && user.name) return user.name
    return displayNameFromWorkos(user)
  }

  /**
   * Auto-accept all pending invitation shadows for a user.
   * Regional calls are fanned out in parallel via Promise.allSettled.
   * Per shadow: (1) regional call (idempotent), (2) local DB transaction.
   * If phase 1 succeeds but phase 2 fails, the shadow stays pending and will
   * be retried on the next login — the regional endpoint is idempotent.
   * Returns the list of workspace IDs that were successfully accepted.
   */
  async acceptPendingForUser(user: ShadowUser): Promise<string[]> {
    const pendingShadows = await InvitationShadowRepository.findPendingByEmail(this.pool, user.email)
    if (pendingShadows.length === 0) return []

    const name = this.resolveDisplayName(user)

    const results = await Promise.allSettled(
      pendingShadows.map(async (shadow) => {
        await this.regionalClient.acceptInvitation(shadow.region, shadow.id, {
          workosUserId: user.id,
          email: user.email,
          name,
        })
        await withTransaction(this.pool, async (client) => {
          await InvitationShadowRepository.updateStatus(client, shadow.id, "accepted")
          await WorkspaceRegistryRepository.insertMembership(client, shadow.workspace_id, user.id)
        })
        return shadow.workspace_id
      })
    )

    const acceptedWorkspaceIds: string[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === "fulfilled") {
        acceptedWorkspaceIds.push(result.value)
      } else {
        const shadow = pendingShadows[i]
        logger.error(
          { err: result.reason, shadowId: shadow.id, workspaceId: shadow.workspace_id },
          "Failed to auto-accept invitation shadow"
        )
      }
    }

    return acceptedWorkspaceIds
  }

  /**
   * Accept pending shadows and compute the post-auth redirect URL.
   * Exactly one accepted workspace → redirect to its setup page.
   * Otherwise → use the state-encoded redirect or fall back to root.
   */
  async acceptPendingAndGetRedirect(params: { user: ShadowUser; state?: string }): Promise<string> {
    const acceptedWorkspaceIds = await this.acceptPendingForUser(params.user)

    if (acceptedWorkspaceIds.length === 1) {
      return `/w/${acceptedWorkspaceIds[0]}/setup`
    }

    if (params.state) {
      return decodeAndSanitizeRedirectState(params.state)
    }

    return "/"
  }

  async createShadow(params: { id: string; workspaceId: string; email: string; region: string; expiresAt: Date }) {
    return InvitationShadowRepository.insert(this.pool, params)
  }

  async updateStatus(id: string, status: "accepted" | "revoked") {
    return InvitationShadowRepository.updateStatus(this.pool, id, status)
  }
}
