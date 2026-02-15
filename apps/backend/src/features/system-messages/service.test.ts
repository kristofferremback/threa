import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AuthorTypes, CompanionModes, StreamTypes, Visibilities } from "@threa/types"
import { StreamRepository } from "../streams"
import { InvitationRepository } from "../invitations"
import { MemberRepository } from "../workspaces"
import { UserRepository } from "../../auth/user-repository"
import { SystemMessageService } from "./service"
import type { Stream } from "../streams"

const WORKSPACE_ID = `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`
const MEMBER_A = `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`
const MEMBER_B = `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`

function fakeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: `stream_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`,
    workspaceId: WORKSPACE_ID,
    type: StreamTypes.SYSTEM,
    displayName: "Threa",
    slug: null,
    description: null,
    visibility: Visibilities.PRIVATE,
    parentStreamId: null,
    parentMessageId: null,
    rootStreamId: null,
    companionMode: CompanionModes.OFF,
    companionPersonaId: null,
    createdBy: MEMBER_A,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    displayNameGeneratedAt: null,
    ...overrides,
  }
}

function createService() {
  const createMessage = mock(async () => ({}) as any)

  return {
    service: new SystemMessageService({ pool: {} as any, createMessage }),
    createMessage,
  }
}

describe("SystemMessageService", () => {
  afterEach(() => {
    mock.restore()
  })

  describe("notifyMember", () => {
    it("should send message to existing system stream", async () => {
      const systemStream = fakeStream({ createdBy: MEMBER_A })
      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(systemStream)

      const { service, createMessage } = createService()
      await service.notifyMember(WORKSPACE_ID, MEMBER_A, "Hello from the system")

      expect(createMessage).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        streamId: systemStream.id,
        authorId: AuthorTypes.SYSTEM,
        authorType: AuthorTypes.SYSTEM,
        content: "Hello from the system",
      })
    })

    it("should log error and skip when system stream is missing", async () => {
      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(null)

      const { service, createMessage } = createService()
      await service.notifyMember(WORKSPACE_ID, MEMBER_A, "Test notification")

      expect(createMessage).not.toHaveBeenCalled()
    })
  })

  describe("sendBudgetAlert", () => {
    it("should format budget data as markdown and delegate to notifyOwners", async () => {
      const streamA = fakeStream({ createdBy: MEMBER_A })

      spyOn(MemberRepository, "listByWorkspace").mockResolvedValue([
        {
          id: MEMBER_A,
          workspaceId: WORKSPACE_ID,
          userId: "usr_1",
          role: "owner",
          slug: "alice",
          timezone: null,
          locale: null,
          name: "Alice",
          description: null,
          avatarUrl: null,
          email: "alice@test.com",
          setupCompleted: true,
          joinedAt: new Date(),
        },
      ])
      spyOn(StreamRepository, "list").mockResolvedValue([streamA])

      const { service, createMessage } = createService()
      await service.sendBudgetAlert({
        workspaceId: WORKSPACE_ID,
        alertType: "threshold",
        thresholdPercent: 80,
        currentUsageUsd: 40.5,
        budgetUsd: 50,
        percentUsed: 81,
      })

      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "**Budget alert** — AI usage has reached 81% of your $50/month budget ($40.50 spent).",
        })
      )
    })
  })

  describe("notifyOwners", () => {
    it("should send message to each owner's system stream", async () => {
      const streamA = fakeStream({ createdBy: MEMBER_A })
      const streamB = fakeStream({ createdBy: MEMBER_B })

      spyOn(MemberRepository, "listByWorkspace").mockResolvedValue([
        {
          id: MEMBER_A,
          workspaceId: WORKSPACE_ID,
          userId: "usr_1",
          role: "owner",
          slug: "alice",
          timezone: null,
          locale: null,
          name: "Alice",
          description: null,
          avatarUrl: null,
          email: "alice@test.com",
          setupCompleted: true,
          joinedAt: new Date(),
        },
        {
          id: MEMBER_B,
          workspaceId: WORKSPACE_ID,
          userId: "usr_2",
          role: "owner",
          slug: "bob",
          timezone: null,
          locale: null,
          name: "Bob",
          description: null,
          avatarUrl: null,
          email: "bob@test.com",
          setupCompleted: true,
          joinedAt: new Date(),
        },
      ])
      spyOn(StreamRepository, "list").mockResolvedValue([streamA, streamB])

      const { service, createMessage } = createService()
      await service.notifyOwners(WORKSPACE_ID, "Owner alert")

      expect(StreamRepository.list).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, {
        types: [StreamTypes.SYSTEM],
      })
      expect(createMessage).toHaveBeenCalledTimes(2)
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ streamId: streamA.id, content: "Owner alert" })
      )
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ streamId: streamB.id, content: "Owner alert" })
      )
    })

    it("should only notify owners, not regular members", async () => {
      const streamA = fakeStream({ createdBy: MEMBER_A })

      spyOn(MemberRepository, "listByWorkspace").mockResolvedValue([
        {
          id: MEMBER_A,
          workspaceId: WORKSPACE_ID,
          userId: "usr_1",
          role: "owner",
          slug: "alice",
          timezone: null,
          locale: null,
          name: "Alice",
          description: null,
          avatarUrl: null,
          email: "alice@test.com",
          setupCompleted: true,
          joinedAt: new Date(),
        },
        {
          id: MEMBER_B,
          workspaceId: WORKSPACE_ID,
          userId: "usr_2",
          role: "member",
          slug: "bob",
          timezone: null,
          locale: null,
          name: "Bob",
          description: null,
          avatarUrl: null,
          email: "bob@test.com",
          setupCompleted: true,
          joinedAt: new Date(),
        },
      ])
      spyOn(StreamRepository, "list").mockResolvedValue([streamA])

      const { service, createMessage } = createService()
      await service.notifyOwners(WORKSPACE_ID, "Alert")

      expect(createMessage).toHaveBeenCalledTimes(1)
      expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ streamId: streamA.id }))
    })

    it("should skip owners with missing streams and continue notifying others", async () => {
      const streamB = fakeStream({ createdBy: MEMBER_B })

      spyOn(MemberRepository, "listByWorkspace").mockResolvedValue([
        {
          id: MEMBER_A,
          workspaceId: WORKSPACE_ID,
          userId: "usr_1",
          role: "owner",
          slug: "alice",
          timezone: null,
          locale: null,
          name: "Alice",
          description: null,
          avatarUrl: null,
          email: "alice@test.com",
          setupCompleted: true,
          joinedAt: new Date(),
        },
        {
          id: MEMBER_B,
          workspaceId: WORKSPACE_ID,
          userId: "usr_2",
          role: "owner",
          slug: "bob",
          timezone: null,
          locale: null,
          name: "Bob",
          description: null,
          avatarUrl: null,
          email: "bob@test.com",
          setupCompleted: true,
          joinedAt: new Date(),
        },
      ])

      // Only owner B has a system stream
      spyOn(StreamRepository, "list").mockResolvedValue([streamB])

      const { service, createMessage } = createService()
      await service.notifyOwners(WORKSPACE_ID, "Alert")

      expect(createMessage).toHaveBeenCalledTimes(1)
      expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ streamId: streamB.id }))
    })

    it("should continue notifying remaining owners when one fails", async () => {
      const streamA = fakeStream({ createdBy: MEMBER_A })
      const streamB = fakeStream({ createdBy: MEMBER_B })

      spyOn(MemberRepository, "listByWorkspace").mockResolvedValue([
        {
          id: MEMBER_A,
          workspaceId: WORKSPACE_ID,
          userId: "usr_1",
          role: "owner",
          slug: "alice",
          timezone: null,
          locale: null,
          name: "Alice",
          description: null,
          avatarUrl: null,
          email: "alice@test.com",
          setupCompleted: true,
          joinedAt: new Date(),
        },
        {
          id: MEMBER_B,
          workspaceId: WORKSPACE_ID,
          userId: "usr_2",
          role: "owner",
          slug: "bob",
          timezone: null,
          locale: null,
          name: "Bob",
          description: null,
          avatarUrl: null,
          email: "bob@test.com",
          setupCompleted: true,
          joinedAt: new Date(),
        },
      ])

      spyOn(StreamRepository, "list").mockResolvedValue([streamA, streamB])

      const { service, createMessage } = createService()
      createMessage.mockRejectedValueOnce(new Error("message creation failed")).mockResolvedValueOnce({} as any)

      await service.notifyOwners(WORKSPACE_ID, "Alert")

      expect(createMessage).toHaveBeenCalledTimes(2)
      expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ streamId: streamB.id }))
    })
  })

  describe("sendInvitationAccepted", () => {
    const INVITER_ID = MEMBER_A
    const INVITEE_USER_ID = `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`
    const INVITATION_ID = `inv_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`

    it("should notify the inviter with the accepting user's name", async () => {
      const inviterStream = fakeStream({ createdBy: INVITER_ID })

      spyOn(InvitationRepository, "findById").mockResolvedValue({
        id: INVITATION_ID,
        workspaceId: WORKSPACE_ID,
        email: "newuser@test.com",
        role: "member",
        invitedBy: INVITER_ID,
        workosInvitationId: null,
        status: "accepted",
        createdAt: new Date(),
        expiresAt: new Date(),
        acceptedAt: new Date(),
        revokedAt: null,
      })

      spyOn(UserRepository, "findById").mockResolvedValue({
        id: INVITEE_USER_ID,
        email: "newuser@test.com",
        name: "New User",
        workosUserId: "wos_123",
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(inviterStream)

      const { service, createMessage } = createService()
      await service.sendInvitationAccepted({
        workspaceId: WORKSPACE_ID,
        invitationId: INVITATION_ID,
        email: "newuser@test.com",
        userId: INVITEE_USER_ID,
      })

      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          streamId: inviterStream.id,
          content: "**New User** accepted your invitation and joined the workspace.",
        })
      )
    })

    it("should fall back to email when user has no name", async () => {
      const inviterStream = fakeStream({ createdBy: INVITER_ID })

      spyOn(InvitationRepository, "findById").mockResolvedValue({
        id: INVITATION_ID,
        workspaceId: WORKSPACE_ID,
        email: "anonymous@test.com",
        role: "member",
        invitedBy: INVITER_ID,
        workosInvitationId: null,
        status: "accepted",
        createdAt: new Date(),
        expiresAt: new Date(),
        acceptedAt: new Date(),
        revokedAt: null,
      })

      spyOn(UserRepository, "findById").mockResolvedValue(null)
      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(inviterStream)

      const { service, createMessage } = createService()
      await service.sendInvitationAccepted({
        workspaceId: WORKSPACE_ID,
        invitationId: INVITATION_ID,
        email: "anonymous@test.com",
        userId: INVITEE_USER_ID,
      })

      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "**anonymous@test.com** accepted your invitation and joined the workspace.",
        })
      )
    })

    it("should skip notification when invitation is not found", async () => {
      spyOn(InvitationRepository, "findById").mockResolvedValue(null)

      const { service, createMessage } = createService()
      await service.sendInvitationAccepted({
        workspaceId: WORKSPACE_ID,
        invitationId: "inv_nonexistent",
        email: "test@test.com",
        userId: INVITEE_USER_ID,
      })

      expect(createMessage).not.toHaveBeenCalled()
    })
  })
})
