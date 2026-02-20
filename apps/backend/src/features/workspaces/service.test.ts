import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { WorkspaceService } from "./service"
import { WorkspaceRepository } from "./repository"
import { UserRepository } from "../../auth/user-repository"
import * as db from "../../db"

type MockWorkosOrgService = {
  hasAcceptedWorkspaceCreationInvitation: ReturnType<typeof mock<(email: string) => Promise<boolean>>>
}

function createWorkspaceService(
  requireWorkspaceCreationInvite: boolean,
  workosOrgService?: MockWorkosOrgService
): WorkspaceService {
  return new WorkspaceService({} as never, {} as never, {} as never, workosOrgService as never, {
    requireWorkspaceCreationInvite,
  })
}

describe("WorkspaceService.createWorkspace invite gating", () => {
  const createdBy = "user_1"
  const mockWorkspace = {
    id: "ws_1",
    name: "Test Workspace",
    slug: "test-workspace",
    createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockList = spyOn(WorkspaceRepository, "list")
  const mockFindUserById = spyOn(UserRepository, "findById")
  const mockWithTransaction = spyOn(db, "withTransaction")

  beforeEach(() => {
    mockList.mockReset()
    mockFindUserById.mockReset()
    mockWithTransaction.mockReset().mockResolvedValue(mockWorkspace as never)
  })

  test("skips invite checks when invite requirement is disabled", async () => {
    const service = createWorkspaceService(false)

    const workspace = await service.createWorkspace({
      name: "Test Workspace",
      createdBy,
    })

    expect(workspace).toEqual(mockWorkspace)
    expect(mockList).not.toHaveBeenCalled()
    expect(mockFindUserById).not.toHaveBeenCalled()
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })

  test("does not bypass invite checks for users already in a workspace", async () => {
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(false)),
    }
    mockFindUserById.mockResolvedValue({
      id: createdBy,
      email: "user@example.com",
      name: "User",
      workosUserId: "workos_user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    const service = createWorkspaceService(true, workosOrgService)

    await expect(
      service.createWorkspace({
        name: "Test Workspace",
        createdBy,
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      message: "Workspace creation requires a dedicated workspace invite.",
      status: 403,
      code: "WORKSPACE_CREATION_INVITE_REQUIRED",
    })

    expect(mockList).not.toHaveBeenCalled()
    expect(workosOrgService.hasAcceptedWorkspaceCreationInvitation).toHaveBeenCalledWith("user@example.com")
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  test("throws when invite validation is enabled without WorkOS org service", async () => {
    const service = createWorkspaceService(true)

    await expect(
      service.createWorkspace({
        name: "Test Workspace",
        createdBy,
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      message: "Workspace invite validation is not configured",
      status: 500,
      code: "WORKSPACE_INVITE_VALIDATION_NOT_CONFIGURED",
    })

    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  test("throws when invite validation user cannot be found", async () => {
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(false)),
    }
    mockFindUserById.mockResolvedValue(null)
    const service = createWorkspaceService(true, workosOrgService)

    await expect(
      service.createWorkspace({
        name: "Test Workspace",
        createdBy,
      })
    ).rejects.toMatchObject({
      name: "HttpError",
      message: "User not found",
      status: 404,
      code: "USER_NOT_FOUND",
    })

    expect(workosOrgService.hasAcceptedWorkspaceCreationInvitation).not.toHaveBeenCalled()
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  test("rejects workspace creation when user lacks accepted invitation", async () => {
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(false)),
    }
    mockFindUserById.mockResolvedValue({
      id: createdBy,
      email: "user@example.com",
      name: "User",
      workosUserId: "workos_user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    const service = createWorkspaceService(true, workosOrgService)

    await expect(
      service.createWorkspace({
        name: "Test Workspace",
        createdBy,
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
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(true)),
    }
    mockFindUserById.mockResolvedValue({
      id: createdBy,
      email: "user@example.com",
      name: "User",
      workosUserId: "workos_user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    const service = createWorkspaceService(true, workosOrgService)

    const workspace = await service.createWorkspace({
      name: "Test Workspace",
      createdBy,
    })

    expect(workspace).toEqual(mockWorkspace)
    expect(workosOrgService.hasAcceptedWorkspaceCreationInvitation).toHaveBeenCalledWith("user@example.com")
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })
})
