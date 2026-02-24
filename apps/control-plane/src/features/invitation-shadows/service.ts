import type { Pool } from "pg"
import {
  withTransaction,
  decodeAndSanitizeRedirectState,
  displayNameFromWorkos,
  taskId as generateTaskId,
  logger,
} from "@threa/backend-common"
import { InvitationShadowRepository } from "./repository"
import { WorkspaceRegistryRepository } from "../workspaces/repository"
import { enqueueTask } from "../../lib/task-processor"
import type { RegionalClient } from "../../lib/regional-client"

export const TASK_ACCEPT_SHADOW = "accept_invitation_shadow"

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
   * Attempts synchronous acceptance for fast redirect, enqueues a durable
   * retry task on failure so no shadow is silently lost.
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
          "Failed to auto-accept invitation shadow, enqueuing retry"
        )
        // Enqueue a durable retry — the task processor will retry with backoff
        try {
          await enqueueTask(this.pool, {
            id: generateTaskId(),
            taskType: TASK_ACCEPT_SHADOW,
            payload: {
              shadowId: shadow.id,
              workspaceId: shadow.workspace_id,
              region: shadow.region,
              workosUserId: user.id,
              email: user.email,
              name,
            },
          })
        } catch (enqueueErr) {
          logger.error({ err: enqueueErr, shadowId: shadow.id }, "Failed to enqueue shadow acceptance retry")
        }
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
