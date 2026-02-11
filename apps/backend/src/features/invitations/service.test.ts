import { describe, test, expect, spyOn, beforeEach, mock } from "bun:test"
import type { PoolClient } from "pg"
import { InvitationService } from "./service"
import { InvitationRepository } from "./repository"
import { WorkspaceRepository } from "../workspaces"
import { OutboxRepository } from "../../lib/outbox"
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
