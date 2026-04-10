import type { Pool } from "pg"
import { HttpError, logger, getWorkosErrorCode, type WorkosOrgService } from "@threa/backend-common"
import { PlatformRoleRepository } from "./repository"

/** Platform roles recognised by the backoffice gate. */
export const PLATFORM_ROLES = ["admin"] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]

export function isValidPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value)
}

/** WorkOS invitation error codes we want to surface nicely to the UI. */
const WORKOS_ERROR_CODES = {
  EMAIL_ALREADY_INVITED: "email_already_invited_to_organization",
  USER_ALREADY_MEMBER: "user_already_organization_member",
} as const

export interface WorkspaceOwnerInvitation {
  id: string
  email: string
  expiresAt: string
}

interface Dependencies {
  pool: Pool
  workosOrgService: WorkosOrgService
}

/**
 * Backoffice service — backs the `/api/backoffice/*` surface.
 *
 * Owns the platform-admin gate (role lookup) and workspace-owner invitation
 * flow. Future backoffice domains (billing, support tooling, audits) should
 * get their own feature folders and reuse the platform-admin middleware from
 * here via the standard composition in routes.ts.
 */
export class BackofficeService {
  private pool: Pool
  private workosOrgService: WorkosOrgService

  constructor({ pool, workosOrgService }: Dependencies) {
    this.pool = pool
    this.workosOrgService = workosOrgService
  }

  async isPlatformAdmin(workosUserId: string): Promise<boolean> {
    const row = await PlatformRoleRepository.findByWorkosUserId(this.pool, workosUserId)
    return row?.role === "admin"
  }

  /**
   * Invite a new workspace owner by sending a WorkOS app-level invitation
   * (no organizationId). When the invitee accepts and signs in, the control
   * plane's existing `hasAcceptedWorkspaceCreationInvitation` check will
   * recognize the accepted invitation and let them create their own workspace.
   */
  async createWorkspaceOwnerInvitation(params: {
    email: string
    inviterWorkosUserId: string
  }): Promise<WorkspaceOwnerInvitation> {
    try {
      const invitation = await this.workosOrgService.sendInvitation({
        email: params.email,
        inviterUserId: params.inviterWorkosUserId,
      })
      logger.info(
        { email: params.email, invitationId: invitation.id, inviter: params.inviterWorkosUserId },
        "Backoffice: workspace owner invitation sent"
      )
      return {
        id: invitation.id,
        email: params.email,
        expiresAt: invitation.expiresAt.toISOString(),
      }
    } catch (error) {
      const code = getWorkosErrorCode(error)
      if (code === WORKOS_ERROR_CODES.EMAIL_ALREADY_INVITED) {
        throw new HttpError("An invitation for this email already exists", {
          status: 409,
          code: "ALREADY_INVITED",
        })
      }
      if (code === WORKOS_ERROR_CODES.USER_ALREADY_MEMBER) {
        throw new HttpError("This user already has a Threa account", {
          status: 409,
          code: "ALREADY_MEMBER",
        })
      }
      throw error
    }
  }
}

/**
 * Seed platform admins from configuration. Intended to be called once after
 * migrations on control-plane startup. Idempotent — re-running leaves existing
 * rows unchanged except for `updated_at`.
 */
export async function seedPlatformAdmins(pool: Pool, workosUserIds: string[]): Promise<void> {
  for (const id of workosUserIds) {
    await PlatformRoleRepository.upsert(pool, id, "admin")
  }
  if (workosUserIds.length > 0) {
    logger.info({ count: workosUserIds.length }, "Seeded platform admins from env")
  }
}
