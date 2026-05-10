import type { Pool } from "pg"
import {
  permissionsForRole,
  WORKSPACE_USER_ROLES,
  type WorkspacePermissionSlug,
  type WorkspaceRoleSlug,
} from "@threa/types"
import { logger, type WorkosMembershipStatus } from "@threa/backend-common"
import { WorkspaceUserPermissionsRepository } from "./repository"

export interface ApplyMembershipChangeInput {
  workspaceId: string
  workosUserId: string
  roleSlugs: string[]
  status: WorkosMembershipStatus
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

const KNOWN_ROLE_SLUGS: ReadonlySet<string> = new Set(WORKSPACE_USER_ROLES)

function isWorkspaceRoleSlug(value: string): value is WorkspaceRoleSlug {
  return KNOWN_ROLE_SLUGS.has(value)
}

/**
 * Union the permission set granted by every recognized role on a mirror row.
 * Unknown role slugs are skipped so a WorkOS dashboard role added ahead of a
 * code release degrades gracefully (caller falls through to 403).
 */
export function expandRoleSlugs(roleSlugs: readonly string[]): WorkspacePermissionSlug[] {
  const union = new Set<WorkspacePermissionSlug>()
  for (const slug of roleSlugs) {
    if (!isWorkspaceRoleSlug(slug)) continue
    for (const perm of permissionsForRole(slug)) {
      union.add(perm)
    }
  }
  return [...union]
}

/**
 * Applies CP fan-out events to the regional `workspace_user_permissions`
 * mirror, and exposes the read paths for permission checks. Permissions are
 * derived from `role_slugs` at request time, so stored state stays minimal.
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

  /**
   * Resolve the active permission set for a workspace user from the mirror.
   * Returns `null` when the user has no active mirror row — callers should
   * treat this as "credential no longer usable" (401), not "missing
   * permission" (403).
   */
  async resolveActivePermissions(workspaceId: string, workosUserId: string): Promise<WorkspacePermissionSlug[] | null> {
    const mirror = await WorkspaceUserPermissionsRepository.getByWorkspaceAndUser(this.pool, workspaceId, workosUserId)
    if (!mirror || mirror.status !== "active") return null
    return expandRoleSlugs(mirror.roleSlugs)
  }

  async hasPermission(workspaceId: string, workosUserId: string, slug: WorkspacePermissionSlug): Promise<boolean> {
    const permissions = await this.resolveActivePermissions(workspaceId, workosUserId)
    return permissions !== null && permissions.includes(slug)
  }
}
