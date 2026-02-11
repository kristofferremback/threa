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
