import { describe, test, expect, spyOn, beforeEach } from "bun:test"
import type { PoolClient } from "pg"
import { InvitationService } from "./service"
import { InvitationRepository } from "./repository"
import { WorkspaceRepository, MemberRepository } from "../workspaces"
import { UserRepository } from "../../auth/user-repository"
import { OutboxRepository } from "../../lib/outbox"
import * as idModule from "../../lib/id"
import * as slugModule from "../../lib/slug"
import * as serializationModule from "../../lib/serialization"
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
  const mockAddMember = spyOn(WorkspaceRepository, "addMember")
  const mockMemberSlugExists = spyOn(WorkspaceRepository, "memberSlugExists")
  const mockFindMemberById = spyOn(MemberRepository, "findById")
  const mockFindUserById = spyOn(UserRepository, "findById")
  const mockInsertOutbox = spyOn(OutboxRepository, "insert")

  spyOn(idModule, "invitationId").mockReturnValue("inv_1")
  spyOn(idModule, "memberId").mockReturnValue("member_new")
  spyOn(slugModule, "generateUniqueSlug").mockResolvedValue("test-user")
  spyOn(serializationModule, "serializeBigInt").mockImplementation(<T>(v: T) => v)
  spyOn(db, "withTransaction").mockImplementation((_pool, fn) => fn({} as PoolClient))

  beforeEach(() => {
    mockUpdateStatus.mockReset().mockResolvedValue(true)
    mockFindInvitationById.mockReset().mockResolvedValue(invitation as never)
    mockIsMember.mockReset().mockResolvedValue(false)
    mockAddMember.mockReset().mockResolvedValue({ id: "member_new", workspaceId: "ws_1" } as never)
    mockMemberSlugExists.mockReset().mockResolvedValue(false)
    mockFindMemberById.mockReset().mockResolvedValue({
      id: "member_new",
      workspaceId: "ws_1",
      userId: "user_1",
      name: "Test User",
      slug: "test-user",
      email: "test@example.com",
      role: "member",
    } as never)
    mockFindUserById.mockReset().mockResolvedValue({
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
    } as never)
    mockInsertOutbox.mockReset().mockResolvedValue({
      id: 1n,
      eventType: "test",
      payload: {},
      createdAt: new Date(),
    } as never)

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
