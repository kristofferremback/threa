import type { AuthSessionClaims } from "@threa/backend-common"
import { DEFAULT_WORKSPACE_ROLES, type WorkspacePermissionScope, type WorkspaceRole } from "@threa/types"
import type { Pool } from "pg"
import { WorkspaceRepository, WorkosAuthzMirrorRepository } from "../features/workspaces"
import { compatibilityRoleFromPermissions, type WorkspaceAuthorizationContext } from "./authorization"

export interface ResolvedWorkspaceAuthorization extends WorkspaceAuthorizationContext {
  compatibilityRole: "admin" | "user"
  isOwner: boolean
}

export type WorkspaceAuthorizationResolution =
  | { status: "ok"; value: ResolvedWorkspaceAuthorization }
  | { status: "missing_org" }
  | { status: "org_mismatch"; organizationId: string }
  | { status: "missing_membership" }

function getAssignedRoleSlugs(source: { roles?: string[]; role?: string | null; roleSlugs?: string[] }): string[] {
  if (source.roleSlugs && source.roleSlugs.length > 0) {
    return source.roleSlugs
  }

  if (source.roles && source.roles.length > 0) {
    return source.roles
  }

  if (source.role) {
    return [source.role]
  }

  return []
}

export function getEffectiveWorkspaceRoles(mirrorRoles: WorkspaceRole[]): WorkspaceRole[] {
  return mirrorRoles.length > 0 ? mirrorRoles : DEFAULT_WORKSPACE_ROLES
}

export async function resolveWorkspaceAuthorization(params: {
  pool: Pool
  workspaceId: string
  userId: string
  source: WorkspaceAuthorizationContext["source"]
  session?: AuthSessionClaims
  workosUserId?: string
  scopeFilter?: (permission: string) => boolean
}): Promise<WorkspaceAuthorizationResolution> {
  const [workspaceMetadata, mirrorRoles] = await Promise.all([
    WorkspaceRepository.getAuthorizationMetadata(params.pool, params.workspaceId),
    WorkosAuthzMirrorRepository.listRoles(params.pool, params.workspaceId),
  ])
  if (!workspaceMetadata?.workosOrganizationId) {
    return { status: "missing_org" }
  }
  const roles = getEffectiveWorkspaceRoles(mirrorRoles)
  const rolesBySlug = new Map(roles.map((role) => [role.slug, role]))

  if (params.source === "session") {
    if (!params.session?.organizationId || params.session.organizationId !== workspaceMetadata.workosOrganizationId) {
      return { status: "org_mismatch", organizationId: workspaceMetadata.workosOrganizationId }
    }

    const assignedRoles = getAssignedRoleSlugs(params.session).map((slug) => ({
      slug,
      name: rolesBySlug.get(slug)?.name ?? slug,
    }))
    const permissions = new Set<WorkspacePermissionScope>(
      (params.session.permissions ?? []).filter((permission) =>
        params.scopeFilter ? params.scopeFilter(permission) : true
      ) as WorkspacePermissionScope[]
    )

    return {
      status: "ok",
      value: {
        source: params.source,
        organizationId: workspaceMetadata.workosOrganizationId,
        organizationMembershipId: null,
        permissions,
        assignedRoles,
        roles,
        canEditRole: assignedRoles.length <= 1,
        compatibilityRole: compatibilityRoleFromPermissions(permissions),
        isOwner: workspaceMetadata.createdBy === params.userId,
      },
    }
  }

  if (!params.workosUserId) {
    return { status: "missing_membership" }
  }

  const membership = await WorkosAuthzMirrorRepository.findMembershipAssignment(
    params.pool,
    params.workspaceId,
    params.workosUserId
  )
  if (!membership) {
    return { status: "missing_membership" }
  }

  const assignedRoles = membership.roleSlugs.map((slug) => ({
    slug,
    name: rolesBySlug.get(slug)?.name ?? slug,
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
      organizationMembershipId: membership.organizationMembershipId,
      permissions,
      assignedRoles,
      roles,
      canEditRole: assignedRoles.length <= 1,
      compatibilityRole: compatibilityRoleFromPermissions(permissions),
      isOwner: workspaceMetadata.createdBy === params.userId,
    },
  }
}
