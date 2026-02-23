import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { WorkspaceService } from "./service"
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

  const mockWithTransaction = spyOn(db, "withTransaction")

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
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(false)),
    }
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
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(false)),
    }
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
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(false)),
    }
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
    const workosOrgService: MockWorkosOrgService = {
      hasAcceptedWorkspaceCreationInvitation: mock<(email: string) => Promise<boolean>>(() => Promise.resolve(true)),
    }
    const service = createWorkspaceService(true, workosOrgService)

    const workspace = await service.createWorkspace({
      name: "Test Workspace",
      workosUserId,
      email,
      userName,
    })

    expect(workspace).toEqual(mockWorkspace)
    expect(workosOrgService.hasAcceptedWorkspaceCreationInvitation).toHaveBeenCalledWith("user@example.com")
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })
})
