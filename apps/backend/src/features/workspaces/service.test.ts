import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { WorkspaceService } from "./service"
import * as db from "../../db"
import { WorkspaceRepository } from "./repository"
import { UserRepository } from "./user-repository"
import { WorkosAuthzMirrorRepository } from "./workos-authz-mirror-repository"
import { OutboxRepository } from "../../lib/outbox"

type MockWorkosOrgService = {
  hasAcceptedWorkspaceCreationInvitation: ReturnType<typeof mock<(email: string) => Promise<boolean>>>
  getOrganizationByExternalId?: ReturnType<typeof mock<(externalId: string) => Promise<{ id: string } | null>>>
  createOrganization?: ReturnType<
    typeof mock<(params: { name: string; externalId: string }) => Promise<{ id: string }>>
  >
  ensureOrganizationMembership?: ReturnType<
    typeof mock<(params: { organizationId: string; userId: string; roleSlug?: string }) => Promise<void>>
  >
  listRolesForOrganization?: ReturnType<typeof mock<(organizationId: string) => Promise<any[]>>>
  listOrganizationMemberships?: ReturnType<typeof mock<(organizationId: string) => Promise<any[]>>>
  updateOrganizationMembership?: ReturnType<typeof mock<(params: any) => Promise<any>>>
}

function createMockWorkosOrgService(overrides: Partial<MockWorkosOrgService> = {}): MockWorkosOrgService {
  return {
    hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(true)),
    getOrganizationByExternalId: mock<(externalId: string) => Promise<{ id: string } | null>>(() =>
      Promise.resolve(null)
    ),
    createOrganization: mock<(params: { name: string; externalId: string }) => Promise<{ id: string }>>(() =>
      Promise.resolve({ id: "org_1" })
    ),
    ensureOrganizationMembership: mock<
      (params: { organizationId: string; userId: string; roleSlug?: string }) => Promise<void>
    >(() => Promise.resolve()),
    ...overrides,
  }
}

function createWorkspaceService(
  requireWorkspaceCreationInvite: boolean,
  workosOrgService?: MockWorkosOrgService
): WorkspaceService {
  return new WorkspaceService({} as never, {} as never, {} as never, workosOrgService as never, {
    requireWorkspaceCreationInvite,
  })
}

const mockWithTransaction = spyOn(db, "withTransaction")

describe("WorkspaceService.createWorkspace invite gating", () => {
  const workosUserId = "workos_user_1"
  const email = "user@example.com"
  const userName = "User"
  const mockWorkspace = {
    id: "ws_1",
    name: "Test Workspace",
    slug: "test-workspace",
    createdBy: "usr_1",
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    mockWithTransaction.mockReset().mockResolvedValue(mockWorkspace as never)
  })

  test("skips invite checks when invite requirement is disabled", async () => {
    const service = createWorkspaceService(false)

    const workspace = await service.createWorkspace({
      name: "Test Workspace",
      workosUserId,
      email,
      userName,
    })

    expect(workspace).toEqual(mockWorkspace)
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })

  test("does not bypass invite checks when invite requirement is enabled", async () => {
    const workosOrgService = createMockWorkosOrgService({
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(false)),
    })
    const service = createWorkspaceService(true, workosOrgService)

    await expect(
      service.createWorkspace({
        name: "Test Workspace",
        workosUserId,
        email,
        userName,
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      message: "Workspace creation requires a dedicated workspace invite.",
      status: 403,
      code: "WORKSPACE_CREATION_INVITE_REQUIRED",
    })

    expect(workosOrgService.hasAcceptedWorkspaceCreationInvitation).toHaveBeenCalledWith("user@example.com")
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  test("throws when invite validation is enabled without WorkOS org service", async () => {
    const service = createWorkspaceService(true)

    await expect(
      service.createWorkspace({
        name: "Test Workspace",
        workosUserId,
        email,
        userName,
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      message: "Workspace invite validation is not configured",
      status: 500,
      code: "WORKSPACE_INVITE_VALIDATION_NOT_CONFIGURED",
    })

    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  test("normalizes email before invite validation", async () => {
    const workosOrgService = createMockWorkosOrgService({
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(false)),
    })
    const service = createWorkspaceService(true, workosOrgService)

    await expect(
      service.createWorkspace({
        name: "Test Workspace",
        workosUserId,
        email: " User@Example.com ",
        userName,
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      message: "Workspace creation requires a dedicated workspace invite.",
      status: 403,
      code: "WORKSPACE_CREATION_INVITE_REQUIRED",
    })

    expect(workosOrgService.hasAcceptedWorkspaceCreationInvitation).toHaveBeenCalledWith("user@example.com")
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  test("rejects workspace creation when user lacks accepted invitation", async () => {
    const workosOrgService = createMockWorkosOrgService({
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(false)),
    })
    const service = createWorkspaceService(true, workosOrgService)

    await expect(
      service.createWorkspace({
        name: "Test Workspace",
        workosUserId,
        email,
        userName,
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      message: "Workspace creation requires a dedicated workspace invite.",
      status: 403,
      code: "WORKSPACE_CREATION_INVITE_REQUIRED",
    })

    expect(workosOrgService.hasAcceptedWorkspaceCreationInvitation).toHaveBeenCalledWith("user@example.com")
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  test("allows workspace creation when user has an accepted invitation", async () => {
    const workosOrgService = createMockWorkosOrgService()
    const service = createWorkspaceService(true, workosOrgService)
    spyOn(service, "ensureWorkosOrganization").mockResolvedValue("org_1")

    const workspace = await service.createWorkspace({
      name: "Test Workspace",
      workosUserId,
      email,
      userName,
    })

    expect(workspace).toEqual(mockWorkspace)
    expect(workosOrgService.hasAcceptedWorkspaceCreationInvitation).toHaveBeenCalledWith("user@example.com")
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    expect(workosOrgService.ensureOrganizationMembership!).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: workosUserId,
      roleSlug: "admin",
    })
  })

  test("provisions the owner's WorkOS membership after workspace creation", async () => {
    const workosOrgService = createMockWorkosOrgService()
    const service = createWorkspaceService(false, workosOrgService)
    spyOn(service, "ensureWorkosOrganization").mockResolvedValue("org_1")

    await service.createWorkspace({
      name: "Provisioned Workspace",
      workosUserId,
      email,
      userName,
    })

    expect(workosOrgService.ensureOrganizationMembership!).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: workosUserId,
      roleSlug: "admin",
    })
  })

  test("fails loudly when owner membership provisioning fails", async () => {
    const workosOrgService = createMockWorkosOrgService({
      ensureOrganizationMembership: mock(() => Promise.reject(new Error("WorkOS unavailable"))),
    })
    const service = createWorkspaceService(false, workosOrgService)
    spyOn(service, "ensureWorkosOrganization").mockResolvedValue("org_1")

    await expect(
      service.createWorkspace({
        name: "Provision Failure Workspace",
        workosUserId,
        email,
        userName,
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 503,
      code: "WORKOS_MEMBERSHIP_PROVISIONING_FAILED",
    })
  })
})

describe("WorkspaceService.updateUserRole", () => {
  const mockFindWorkspace = spyOn(WorkspaceRepository, "findById")
  const mockFindUser = spyOn(UserRepository, "findById")
  const mockListMirrorRoles = spyOn(WorkosAuthzMirrorRepository, "listRoles")
  const mockFindMirrorMembership = spyOn(WorkosAuthzMirrorRepository, "findMembershipAssignment")
  const mockListMirrorMembershipAssignments = spyOn(WorkosAuthzMirrorRepository, "listMembershipAssignments")
  const mockHasOtherRoleManager = spyOn(WorkosAuthzMirrorRepository, "hasOtherRoleManager")
  const mockClaimRoleMutationLease = spyOn(WorkosAuthzMirrorRepository, "claimRoleMutationLease")
  const mockReleaseRoleMutationLease = spyOn(WorkosAuthzMirrorRepository, "releaseRoleMutationLease")
  const mockUpsertMembershipRoles = spyOn(WorkosAuthzMirrorRepository, "upsertMembershipRoles")
  const mockSyncCompatibilityRoles = spyOn(WorkosAuthzMirrorRepository, "syncCompatibilityRoles")
  const mockInsertOutbox = spyOn(OutboxRepository, "insert")

  beforeEach(() => {
    mockWithTransaction.mockReset()
    mockFindWorkspace.mockReset()
    mockFindUser.mockReset()
    mockListMirrorRoles.mockReset()
    mockFindMirrorMembership.mockReset()
    mockListMirrorMembershipAssignments.mockReset()
    mockHasOtherRoleManager.mockReset()
    mockClaimRoleMutationLease.mockReset()
    mockReleaseRoleMutationLease.mockReset()
    mockUpsertMembershipRoles.mockReset()
    mockSyncCompatibilityRoles.mockReset()
    mockInsertOutbox.mockReset()

    mockFindWorkspace.mockResolvedValue({
      id: "ws_1",
      name: "Workspace",
      slug: "workspace",
      createdBy: "owner_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    mockFindUser.mockResolvedValue({
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
    } as never)
    mockListMirrorRoles.mockResolvedValue([] as never)
    mockFindMirrorMembership.mockResolvedValue({
      organizationMembershipId: "om_1",
      workosUserId: "wos_1",
      roleSlugs: ["member"],
    } as never)
    mockListMirrorMembershipAssignments.mockResolvedValue([] as never)
    mockHasOtherRoleManager.mockResolvedValue(true as never)
    mockClaimRoleMutationLease.mockResolvedValue(true as never)
    mockReleaseRoleMutationLease.mockResolvedValue(undefined as never)
    mockUpsertMembershipRoles.mockResolvedValue(undefined as never)
    mockSyncCompatibilityRoles.mockResolvedValue(undefined as never)
    mockWithTransaction.mockImplementation((async (...args: Parameters<typeof db.withTransaction>) => {
      const callback = args[1]
      const client = { query: mock(() => Promise.resolve({ rows: [] })) }
      return callback(client as never)
    }) as typeof db.withTransaction)
    mockInsertOutbox.mockResolvedValue(undefined as never)
  })

  test("updates WorkOS membership and dual-writes the compatibility role", async () => {
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(true)),
      listRolesForOrganization: mock<(organizationId: string) => Promise<any[]>>(() =>
        Promise.resolve([
          { slug: "member", name: "Member", permissions: ["messages:read"], description: null, type: "system" },
          {
            slug: "support-admin",
            name: "Support Admin",
            permissions: ["messages:read", "members:write"],
            description: null,
            type: "custom",
          },
        ])
      ),
      listOrganizationMemberships: mock<(organizationId: string) => Promise<any[]>>(() =>
        Promise.resolve([
          {
            id: "om_1",
            organizationId: "org_1",
            userId: "wos_1",
            status: "active",
            role: { slug: "member" },
            roles: [{ slug: "member" }],
          },
          {
            id: "om_2",
            organizationId: "org_1",
            userId: "wos_2",
            status: "active",
            role: { slug: "support-admin" },
            roles: [{ slug: "support-admin" }],
          },
        ])
      ),
      updateOrganizationMembership: mock<(params: any) => Promise<any>>((params) =>
        Promise.resolve({
          id: params.organizationMembershipId,
          organizationId: "org_1",
          userId: "wos_1",
          status: "active",
          role: { slug: params.roleSlug },
          roles: [{ slug: params.roleSlug }],
        })
      ),
    }
    mockListMirrorRoles.mockResolvedValue([
      { slug: "member", name: "Member", permissions: ["messages:read"], description: null, type: "system" },
      {
        slug: "support-admin",
        name: "Support Admin",
        permissions: ["messages:read", "members:write"],
        description: null,
        type: "custom",
      },
    ] as never)
    mockFindMirrorMembership.mockResolvedValue({
      organizationMembershipId: "om_1",
      workosUserId: "wos_1",
      roleSlugs: ["member"],
    } as never)
    mockListMirrorMembershipAssignments.mockResolvedValue([
      {
        organizationMembershipId: "om_1",
        workosUserId: "wos_1",
        roleSlugs: ["support-admin"],
      },
    ] as never)
    mockFindUser.mockResolvedValueOnce({
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
    } as never)
    mockFindUser.mockResolvedValueOnce({
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
    } as never)

    const service = createWorkspaceService(false, workosOrgService)
    const user = await service.updateUserRole("ws_1", "user_1", "support-admin", {
      actorPermissions: ["messages:read", "members:write"],
    })

    expect(workosOrgService.updateOrganizationMembership).toHaveBeenCalledWith({
      organizationMembershipId: "om_1",
      roleSlug: "support-admin",
    })
    expect(mockUpsertMembershipRoles).toHaveBeenCalledWith({
      db: expect.anything(),
      workspaceId: "ws_1",
      organizationMembershipId: "om_1",
      workosUserId: "wos_1",
      roleSlugs: ["support-admin"],
    })
    expect(mockSyncCompatibilityRoles).toHaveBeenCalledWith(expect.anything(), "ws_1")
    expect(mockInsertOutbox).toHaveBeenCalledWith(expect.anything(), "workspace_user:updated", {
      workspaceId: "ws_1",
      user: expect.objectContaining({
        id: "user_1",
        role: "admin",
        assignedRole: { slug: "support-admin", name: "Support Admin" },
        assignedRoles: [{ slug: "support-admin", name: "Support Admin" }],
        canEditRole: true,
      }),
    })
    expect(user).toMatchObject({
      role: "admin",
      assignedRole: { slug: "support-admin", name: "Support Admin" },
      canEditRole: true,
    })
  })

  test("blocks removing the last role-managing member", async () => {
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(true)),
      listRolesForOrganization: mock<(organizationId: string) => Promise<any[]>>(() =>
        Promise.resolve([
          { slug: "member", name: "Member", permissions: ["messages:read"], description: null, type: "system" },
          {
            slug: "admin",
            name: "Admin",
            permissions: ["messages:read", "members:write"],
            description: null,
            type: "system",
          },
        ])
      ),
      updateOrganizationMembership: mock<(params: any) => Promise<any>>(() => Promise.resolve({})),
    }
    mockListMirrorRoles.mockResolvedValue([
      { slug: "member", name: "Member", permissions: ["messages:read"], description: null, type: "system" },
      {
        slug: "admin",
        name: "Admin",
        permissions: ["messages:read", "members:write"],
        description: null,
        type: "system",
      },
    ] as never)
    mockFindMirrorMembership.mockResolvedValue({
      organizationMembershipId: "om_1",
      workosUserId: "wos_1",
      roleSlugs: ["admin"],
    } as never)
    mockHasOtherRoleManager.mockResolvedValue(false as never)

    const service = createWorkspaceService(false, workosOrgService)

    await expect(
      service.updateUserRole("ws_1", "user_1", "member", {
        actorPermissions: ["messages:read", "members:write"],
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 409,
      code: "LAST_ADMIN_NOT_ALLOWED",
    })
    expect(workosOrgService.updateOrganizationMembership).not.toHaveBeenCalled()
    expect(mockUpsertMembershipRoles).not.toHaveBeenCalled()
  })

  test("blocks assigning roles with permissions the actor lacks", async () => {
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(true)),
      updateOrganizationMembership: mock<(params: any) => Promise<any>>(() => Promise.resolve({})),
    }
    mockListMirrorRoles.mockResolvedValue([
      { slug: "member", name: "Member", permissions: ["messages:read"], description: null, type: "system" },
      {
        slug: "admin",
        name: "Admin",
        permissions: ["messages:read", "members:write", "workspace:admin"],
        description: null,
        type: "system",
      },
    ] as never)

    const service = createWorkspaceService(false, workosOrgService)

    await expect(
      service.updateUserRole("ws_1", "user_1", "admin", {
        actorPermissions: ["members:write"],
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 403,
      code: "ROLE_ASSIGNMENT_PERMISSION_DENIED",
    })
    expect(workosOrgService.updateOrganizationMembership).not.toHaveBeenCalled()
    expect(mockClaimRoleMutationLease).not.toHaveBeenCalled()
  })

  test("serializes role mutations per workspace with a persistent lease and re-checks inside the lease", async () => {
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(true)),
      updateOrganizationMembership: mock<(params: any) => Promise<any>>(() => Promise.resolve({})),
    }
    mockListMirrorRoles.mockResolvedValue([
      {
        slug: "admin",
        name: "Admin",
        permissions: ["messages:read", "members:write"],
        description: null,
        type: "system",
      },
      { slug: "member", name: "Member", permissions: ["messages:read"], description: null, type: "system" },
    ] as never)
    mockFindMirrorMembership.mockResolvedValue({
      organizationMembershipId: "om_1",
      workosUserId: "wos_1",
      roleSlugs: ["admin"],
    } as never)
    mockHasOtherRoleManager.mockResolvedValue(false as never)
    mockWithTransaction.mockImplementation((async (...args: Parameters<typeof db.withTransaction>) => {
      const callback = args[1]
      return callback({ query: mock(() => Promise.resolve({ rows: [] })) } as never)
    }) as typeof db.withTransaction)

    const service = createWorkspaceService(false, workosOrgService)

    await expect(
      service.updateUserRole("ws_1", "user_1", "member", {
        actorPermissions: ["messages:read", "members:write"],
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      code: "LAST_ADMIN_NOT_ALLOWED",
    })
    expect(mockClaimRoleMutationLease).toHaveBeenCalledWith({
      db: expect.anything(),
      workspaceId: "ws_1",
      leaseId: expect.any(String),
      lockedUntil: expect.any(Date),
    })
    expect(mockHasOtherRoleManager).toHaveBeenCalledWith(expect.anything(), "ws_1", "om_1")
    expect(workosOrgService.updateOrganizationMembership).not.toHaveBeenCalled()
  })
})

describe("WorkspaceService user updates", () => {
  const mockFindWorkspace = spyOn(WorkspaceRepository, "findById")
  const mockUpdateUser = spyOn(UserRepository, "update")
  const mockListMirrorRoles = spyOn(WorkosAuthzMirrorRepository, "listRoles")
  const mockListMembershipAssignments = spyOn(WorkosAuthzMirrorRepository, "listMembershipAssignments")
  const mockInsertOutbox = spyOn(OutboxRepository, "insert")

  beforeEach(() => {
    mockWithTransaction.mockReset()
    mockFindWorkspace.mockReset()
    mockUpdateUser.mockReset()
    mockListMirrorRoles.mockReset()
    mockListMembershipAssignments.mockReset()
    mockInsertOutbox.mockReset()

    mockWithTransaction.mockImplementation((async (...args: Parameters<typeof db.withTransaction>) => {
      const callback = args[1]
      return callback({} as never)
    }) as typeof db.withTransaction)
    mockInsertOutbox.mockResolvedValue(undefined as never)
  })

  test("decorates profile update responses and outbox payloads with mirror role data", async () => {
    mockUpdateUser.mockResolvedValue({
      id: "user_1",
      workspaceId: "ws_1",
      workosUserId: "wos_1",
      email: "owner@example.com",
      role: "admin",
      slug: "owner",
      name: "Owner Updated",
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
    } as never)
    mockFindWorkspace.mockResolvedValue({
      id: "ws_1",
      name: "Workspace",
      slug: "workspace",
      createdBy: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    mockListMirrorRoles.mockResolvedValue([
      {
        slug: "admin",
        name: "Admin",
        permissions: ["messages:read", "members:write"],
        description: null,
        type: "system",
      },
    ] as never)
    mockListMembershipAssignments.mockResolvedValue([
      {
        organizationMembershipId: "om_1",
        workosUserId: "wos_1",
        roleSlugs: ["admin"],
      },
    ] as never)

    const service = createWorkspaceService(false, createMockWorkosOrgService())
    const user = await service.updateUserProfile("user_1", "ws_1", { name: "Owner Updated" })

    expect(user).toMatchObject({
      id: "user_1",
      role: "admin",
      isOwner: true,
      assignedRole: { slug: "admin", name: "Admin" },
      assignedRoles: [{ slug: "admin", name: "Admin" }],
      canEditRole: true,
    })
    expect(mockInsertOutbox).toHaveBeenCalledWith(expect.anything(), "workspace_user:updated", {
      workspaceId: "ws_1",
      user: expect.objectContaining({
        id: "user_1",
        isOwner: true,
        assignedRole: { slug: "admin", name: "Admin" },
        assignedRoles: [{ slug: "admin", name: "Admin" }],
        canEditRole: true,
      }),
    })
  })
})

describe("WorkspaceService.addUser", () => {
  test("provisions WorkOS membership for newly added users", async () => {
    const workosOrgService = createMockWorkosOrgService()
    const service = createWorkspaceService(false, workosOrgService)
    const addedUser = {
      id: "user_2",
      workspaceId: "ws_1",
      workosUserId: "wos_2",
      email: "member@example.com",
      role: "user" as const,
      slug: "member",
      name: "Member",
      description: null,
      avatarUrl: null,
      timezone: null,
      locale: null,
      pronouns: null,
      phone: null,
      githubUsername: null,
      setupCompleted: false,
      joinedAt: new Date(),
      assignedRole: null,
      assignedRoles: [],
      canEditRole: false,
    }

    mockWithTransaction.mockReset().mockResolvedValueOnce(addedUser as never)
    spyOn(service, "ensureWorkosOrganization").mockResolvedValue("org_1")

    const user = await service.addUser("ws_1", {
      workosUserId: "wos_2",
      email: "member@example.com",
      name: "Member",
      role: "user",
    })

    expect(user).toEqual(addedUser)
    expect(workosOrgService.ensureOrganizationMembership!).toHaveBeenCalledWith({
      organizationId: "org_1",
      userId: "wos_2",
      roleSlug: "member",
    })
  })

  test("fails loudly when member provisioning fails", async () => {
    const workosOrgService = createMockWorkosOrgService({
      ensureOrganizationMembership: mock(() => Promise.reject(new Error("WorkOS unavailable"))),
    })
    const service = createWorkspaceService(false, workosOrgService)
    const addedUser = {
      id: "user_2",
      workspaceId: "ws_1",
      workosUserId: "wos_2",
      email: "member@example.com",
      role: "user" as const,
      slug: "member",
      name: "Member",
      description: null,
      avatarUrl: null,
      timezone: null,
      locale: null,
      pronouns: null,
      phone: null,
      githubUsername: null,
      setupCompleted: false,
      joinedAt: new Date(),
      assignedRole: null,
      assignedRoles: [],
      canEditRole: false,
    }

    mockWithTransaction.mockReset().mockResolvedValueOnce(addedUser as never)
    spyOn(service, "ensureWorkosOrganization").mockResolvedValue("org_1")

    await expect(
      service.addUser("ws_1", {
        workosUserId: "wos_2",
        email: "member@example.com",
        name: "Member",
        role: "user",
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 503,
      code: "WORKOS_MEMBERSHIP_PROVISIONING_FAILED",
    })
  })
})
