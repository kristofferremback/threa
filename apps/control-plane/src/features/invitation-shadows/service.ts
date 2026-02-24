import type { Pool } from "pg"
import { withTransaction, logger } from "@threa/backend-common"
import { InvitationShadowRepository } from "./repository"
import { WorkspaceRegistryRepository } from "../workspaces/repository"
import type { RegionalClient } from "../../lib/regional-client"

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

  /**
   * Auto-accept all pending invitation shadows for a user.
   * Two-phase per shadow: (1) regional call (idempotent), (2) local DB transaction.
   * If phase 1 succeeds but phase 2 fails, the shadow stays pending and will
   * be retried on the next login — the regional endpoint is idempotent.
   * Returns the list of workspace IDs that were successfully accepted.
   */
  async acceptPendingForUser(user: { id: string; email: string; name: string }): Promise<string[]> {
    const pendingShadows = await InvitationShadowRepository.findPendingByEmail(this.pool, user.email)
    const acceptedWorkspaceIds: string[] = []

    for (const shadow of pendingShadows) {
      try {
        await this.regionalClient.acceptInvitation(shadow.region, shadow.id, {
          workosUserId: user.id,
          email: user.email,
          name: user.name,
        })
        await withTransaction(this.pool, async (client) => {
          await InvitationShadowRepository.updateStatus(client, shadow.id, "accepted")
          await WorkspaceRegistryRepository.insertMembership(client, shadow.workspace_id, user.id)
        })
        acceptedWorkspaceIds.push(shadow.workspace_id)
      } catch (error) {
        logger.error(
          { err: error, shadowId: shadow.id, workspaceId: shadow.workspace_id },
          "Failed to auto-accept invitation shadow"
        )
      }
    }

    return acceptedWorkspaceIds
  }

  async createShadow(params: { id: string; workspaceId: string; email: string; region: string; expiresAt: Date }) {
    return InvitationShadowRepository.insert(this.pool, params)
  }

  async updateStatus(id: string, status: "accepted" | "revoked") {
    return InvitationShadowRepository.updateStatus(this.pool, id, status)
  }
}
