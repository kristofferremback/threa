import { beforeEach, describe, expect, spyOn, test } from "bun:test"
import { DEFAULT_WORKSPACE_ROLES } from "@threa/types"
import { WorkspaceRepository } from "./repository"
import { WorkosAuthzMirrorRepository } from "./workos-authz-mirror-repository"
import { decorateUsersWithAuthzMirror } from "./user-authz-decorator"
import type { User } from "./user-repository"

describe("decorateUsersWithAuthzMirror", () => {
  const mockFindWorkspace = spyOn(WorkspaceRepository, "findById")
  const mockListRoles = spyOn(WorkosAuthzMirrorRepository, "listRoles")
  const mockListMembershipAssignments = spyOn(WorkosAuthzMirrorRepository, "listMembershipAssignments")

  beforeEach(() => {
    mockFindWorkspace.mockReset().mockResolvedValue({
      id: "ws_1",
      name: "Workspace",
      slug: "workspace",
      createdBy: "user_admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    mockListRoles.mockReset().mockResolvedValue(DEFAULT_WORKSPACE_ROLES as never)
    mockListMembershipAssignments.mockReset().mockResolvedValue([] as never)
  })

  test("uses legacy compatibility roles when WorkOS membership assignments are not mirrored yet", async () => {
    const users = await decorateUsersWithAuthzMirror("pool" as never, "ws_1", [
      createUser({ id: "user_admin", role: "admin" }),
      createUser({ id: "user_member", role: "user" }),
    ])

    expect(users[0].assignedRole).toEqual({ slug: "admin", name: "Admin" })
    expect(users[0].assignedRoles).toEqual([{ slug: "admin", name: "Admin" }])
    expect(users[0].isOwner).toBe(true)
    expect(users[1].assignedRole).toEqual({ slug: "member", name: "Member" })
    expect(users[1].assignedRoles).toEqual([{ slug: "member", name: "Member" }])
  })

  test("uses built-in role definitions when the role mirror is also empty", async () => {
    mockListRoles.mockResolvedValue([] as never)

    const users = await decorateUsersWithAuthzMirror("pool" as never, "ws_1", [
      createUser({ id: "user_admin", role: "admin" }),
    ])

    expect(users[0].assignedRole).toEqual({ slug: "admin", name: "Admin" })
    expect(users[0].assignedRoles).toEqual([{ slug: "admin", name: "Admin" }])
  })
})

function createUser(overrides: Partial<User>): User {
  const id = overrides.id ?? "user_1"
  return {
    id,
    workspaceId: "ws_1",
    workosUserId: `wos_${id}`,
    email: `${id}@example.com`,
    role: "user",
    slug: id,
    name: id,
    description: null,
    avatarUrl: null,
    timezone: null,
    locale: null,
    pronouns: null,
    phone: null,
    githubUsername: null,
    setupCompleted: true,
    joinedAt: new Date(),
    isOwner: false,
    assignedRole: null,
    assignedRoles: [],
    canEditRole: true,
    ...overrides,
  }
}
