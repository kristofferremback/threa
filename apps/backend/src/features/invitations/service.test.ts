import { describe, test, expect, mock, beforeEach } from "bun:test"
import { InvitationService } from "./service"

const mockUpdateStatus = mock(() => Promise.resolve(true as boolean))
const mockFindInvitationById = mock(() => Promise.resolve(null as Record<string, unknown> | null))

const mockIsMember = mock(() => Promise.resolve(false))
const mockAddMember = mock((_client: unknown, _params: Record<string, unknown>) =>
  Promise.resolve({ id: "member_new", workspaceId: "ws_1" })
)
const mockMemberSlugExists = mock(() => Promise.resolve(false))

const mockFindMemberById = mock(() =>
  Promise.resolve({
    id: "member_new",
    workspaceId: "ws_1",
    userId: "user_1",
    name: "Test User",
    slug: "test-user",
    email: "test@example.com",
    role: "member",
  } as Record<string, unknown> | null)
)

const mockFindUserById = mock(() =>
  Promise.resolve({ id: "user_1", name: "Test User", email: "test@example.com" } as Record<string, unknown> | null)
)

const mockInsertOutbox = mock((_client: unknown, _eventType: string, _payload: Record<string, unknown>) =>
  Promise.resolve({ id: 1n, eventType: "test", payload: {}, createdAt: new Date() })
)

mock.module("./repository", () => ({
  InvitationRepository: {
    updateStatus: mockUpdateStatus,
    findById: mockFindInvitationById,
  },
}))

mock.module("../workspaces", () => ({
  WorkspaceRepository: {
    isMember: mockIsMember,
    addMember: mockAddMember,
    memberSlugExists: mockMemberSlugExists,
  },
  MemberRepository: {
    findById: mockFindMemberById,
  },
}))

mock.module("../../auth/user-repository", () => ({
  UserRepository: {
    findById: mockFindUserById,
  },
}))

mock.module("../../lib/outbox", () => ({
  OutboxRepository: {
    insert: mockInsertOutbox,
  },
}))

mock.module("../../lib/id", () => ({
  invitationId: () => "inv_1",
  memberId: () => "member_new",
}))

mock.module("../../lib/slug", () => ({
  generateUniqueSlug: () => Promise.resolve("test-user"),
}))

mock.module("../../lib/serialization", () => ({
  serializeBigInt: <T>(v: T) => v,
}))

mock.module("../../db", () => ({
  withTransaction: (_pool: unknown, fn: (client: unknown) => Promise<unknown>) => fn({}),
}))

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

  beforeEach(() => {
    mockUpdateStatus.mockReset()
    mockFindInvitationById.mockReset()
    mockIsMember.mockReset()
    mockAddMember.mockReset()
    mockFindMemberById.mockReset()
    mockFindUserById.mockReset()
    mockInsertOutbox.mockReset()

    mockUpdateStatus.mockResolvedValue(true)
    mockFindInvitationById.mockResolvedValue(invitation)
    mockIsMember.mockResolvedValue(false)
    mockAddMember.mockResolvedValue({ id: "member_new", workspaceId: "ws_1" })
    mockFindMemberById.mockResolvedValue({
      id: "member_new",
      workspaceId: "ws_1",
      userId: "user_1",
      name: "Test User",
      slug: "test-user",
      email: "test@example.com",
      role: "member",
    })
    mockFindUserById.mockResolvedValue({ id: "user_1", name: "Test User", email: "test@example.com" })
    mockInsertOutbox.mockResolvedValue({ id: 1n, eventType: "test", payload: {}, createdAt: new Date() })

    service = new InvitationService({} as never, {} as never)
  })

  test("should emit workspace_member:added outbox event when accepting invitation", async () => {
    await service.acceptInvitation("inv_1", "user_1")

    const outboxCalls = mockInsertOutbox.mock.calls
    const memberAddedCall = outboxCalls.find((call) => call[1] === "workspace_member:added")

    expect(memberAddedCall).toBeDefined()
    expect(memberAddedCall![2]).toMatchObject({
      workspaceId: "ws_1",
      member: expect.objectContaining({
        id: "member_new",
        name: "Test User",
      }),
    })
  })

  test("should emit both workspace_member:added and invitation:accepted outbox events", async () => {
    await service.acceptInvitation("inv_1", "user_1")

    const eventTypes = mockInsertOutbox.mock.calls.map((call) => call[1])
    expect(eventTypes).toContain("workspace_member:added")
    expect(eventTypes).toContain("invitation:accepted")
  })

  test("should not emit workspace_member:added when user is already a member", async () => {
    mockIsMember.mockResolvedValue(true)

    await service.acceptInvitation("inv_1", "user_1")

    const eventTypes = mockInsertOutbox.mock.calls.map((call) => call[1])
    expect(eventTypes).not.toContain("workspace_member:added")
  })

  test("should return null when invitation update fails", async () => {
    mockUpdateStatus.mockResolvedValue(false)

    const result = await service.acceptInvitation("inv_1", "user_1")

    expect(result).toBeNull()
    expect(mockInsertOutbox).not.toHaveBeenCalled()
  })
})
