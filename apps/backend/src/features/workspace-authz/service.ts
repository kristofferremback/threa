import type { Pool } from "pg"
import { logger } from "@threa/backend-common"
import { WorkspaceUserPermissionsRepository } from "./repository"

export interface ApplyMembershipChangeInput {
  workspaceId: string
  workosUserId: string
  roleSlugs: string[]
  status: string
  lastEventAt: Date
}

export interface ApplyMembershipRemovalInput {
  workspaceId: string
  workosUserId: string
  eventCreatedAt: Date
}

interface Dependencies {
  pool: Pool
}

/**
 * Applies CP fan-out events to the regional `workspace_user_permissions`
 * mirror. Permissions are derived from `role_slugs` at request time, so
 * stored state stays minimal.
 */
export class WorkspaceAuthzService {
  private pool: Pool

  constructor({ pool }: Dependencies) {
    this.pool = pool
  }

  async applyMembershipChange(input: ApplyMembershipChangeInput): Promise<void> {
    const updated = await WorkspaceUserPermissionsRepository.upsert(this.pool, input)
    if (!updated) {
      logger.debug(
        { workspaceId: input.workspaceId, workosUserId: input.workosUserId },
        "workspace_user_permissions upsert ignored as stale"
      )
    }
  }

  async applyMembershipRemoval(input: ApplyMembershipRemovalInput): Promise<void> {
    const removed = await WorkspaceUserPermissionsRepository.delete(this.pool, input)
    if (!removed) {
      logger.debug(
        { workspaceId: input.workspaceId, workosUserId: input.workosUserId },
        "workspace_user_permissions delete ignored as stale"
      )
    }
  }
}
