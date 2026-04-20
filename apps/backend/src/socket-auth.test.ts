import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { authorizeWorkspaceSocket } from "./socket-auth"
import { UserRepository } from "./features/workspaces"
import * as authzResolver from "./middleware/workspace-authz-resolver"

describe("authorizeWorkspaceSocket", () => {
  const findByWorkosUserIdInWorkspace = spyOn(UserRepository, "findByWorkosUserIdInWorkspace")
  const update = spyOn(UserRepository, "update")
  const resolveWorkspaceAuthorization = spyOn(authzResolver, "resolveWorkspaceAuthorization")

  beforeEach(() => {
    findByWorkosUserIdInWorkspace.mockReset()
    update.mockReset()
    resolveWorkspaceAuthorization.mockReset()
  })

  test("rejects sockets missing the required permission", async () => {
    findByWorkosUserIdInWorkspace.mockResolvedValue({
      id: "user_1",
      workspaceId: "ws_1",
      workosUserId: "wos_1",
      email: "user@example.com",
      role: "user",
      slug: "user",
      name: "User",
      description: null,
      avatarUrl: null,
      timezone: null,
      locale: null,
      pronouns: null,
      phone: null,
      githubUsername: null,
      setupCompleted: true,
      joinedAt: new Date(),
      assignedRole: null,
      assignedRoles: [],
      canEditRole: false,
    })
    resolveWorkspaceAuthorization.mockResolvedValue({
      status: "ok",
      value: {
        source: "session",
        organizationId: "org_1",
        organizationMembershipId: "om_1",
        permissions: new Set(["streams:read"]),
        assignedRoles: [{ slug: "member", name: "Member" }],
        canEditRole: true,
        compatibilityRole: "user",
        isOwner: false,
      },
    })

    const result = await authorizeWorkspaceSocket({
      pool: {} as never,
      workspaceId: "ws_1",
      workosUserId: "wos_1",
      requiredPermission: "messages:read",
    })

    expect(result).toEqual({ ok: false, reason: "unauthorized" })
    expect(update).not.toHaveBeenCalled()
  })

  test("dual-writes the local compatibility role when WorkOS permissions changed", async () => {
    findByWorkosUserIdInWorkspace.mockResolvedValue({
      id: "user_1",
      workspaceId: "ws_1",
      workosUserId: "wos_1",
      email: "user@example.com",
      role: "user",
      slug: "user",
      name: "User",
      description: null,
      avatarUrl: null,
      timezone: null,
      locale: null,
      pronouns: null,
      phone: null,
      githubUsername: null,
      setupCompleted: true,
      joinedAt: new Date(),
      assignedRole: null,
      assignedRoles: [],
      canEditRole: false,
    })
    resolveWorkspaceAuthorization.mockResolvedValue({
      status: "ok",
      value: {
        source: "session",
        organizationId: "org_1",
        organizationMembershipId: "om_1",
        permissions: new Set(["messages:read", "members:write"]),
        assignedRoles: [{ slug: "admin", name: "Admin" }],
        canEditRole: true,
        compatibilityRole: "admin",
        isOwner: false,
      },
    })
    update.mockResolvedValue({
      id: "user_1",
      workspaceId: "ws_1",
      workosUserId: "wos_1",
      email: "user@example.com",
      role: "admin",
      slug: "user",
      name: "User",
      description: null,
      avatarUrl: null,
      timezone: null,
      locale: null,
      pronouns: null,
      phone: null,
      githubUsername: null,
      setupCompleted: true,
      joinedAt: new Date(),
      assignedRole: null,
      assignedRoles: [],
      canEditRole: false,
    })

    const result = await authorizeWorkspaceSocket({
      pool: {} as never,
      workspaceId: "ws_1",
      workosUserId: "wos_1",
      requiredPermission: "messages:read",
    })

    expect(update).toHaveBeenCalledWith(expect.anything(), "ws_1", "user_1", { role: "admin" })
    expect(result).toMatchObject({
      ok: true,
      workspaceUser: {
        id: "user_1",
        role: "admin",
      },
    })
  })

  test("preserves legacy owner rows when socket auth resolves to admin permissions", async () => {
    findByWorkosUserIdInWorkspace.mockResolvedValue({
      id: "user_1",
      workspaceId: "ws_1",
      workosUserId: "wos_1",
      email: "owner@example.com",
      role: "owner",
      slug: "owner",
      name: "Owner",
      description: null,
      avatarUrl: null,
      timezone: null,
      locale: null,
      pronouns: null,
      phone: null,
      githubUsername: null,
      setupCompleted: true,
      joinedAt: new Date(),
      assignedRole: null,
      assignedRoles: [],
      canEditRole: false,
    })
    resolveWorkspaceAuthorization.mockResolvedValue({
      status: "ok",
      value: {
        source: "session",
        organizationId: "org_1",
        organizationMembershipId: "om_1",
        permissions: new Set(["messages:read", "members:write"]),
        assignedRoles: [{ slug: "admin", name: "Admin" }],
        canEditRole: true,
        compatibilityRole: "admin",
        isOwner: true,
      },
    })

    const result = await authorizeWorkspaceSocket({
      pool: {} as never,
      workspaceId: "ws_1",
      workosUserId: "wos_1",
      requiredPermission: "messages:read",
    })

    expect(update).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      workspaceUser: {
        id: "user_1",
        role: "owner",
        isOwner: true,
      },
    })
  })
})
