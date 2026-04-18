import { describe, test, expect, spyOn, beforeEach, mock } from "bun:test"
import type { PoolClient } from "pg"
import { InvitationService } from "./service"
import { InvitationRepository } from "./repository"
import { UserRepository } from "../workspaces"
import { OutboxRepository } from "../../lib/outbox"
import { logger } from "../../lib/logger"
import * as db from "../../db"

const identity = {
  workosUserId: "workos_user_1",
  email: "test@example.com",
  name: "Test User",
}

describe("InvitationService.acceptInvitation", () => {
  let service: InvitationService

  const invitation = {
    id: "inv_1",
    workspaceId: "ws_1",
    email: "test@example.com",
    role: "user",
    invitedBy: "usr_owner",
    status: "pending",
  }

  const mockUpdateStatus = spyOn(InvitationRepository, "updateStatus")
  const mockFindInvitationById = spyOn(InvitationRepository, "findById")
  const mockIsMember = spyOn(UserRepository, "isMember")
  const mockInsertOutbox = spyOn(OutboxRepository, "insert")

  spyOn(db, "withTransaction").mockImplementation((_pool, fn) => fn({} as PoolClient))

  const mockCreateUser = mock<() => Promise<{ id: string; workspaceId: string }>>()

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
    mockCreateUser.mockReset().mockResolvedValue({ id: "usr_new", workspaceId: "ws_1" })

    service = new InvitationService(
      {} as never,
      {
        createUserInTransaction: mockCreateUser,
      } as never
    )
  })

  test("should delegate user creation to workspaceService when accepting invitation", async () => {
    await service.acceptInvitation("inv_1", identity)

    expect(mockCreateUser).toHaveBeenCalledWith({} as PoolClient, {
      workspaceId: "ws_1",
      workosUserId: "workos_user_1",
      email: "test@example.com",
      name: "Test User",
      role: "user",
      setupCompleted: false,
    })
  })

  test("should emit invitation:accepted outbox event", async () => {
    await service.acceptInvitation("inv_1", identity)

    const acceptedCall = mockInsertOutbox.mock.calls.find((call) => call[1] === "invitation:accepted")
    expect(acceptedCall).toBeDefined()
    expect(acceptedCall![2]).toMatchObject({
      workspaceId: "ws_1",
      invitationId: "inv_1",
      email: "test@example.com",
      workosUserId: "workos_user_1",
      userName: "Test User",
    })
  })

  test("should not create user when WorkOS user is already in the workspace", async () => {
    mockIsMember.mockResolvedValue(true)

    await service.acceptInvitation("inv_1", identity)

    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  test("should return null when invitation is no longer pending and not previously accepted", async () => {
    mockUpdateStatus.mockResolvedValue(false)
    mockFindInvitationById.mockResolvedValue({ ...invitation, status: "revoked" } as never)

    const result = await service.acceptInvitation("inv_1", identity)

    expect(result).toBeNull()
    expect(mockInsertOutbox).not.toHaveBeenCalled()
    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  test("should return workspaceId on idempotent replay when invitation already accepted and user is member", async () => {
    mockUpdateStatus.mockResolvedValue(false)
    mockFindInvitationById.mockResolvedValue({ ...invitation, status: "accepted" } as never)
    mockIsMember.mockResolvedValue(true)

    const result = await service.acceptInvitation("inv_1", identity)

    expect(result).toBe("ws_1")
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockInsertOutbox).not.toHaveBeenCalled()
  })

  test("should return null when invitation already accepted but user is not a member", async () => {
    mockUpdateStatus.mockResolvedValue(false)
    mockFindInvitationById.mockResolvedValue({ ...invitation, status: "accepted" } as never)
    mockIsMember.mockResolvedValue(false)

    const result = await service.acceptInvitation("inv_1", identity)

    expect(result).toBeNull()
    expect(mockCreateUser).not.toHaveBeenCalled()
  })
})

describe("InvitationService.sendInvitations", () => {
  let service: InvitationService

  const mockFindById = spyOn(UserRepository, "findById")
  const mockFindUserEmails = spyOn(UserRepository, "findEmails")
  const mockFindPendingByEmailsAndWorkspace = spyOn(InvitationRepository, "findPendingByEmailsAndWorkspace")
  const mockInsertInvitation = spyOn(InvitationRepository, "insert")
  const mockInsertOutbox = spyOn(OutboxRepository, "insert")

  spyOn(db, "withTransaction").mockImplementation((_pool, fn) => fn({} as PoolClient))

  beforeEach(() => {
    mockFindById.mockReset().mockResolvedValue({ id: "usr_1", workosUserId: "workos_user_1" } as never)
    mockFindUserEmails.mockReset().mockResolvedValue(new Set())
    mockFindPendingByEmailsAndWorkspace.mockReset().mockResolvedValue([])
    mockInsertInvitation
      .mockReset()
      .mockImplementation((_client, data) =>
        Promise.resolve({ ...data, status: "pending", createdAt: new Date() } as never)
      )
    mockInsertOutbox
      .mockReset()
      .mockResolvedValue({ id: 1n, eventType: "test", payload: {}, createdAt: new Date() } as never)

    service = new InvitationService({} as never, {} as never)
  })

  test("should include inviterWorkosUserId in outbox event payload", async () => {
    await service.sendInvitations({
      workspaceId: "ws_1",
      invitedBy: "usr_1",
      emails: ["test@example.com"],
      role: "user",
      roleSlug: "member",
    })

    const sentCall = mockInsertOutbox.mock.calls.find((call) => call[1] === "invitation:sent")
    expect(sentCall).toBeDefined()
    expect(sentCall![2]).toMatchObject({
      workspaceId: "ws_1",
      email: "test@example.com",
      role: "user",
      roleSlug: "member",
      inviterWorkosUserId: "workos_user_1",
    })
  })

  test("should skip emails that are already workspace members", async () => {
    mockFindUserEmails.mockResolvedValue(new Set(["existing@example.com"]))

    const result = await service.sendInvitations({
      workspaceId: "ws_1",
      invitedBy: "usr_1",
      emails: ["existing@example.com", "new@example.com"],
      role: "user",
      roleSlug: "member",
    })

    expect(result.skipped).toEqual([{ email: "existing@example.com", reason: "already_user" }])
    expect(result.sent).toHaveLength(1)
    expect(result.sent[0].email).toBe("new@example.com")
  })

  test("should skip emails with pending invitations", async () => {
    mockFindPendingByEmailsAndWorkspace.mockResolvedValue([{ email: "pending@example.com" } as never])

    const result = await service.sendInvitations({
      workspaceId: "ws_1",
      invitedBy: "usr_1",
      emails: ["pending@example.com"],
      role: "user",
      roleSlug: "member",
    })

    expect(result.skipped).toEqual([{ email: "pending@example.com", reason: "pending_invitation" }])
    expect(result.sent).toHaveLength(0)
  })
})

describe("InvitationService.acceptPendingForEmail", () => {
  let service: InvitationService

  const pendingInvitations = [
    { id: "inv_1", workspaceId: "ws_1", email: "test@example.com", role: "user", status: "pending" },
    { id: "inv_2", workspaceId: "ws_2", email: "test@example.com", role: "admin", status: "pending" },
  ]

  const mockFindPendingByEmail = spyOn(InvitationRepository, "findPendingByEmail")
  const mockUpdateStatus = spyOn(InvitationRepository, "updateStatus")
  const mockFindInvitationById = spyOn(InvitationRepository, "findById")
  const mockIsMember = spyOn(UserRepository, "isMember")
  const mockInsertOutbox = spyOn(OutboxRepository, "insert")
  const mockLoggerError = spyOn(logger, "error")

  const mockClient = { query: mock<(text: string) => Promise<{ rows: never[]; rowCount: number }>>() }
  const mockWithTransaction = spyOn(db, "withTransaction").mockImplementation((_pool, fn) => fn(mockClient as never))

  const mockCreateUser = mock<() => Promise<{ id: string; workspaceId: string }>>()

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
    mockCreateUser.mockReset().mockResolvedValue({ id: "usr_new", workspaceId: "ws_1" })

    service = new InvitationService(
      {} as never,
      {
        createUserInTransaction: mockCreateUser,
      } as never
    )
  })

  test("should return structured result with accepted workspace IDs", async () => {
    const result = await service.acceptPendingForEmail("test@example.com", identity)

    expect(result.accepted).toEqual(["ws_1", "ws_2"])
    expect(result.failed).toEqual([])
  })

  test("should return empty results when no pending invitations", async () => {
    mockFindPendingByEmail.mockResolvedValue([])

    const result = await service.acceptPendingForEmail("test@example.com", identity)

    expect(result.accepted).toEqual([])
    expect(result.failed).toEqual([])
  })

  test("should use a single transaction for all invitations", async () => {
    await service.acceptPendingForEmail("test@example.com", identity)

    // withTransaction called once for 2 invitations (batched)
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })

  test("should capture failed invitations without aborting others", async () => {
    mockCreateUser
      .mockResolvedValueOnce({ id: "usr_1", workspaceId: "ws_1" })
      .mockRejectedValueOnce(new Error("DB constraint violation"))

    const result = await service.acceptPendingForEmail("test@example.com", identity)

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
    await service.acceptPendingForEmail("test@example.com", identity)

    const savepointCalls = mockClient.query.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("SAVEPOINT")
    )
    // 2 invitations: SAVEPOINT + RELEASE for each
    expect(savepointCalls).toHaveLength(4)
  })
})

describe("InvitationService.revokeInvitation", () => {
  let service: InvitationService

  const mockFindById = spyOn(InvitationRepository, "findById")
  const mockUpdateStatus = spyOn(InvitationRepository, "updateStatus")
  const mockInsertOutbox = spyOn(OutboxRepository, "insert")

  spyOn(db, "withTransaction").mockImplementation((_pool, fn) => fn({} as PoolClient))

  beforeEach(() => {
    mockFindById.mockReset().mockResolvedValue({
      id: "inv_1",
      workspaceId: "ws_1",
      email: "test@example.com",
    } as never)
    mockUpdateStatus.mockReset().mockResolvedValue(true)
    mockInsertOutbox
      .mockReset()
      .mockResolvedValue({ id: 1n, eventType: "test", payload: {}, createdAt: new Date() } as never)

    service = new InvitationService({} as never, {} as never)
  })

  test("should create outbox event when revoking", async () => {
    const result = await service.revokeInvitation("inv_1", "ws_1")

    expect(result).toBe(true)
    const revokedCall = mockInsertOutbox.mock.calls.find((call) => call[1] === "invitation:revoked")
    expect(revokedCall).toBeDefined()
    expect(revokedCall![2]).toMatchObject({
      workspaceId: "ws_1",
      invitationId: "inv_1",
    })
  })

  test("should return false when invitation not found", async () => {
    mockFindById.mockResolvedValue(null)

    const result = await service.revokeInvitation("inv_1", "ws_1")

    expect(result).toBe(false)
    expect(mockInsertOutbox).not.toHaveBeenCalled()
  })

  test("should return false when invitation belongs to different workspace", async () => {
    mockFindById.mockResolvedValue({
      id: "inv_1",
      workspaceId: "ws_other",
      email: "test@example.com",
    } as never)

    const result = await service.revokeInvitation("inv_1", "ws_1")

    expect(result).toBe(false)
    expect(mockInsertOutbox).not.toHaveBeenCalled()
  })
})
