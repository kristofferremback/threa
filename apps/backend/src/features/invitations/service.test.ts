import { describe, test, expect, spyOn, beforeEach, mock } from "bun:test"
import type { PoolClient } from "pg"
import { InvitationService } from "./service"
import { InvitationRepository } from "./repository"
import { WorkspaceRepository, MemberRepository } from "../workspaces"
import { UserRepository } from "../../auth/user-repository"
import { OutboxRepository } from "../../lib/outbox"
import { logger } from "../../lib/logger"
import * as db from "../../db"

describe("InvitationService.acceptInvitation", () => {
  let service: InvitationService

  const invitation = {
    id: "inv_1",
    workspaceId: "ws_1",
    email: "test@example.com",
    role: "member",
    invitedBy: "member_owner",
    status: "pending",
  }

  const mockUpdateStatus = spyOn(InvitationRepository, "updateStatus")
  const mockFindInvitationById = spyOn(InvitationRepository, "findById")
  const mockIsMember = spyOn(WorkspaceRepository, "isMember")
  const mockInsertOutbox = spyOn(OutboxRepository, "insert")

  spyOn(db, "withTransaction").mockImplementation((_pool, fn) => fn({} as PoolClient))

  const mockCreateMember = mock<() => Promise<{ id: string; workspaceId: string }>>()

  beforeEach(() => {
    mockUpdateStatus.mockReset().mockResolvedValue(true)
    mockFindInvitationById.mockReset().mockResolvedValue(invitation as never)
    mockIsMember.mockReset().mockResolvedValue(false)
    mockInsertOutbox.mockReset().mockResolvedValue({
      id: 1n,
      eventType: "test",
      payload: {},
      createdAt: new Date(),
    } as never)
    mockCreateMember.mockReset().mockResolvedValue({ id: "member_new", workspaceId: "ws_1" })

    service = new InvitationService(
      {} as never,
      {} as never,
      {
        createMemberInTransaction: mockCreateMember,
      } as never
    )
  })

  test("should delegate member creation to workspaceService when accepting invitation", async () => {
    await service.acceptInvitation("inv_1", "user_1")

    expect(mockCreateMember).toHaveBeenCalledWith({} as PoolClient, {
      workspaceId: "ws_1",
      userId: "user_1",
      role: "member",
      setupCompleted: false,
    })
  })

  test("should emit invitation:accepted outbox event", async () => {
    await service.acceptInvitation("inv_1", "user_1")

    const acceptedCall = mockInsertOutbox.mock.calls.find((call) => call[1] === "invitation:accepted")
    expect(acceptedCall).toBeDefined()
    expect(acceptedCall![2]).toMatchObject({
      workspaceId: "ws_1",
      invitationId: "inv_1",
      email: "test@example.com",
      userId: "user_1",
    })
  })

  test("should not create member when user is already a member", async () => {
    mockIsMember.mockResolvedValue(true)

    await service.acceptInvitation("inv_1", "user_1")

    expect(mockCreateMember).not.toHaveBeenCalled()
  })

  test("should return null when invitation update fails", async () => {
    mockUpdateStatus.mockResolvedValue(false)

    const result = await service.acceptInvitation("inv_1", "user_1")

    expect(result).toBeNull()
    expect(mockInsertOutbox).not.toHaveBeenCalled()
    expect(mockCreateMember).not.toHaveBeenCalled()
  })
})

describe("InvitationService.sendInvitations", () => {
  let service: InvitationService
  let mockWorkosOrgService: {
    sendInvitation: ReturnType<typeof mock>
    getOrganizationByExternalId: ReturnType<typeof mock>
  }

  const mockLoggerWarn = spyOn(logger, "warn")
  const mockLoggerError = spyOn(logger, "error")
  const mockFindById = spyOn(MemberRepository, "findById")
  const mockFindUserById = spyOn(UserRepository, "findById")
  const mockFindByEmails = spyOn(UserRepository, "findByEmails")
  const mockFindMemberUserIds = spyOn(WorkspaceRepository, "findMemberUserIds")
  const mockFindPendingByEmailsAndWorkspace = spyOn(InvitationRepository, "findPendingByEmailsAndWorkspace")
  const mockInsertInvitation = spyOn(InvitationRepository, "insert")
  const mockInsertOutbox = spyOn(OutboxRepository, "insert")
  const mockSetWorkosInvitationId = spyOn(InvitationRepository, "setWorkosInvitationId")
  const mockGetWorkosOrgId = spyOn(WorkspaceRepository, "getWorkosOrganizationId")

  spyOn(db, "withTransaction").mockImplementation((_pool, fn) => fn({} as PoolClient))

  beforeEach(() => {
    mockLoggerWarn.mockReset()
    mockLoggerError.mockReset()
    mockFindById.mockReset().mockResolvedValue({ id: "member_1", userId: "user_owner" } as never)
    mockFindUserById.mockReset().mockResolvedValue({ id: "user_owner", workosUserId: "workos_user_1" } as never)
    mockFindByEmails.mockReset().mockResolvedValue([])
    mockFindMemberUserIds.mockReset().mockResolvedValue(new Set())
    mockFindPendingByEmailsAndWorkspace.mockReset().mockResolvedValue([])
    mockInsertInvitation
      .mockReset()
      .mockImplementation((_client, data) =>
        Promise.resolve({ ...data, status: "pending", createdAt: new Date() } as never)
      )
    mockInsertOutbox
      .mockReset()
      .mockResolvedValue({ id: 1n, eventType: "test", payload: {}, createdAt: new Date() } as never)
    mockSetWorkosInvitationId.mockReset().mockResolvedValue(undefined as never)
    mockGetWorkosOrgId.mockReset().mockResolvedValue("org_123")

    mockWorkosOrgService = {
      sendInvitation: mock(() => Promise.resolve({ id: "workos_inv_1", expiresAt: new Date() })),
      getOrganizationByExternalId: mock(() => Promise.resolve({ id: "org_123" })),
    }

    service = new InvitationService({} as never, mockWorkosOrgService as never, {} as never)
  })

  test("should log warning when WorkOS returns user_already_organization_member error", async () => {
    const workosError = { code: "user_already_organization_member" }
    mockWorkosOrgService.sendInvitation.mockRejectedValue(workosError)

    await service.sendInvitations({
      workspaceId: "ws_1",
      invitedBy: "member_1",
      emails: ["test@example.com"],
      role: "member",
    })

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "user_already_organization_member",
        email: "test@example.com",
      }),
      expect.stringContaining("WorkOS state conflict")
    )
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  test("should log error when WorkOS returns unknown error during send", async () => {
    const workosError = new Error("Network timeout")
    mockWorkosOrgService.sendInvitation.mockRejectedValue(workosError)

    await service.sendInvitations({
      workspaceId: "ws_1",
      invitedBy: "member_1",
      emails: ["test@example.com"],
      role: "member",
    })

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: workosError,
        email: "test@example.com",
      }),
      expect.stringContaining("Failed to send WorkOS invitation")
    )
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})

describe("InvitationService.sendWorkspaceCreationInvitations", () => {
  let service: InvitationService
  let mockWorkosOrgService: {
    sendInvitation: ReturnType<typeof mock>
  }

  const mockFindMemberById = spyOn(MemberRepository, "findById")
  const mockFindUserById = spyOn(UserRepository, "findById")
  const mockLoggerError = spyOn(logger, "error")

  beforeEach(() => {
    mockFindMemberById.mockReset().mockResolvedValue({
      id: "member_1",
      workspaceId: "ws_1",
      userId: "user_owner",
    } as never)
    mockFindUserById.mockReset().mockResolvedValue({
      id: "user_owner",
      workosUserId: "workos_user_1",
    } as never)
    mockLoggerError.mockReset()

    mockWorkosOrgService = {
      sendInvitation: mock(() => Promise.resolve({ id: "workos_inv_1", expiresAt: new Date() })),
    }

    service = new InvitationService({} as never, mockWorkosOrgService as never, {} as never)
  })

  test("sends application-level invites (without organizationId)", async () => {
    const result = await service.sendWorkspaceCreationInvitations({
      workspaceId: "ws_1",
      invitedBy: "member_1",
      emails: ["Alice@example.com", "alice@example.com", "bob@example.com"],
    })

    expect(result).toEqual({
      sent: ["alice@example.com", "bob@example.com"],
      failed: [],
    })

    expect(mockWorkosOrgService.sendInvitation).toHaveBeenCalledTimes(2)
    expect(mockWorkosOrgService.sendInvitation).toHaveBeenCalledWith({
      email: "alice@example.com",
      inviterUserId: "workos_user_1",
    })
    expect(mockWorkosOrgService.sendInvitation).toHaveBeenCalledWith({
      email: "bob@example.com",
      inviterUserId: "workos_user_1",
    })
  })

  test("throws when inviter does not belong to workspace", async () => {
    mockFindMemberById.mockResolvedValue({
      id: "member_1",
      workspaceId: "ws_other",
      userId: "user_owner",
    } as never)

    await expect(
      service.sendWorkspaceCreationInvitations({
        workspaceId: "ws_1",
        invitedBy: "member_1",
        emails: ["a@example.com"],
      })
    ).rejects.toMatchObject({
      message: "Inviter not found in workspace",
      status: 404,
      code: "INVITER_NOT_FOUND",
    })
  })

  test("throws when inviter has no WorkOS identity", async () => {
    mockFindUserById.mockResolvedValue({
      id: "user_owner",
      workosUserId: null,
    } as never)

    await expect(
      service.sendWorkspaceCreationInvitations({
        workspaceId: "ws_1",
        invitedBy: "member_1",
        emails: ["a@example.com"],
      })
    ).rejects.toMatchObject({
      message: "Inviter is missing WorkOS identity",
      status: 400,
      code: "INVITER_WORKOS_USER_NOT_FOUND",
    })
  })

  test("returns per-email failures without aborting successful sends", async () => {
    mockWorkosOrgService.sendInvitation
      .mockResolvedValueOnce({ id: "inv_ok", expiresAt: new Date() })
      .mockRejectedValueOnce(new Error("rate limited"))

    const result = await service.sendWorkspaceCreationInvitations({
      workspaceId: "ws_1",
      invitedBy: "member_1",
      emails: ["a@example.com", "b@example.com"],
    })

    expect(result).toEqual({
      sent: ["a@example.com"],
      failed: [{ email: "b@example.com", error: "rate limited" }],
    })
    expect(mockLoggerError).toHaveBeenCalled()
  })
})

describe("InvitationService.acceptPendingForEmail", () => {
  let service: InvitationService

  const pendingInvitations = [
    { id: "inv_1", workspaceId: "ws_1", email: "test@example.com", role: "member", status: "pending" },
    { id: "inv_2", workspaceId: "ws_2", email: "test@example.com", role: "admin", status: "pending" },
  ]

  const mockFindPendingByEmail = spyOn(InvitationRepository, "findPendingByEmail")
  const mockUpdateStatus = spyOn(InvitationRepository, "updateStatus")
  const mockFindInvitationById = spyOn(InvitationRepository, "findById")
  const mockIsMember = spyOn(WorkspaceRepository, "isMember")
  const mockInsertOutbox = spyOn(OutboxRepository, "insert")
  const mockLoggerError = spyOn(logger, "error")

  const mockClient = { query: mock<(text: string) => Promise<{ rows: never[]; rowCount: number }>>() }
  const mockWithTransaction = spyOn(db, "withTransaction").mockImplementation((_pool, fn) => fn(mockClient as never))

  const mockCreateMember = mock<() => Promise<{ id: string; workspaceId: string }>>()

  beforeEach(() => {
    mockClient.query.mockReset().mockResolvedValue({ rows: [] as never[], rowCount: 0 })
    mockWithTransaction.mockReset().mockImplementation((_pool, fn) => fn(mockClient as never))
    mockFindPendingByEmail.mockReset().mockResolvedValue(pendingInvitations as never)
    mockUpdateStatus.mockReset().mockResolvedValue(true)
    mockFindInvitationById.mockReset().mockImplementation((_db, id) => {
      const inv = pendingInvitations.find((i) => i.id === id)
      return Promise.resolve(inv ? (inv as never) : null)
    })
    mockIsMember.mockReset().mockResolvedValue(false)
    mockInsertOutbox
      .mockReset()
      .mockResolvedValue({ id: 1n, eventType: "test", payload: {}, createdAt: new Date() } as never)
    mockLoggerError.mockReset()
    mockCreateMember.mockReset().mockResolvedValue({ id: "member_new", workspaceId: "ws_1" })

    service = new InvitationService(
      {} as never,
      {} as never,
      {
        createMemberInTransaction: mockCreateMember,
      } as never
    )
  })

  test("should return structured result with accepted workspace IDs", async () => {
    const result = await service.acceptPendingForEmail("test@example.com", "user_1")

    expect(result.accepted).toEqual(["ws_1", "ws_2"])
    expect(result.failed).toEqual([])
  })

  test("should return empty results when no pending invitations", async () => {
    mockFindPendingByEmail.mockResolvedValue([])

    const result = await service.acceptPendingForEmail("test@example.com", "user_1")

    expect(result.accepted).toEqual([])
    expect(result.failed).toEqual([])
  })

  test("should use a single transaction for all invitations", async () => {
    await service.acceptPendingForEmail("test@example.com", "user_1")

    // withTransaction called once for 2 invitations (batched)
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })

  test("should capture failed invitations without aborting others", async () => {
    mockCreateMember
      .mockResolvedValueOnce({ id: "member_1", workspaceId: "ws_1" })
      .mockRejectedValueOnce(new Error("DB constraint violation"))

    const result = await service.acceptPendingForEmail("test@example.com", "user_1")

    expect(result.accepted).toEqual(["ws_1"])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({
      invitationId: "inv_2",
      email: "test@example.com",
      error: "DB constraint violation",
    })
    expect(mockLoggerError).toHaveBeenCalled()
  })

  test("should use savepoints for per-invitation error isolation", async () => {
    await service.acceptPendingForEmail("test@example.com", "user_1")

    const savepointCalls = mockClient.query.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("SAVEPOINT")
    )
    // 2 invitations: SAVEPOINT + RELEASE for each
    expect(savepointCalls).toHaveLength(4)
  })
})

describe("InvitationService.revokeInvitation", () => {
  let service: InvitationService
  let mockWorkosOrgService: { revokeInvitation: ReturnType<typeof mock> }

  const mockLoggerWarn = spyOn(logger, "warn")
  const mockLoggerError = spyOn(logger, "error")
  const mockFindById = spyOn(InvitationRepository, "findById")
  const mockUpdateStatus = spyOn(InvitationRepository, "updateStatus")

  spyOn(db, "withTransaction").mockImplementation((_pool, fn) => fn({} as PoolClient))

  beforeEach(() => {
    mockLoggerWarn.mockReset()
    mockLoggerError.mockReset()
    mockFindById.mockReset().mockResolvedValue({
      id: "inv_1",
      workspaceId: "ws_1",
      email: "test@example.com",
      workosInvitationId: "workos_inv_1",
    } as never)
    mockUpdateStatus.mockReset().mockResolvedValue(true)

    mockWorkosOrgService = {
      revokeInvitation: mock(() => Promise.resolve()),
    }

    service = new InvitationService({} as never, mockWorkosOrgService as never, {} as never)
  })

  test("should log warning when WorkOS returns invite_not_pending error", async () => {
    const workosError = { code: "invite_not_pending" }
    mockWorkosOrgService.revokeInvitation.mockRejectedValue(workosError)

    await service.revokeInvitation("inv_1", "ws_1")

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "invite_not_pending",
        invitationId: "inv_1",
      }),
      expect.stringContaining("WorkOS state conflict")
    )
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  test("should log error when WorkOS returns unknown error during revoke", async () => {
    const workosError = new Error("Network timeout")
    mockWorkosOrgService.revokeInvitation.mockRejectedValue(workosError)

    await service.revokeInvitation("inv_1", "ws_1")

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: workosError,
        invitationId: "inv_1",
      }),
      expect.stringContaining("Failed to revoke WorkOS invitation")
    )
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})
