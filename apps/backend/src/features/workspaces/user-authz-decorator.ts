import type { Querier } from "../../db"
import { compatibilityRoleFromPermissions, storedCompatibilityRole } from "../../middleware/authorization"
import { WorkspaceRepository, type Workspace } from "./repository"
import { type User } from "./user-repository"
import { WorkosAuthzMirrorRepository, type WorkspaceMembershipAssignment } from "./workos-authz-mirror-repository"
import type { WorkspaceRole } from "@threa/types"

export async function decorateUsersWithAuthzMirror(
  db: Querier,
  workspaceId: string,
  users: User[],
  options?: {
    workspace?: Workspace | null
    roles?: WorkspaceRole[]
    assignments?: WorkspaceMembershipAssignment[]
  }
): Promise<User[]> {
  if (users.length === 0) {
    return users
  }

  const resolvedWorkspace = options?.workspace ?? (await WorkspaceRepository.findById(db, workspaceId))
  if (!resolvedWorkspace) {
    return users
  }

  const [roles, assignments] = await Promise.all([
    options?.roles ? Promise.resolve(options.roles) : WorkosAuthzMirrorRepository.listRoles(db, workspaceId),
    options?.assignments
      ? Promise.resolve(options.assignments)
      : WorkosAuthzMirrorRepository.listMembershipAssignments(db, workspaceId),
  ])
  const rolesBySlug = new Map(roles.map((role) => [role.slug, role]))
  const assignmentsByWorkosUserId = new Map(assignments.map((assignment) => [assignment.workosUserId, assignment]))

  return users.map((user) => {
    const assignment = assignmentsByWorkosUserId.get(user.workosUserId)
    const assignedRoles = (assignment?.roleSlugs ?? []).map((slug) => ({
      slug,
      name: rolesBySlug.get(slug)?.name ?? slug,
    }))
    const permissions = new Set(assignedRoles.flatMap((role) => rolesBySlug.get(role.slug)?.permissions ?? []))
    const isOwner = resolvedWorkspace.createdBy === user.id
    const fallbackRole = user.role === "owner" ? "admin" : user.role
    const compatibilityRole = assignedRoles.length > 0 ? compatibilityRoleFromPermissions(permissions) : fallbackRole

    return {
      ...user,
      role: storedCompatibilityRole(user.role, compatibilityRole, isOwner),
      isOwner,
      assignedRole: assignedRoles[0] ?? null,
      assignedRoles,
      canEditRole: assignedRoles.length <= 1,
    }
  })
}

export async function decorateUserWithAuthzMirror(
  db: Querier,
  workspaceId: string,
  user: User,
  options?: {
    workspace?: Workspace | null
    roles?: WorkspaceRole[]
    assignments?: WorkspaceMembershipAssignment[]
  }
): Promise<User> {
  const [decoratedUser] = await decorateUsersWithAuthzMirror(db, workspaceId, [user], options)
  return decoratedUser ?? user
}
