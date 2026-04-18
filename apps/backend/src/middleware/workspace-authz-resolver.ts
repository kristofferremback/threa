import type { WorkosOrgService } from "@threa/backend-common"
import type { Pool } from "pg"
import { WorkspaceRepository } from "../features/workspaces"
import { compatibilityRoleFromPermissions, type WorkspaceAuthorizationContext } from "./authorization"

export interface ResolvedWorkspaceAuthorization extends WorkspaceAuthorizationContext {
  compatibilityRole: "admin" | "user"
  isOwner: boolean
}

export type WorkspaceAuthorizationResolution =
  | { status: "ok"; value: ResolvedWorkspaceAuthorization }
  | { status: "missing_org" }
  | { status: "missing_membership" }

function getMembershipRoles(membership: {
  roles: Array<{ slug: string }>
  role: { slug: string } | null
}): Array<{ slug: string }> {
  if (membership.roles.length > 0) {
    return membership.roles
  }

  if (membership.role) {
    return [membership.role]
  }

  return []
}

export async function resolveWorkspaceAuthorization(params: {
  pool: Pool
  workosOrgService: WorkosOrgService
  workspaceId: string
  workosUserId: string
  userId: string
  source: WorkspaceAuthorizationContext["source"]
  scopeFilter?: (permission: string) => boolean
}): Promise<WorkspaceAuthorizationResolution> {
  const workspaceMetadata = await WorkspaceRepository.getAuthorizationMetadata(params.pool, params.workspaceId)
  if (!workspaceMetadata?.workosOrganizationId) {
    return { status: "missing_org" }
  }

  const [membership, roles] = await Promise.all([
    params.workosOrgService.getOrganizationMembership({
      organizationId: workspaceMetadata.workosOrganizationId,
      userId: params.workosUserId,
    }),
    params.workosOrgService.listRolesForOrganization(workspaceMetadata.workosOrganizationId),
  ])

  if (!membership || membership.status !== "active") {
    return { status: "missing_membership" }
  }

  const rolesBySlug = new Map(roles.map((role) => [role.slug, role]))
  const assignedRoles = getMembershipRoles(membership).map((role) => ({
    slug: role.slug,
    name: rolesBySlug.get(role.slug)?.name ?? role.slug,
  }))

  const permissions = new Set(
    assignedRoles.flatMap((role) => {
      const rolePermissions = rolesBySlug.get(role.slug)?.permissions ?? []
      return params.scopeFilter ? rolePermissions.filter(params.scopeFilter) : rolePermissions
    })
  )

  return {
    status: "ok",
    value: {
      source: params.source,
      organizationId: workspaceMetadata.workosOrganizationId,
      organizationMembershipId: membership.id,
      permissions,
      assignedRoles,
      canEditRole: assignedRoles.length <= 1,
      compatibilityRole: compatibilityRoleFromPermissions(permissions),
      isOwner: workspaceMetadata.createdBy === params.userId,
    },
  }
}
