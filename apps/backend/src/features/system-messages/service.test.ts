import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AuthorTypes, CompanionModes, StreamTypes, Visibilities } from "@threa/types"
import { StreamRepository } from "../streams"
import { InvitationRepository } from "../invitations"
import { UserRepository, WorkspaceRepository } from "../workspaces"
import { SystemMessageService } from "./service"
import type { Stream } from "../streams"

const WORKSPACE_ID = `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`
const USER_A = `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`
const USER_B = `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`

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
    createdBy: USER_A,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    displayNameGeneratedAt: null,
    ...overrides,
  }
}

function fakeUser(overrides: Partial<Awaited<ReturnType<typeof UserRepository.findById>>> = {}) {
  return {
    id: USER_A,
    workspaceId: WORKSPACE_ID,
    workosUserId: "workos_user_1",
    email: "alice@test.com",
    role: "admin" as const,
    slug: "alice",
    name: "Alice",
    description: null,
    avatarUrl: null,
    timezone: null,
    locale: null,
    pronouns: null,
    phone: null,
    githubUsername: null,
    setupCompleted: true,
    joinedAt: new Date(),
    ...(overrides as object),
  }
}

function fakeWorkspace(overrides: Partial<Awaited<ReturnType<typeof WorkspaceRepository.findById>>> = {}) {
  return {
    id: WORKSPACE_ID,
    name: "Workspace",
    slug: "workspace",
    createdBy: USER_A,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(overrides as object),
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

  describe("notifyUser", () => {
    it("should send message to existing system stream", async () => {
      const systemStream = fakeStream({ createdBy: USER_A })
      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(systemStream)

      const { service, createMessage } = createService()
      await service.notifyUser(WORKSPACE_ID, USER_A, "Hello from the system")

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
      await service.notifyUser(WORKSPACE_ID, USER_A, "Test notification")

      expect(createMessage).not.toHaveBeenCalled()
    })
  })

  describe("sendBudgetAlert", () => {
    it("should format budget data as markdown and delegate to notifyOwners", async () => {
      const streamA = fakeStream({ createdBy: USER_A })

      spyOn(UserRepository, "listByWorkspace").mockResolvedValue([fakeUser({ id: USER_A })] as never)
      spyOn(WorkspaceRepository, "findById").mockResolvedValue(fakeWorkspace({ createdBy: USER_A }) as never)
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
    it("should send message to the workspace creator's system stream", async () => {
      const streamA = fakeStream({ createdBy: USER_A })

      spyOn(UserRepository, "listByWorkspace").mockResolvedValue([
        fakeUser({ id: USER_A, role: "admin", name: "Alice", email: "alice@test.com" }),
        fakeUser({ id: USER_B, role: "admin", name: "Bob", email: "bob@test.com" }),
      ] as never)
      spyOn(WorkspaceRepository, "findById").mockResolvedValue(fakeWorkspace({ createdBy: USER_A }) as never)
      spyOn(StreamRepository, "list").mockResolvedValue([streamA])

      const { service, createMessage } = createService()
      await service.notifyOwners(WORKSPACE_ID, "Owner alert")

      expect(StreamRepository.list).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, {
        types: [StreamTypes.SYSTEM],
      })
      expect(createMessage).toHaveBeenCalledTimes(1)
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ streamId: streamA.id, content: "Owner alert" })
      )
    })

    it("should ignore role flags and only notify workspace.createdBy", async () => {
      const streamA = fakeStream({ createdBy: USER_A })

      spyOn(UserRepository, "listByWorkspace").mockResolvedValue([
        fakeUser({ id: USER_A, role: "user", name: "Alice" }),
        fakeUser({ id: USER_B, role: "owner", name: "Bob" }),
      ] as never)
      spyOn(WorkspaceRepository, "findById").mockResolvedValue(fakeWorkspace({ createdBy: USER_A }) as never)
      spyOn(StreamRepository, "list").mockResolvedValue([streamA])

      const { service, createMessage } = createService()
      await service.notifyOwners(WORKSPACE_ID, "Alert")

      expect(createMessage).toHaveBeenCalledTimes(1)
      expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ streamId: streamA.id }))
    })

    it("should skip the workspace owner when the system stream is missing", async () => {
      spyOn(UserRepository, "listByWorkspace").mockResolvedValue([fakeUser({ id: USER_A, role: "admin" })] as never)
      spyOn(WorkspaceRepository, "findById").mockResolvedValue(fakeWorkspace({ createdBy: USER_A }) as never)
      spyOn(StreamRepository, "list").mockResolvedValue([])

      const { service, createMessage } = createService()
      await service.notifyOwners(WORKSPACE_ID, "Alert")

      expect(createMessage).not.toHaveBeenCalled()
    })

    it("should skip notifications when the workspace is missing", async () => {
      spyOn(UserRepository, "listByWorkspace").mockResolvedValue([fakeUser({ id: USER_A, role: "admin" })] as never)
      spyOn(WorkspaceRepository, "findById").mockResolvedValue(null)
      spyOn(StreamRepository, "list").mockResolvedValue([])

      const { service, createMessage } = createService()
      await service.notifyOwners(WORKSPACE_ID, "Alert")

      expect(createMessage).not.toHaveBeenCalled()
    })

    it("should swallow message creation failures for the workspace owner", async () => {
      const streamA = fakeStream({ createdBy: USER_A })

      spyOn(UserRepository, "listByWorkspace").mockResolvedValue([fakeUser({ id: USER_A, role: "admin" })] as never)
      spyOn(WorkspaceRepository, "findById").mockResolvedValue(fakeWorkspace({ createdBy: USER_A }) as never)
      spyOn(StreamRepository, "list").mockResolvedValue([streamA])

      const { service, createMessage } = createService()
      createMessage.mockRejectedValueOnce(new Error("message creation failed"))

      await service.notifyOwners(WORKSPACE_ID, "Alert")

      expect(createMessage).toHaveBeenCalledTimes(1)
      expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ streamId: streamA.id }))
    })
  })

  describe("sendInvitationAccepted", () => {
    const INVITER_ID = USER_A
    const INVITATION_ID = `inv_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`

    it("should notify the inviter with the accepting user's name", async () => {
      const inviterStream = fakeStream({ createdBy: INVITER_ID })

      spyOn(InvitationRepository, "findById").mockResolvedValue({
        id: INVITATION_ID,
        workspaceId: WORKSPACE_ID,
        email: "newuser@test.com",
        role: "user",
        invitedBy: INVITER_ID,
        workosInvitationId: null,
        status: "accepted",
        createdAt: new Date(),
        expiresAt: new Date(),
        acceptedAt: new Date(),
        revokedAt: null,
      } as never)

      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(inviterStream)

      const { service, createMessage } = createService()
      await service.sendInvitationAccepted({
        workspaceId: WORKSPACE_ID,
        invitationId: INVITATION_ID,
        email: "newuser@test.com",
        workosUserId: "workos_user_2",
        userName: "New User",
      })

      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          streamId: inviterStream.id,
          content: "**New User** accepted your invitation and joined the workspace.",
        })
      )
    })

    it("should fall back to email when payload has no user name", async () => {
      const inviterStream = fakeStream({ createdBy: INVITER_ID })

      spyOn(InvitationRepository, "findById").mockResolvedValue({
        id: INVITATION_ID,
        workspaceId: WORKSPACE_ID,
        email: "anonymous@test.com",
        role: "user",
        invitedBy: INVITER_ID,
        workosInvitationId: null,
        status: "accepted",
        createdAt: new Date(),
        expiresAt: new Date(),
        acceptedAt: new Date(),
        revokedAt: null,
      } as never)

      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(inviterStream)

      const { service, createMessage } = createService()
      await service.sendInvitationAccepted({
        workspaceId: WORKSPACE_ID,
        invitationId: INVITATION_ID,
        email: "anonymous@test.com",
        workosUserId: "workos_user_3",
        userName: "",
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
        workosUserId: "workos_user_9",
        userName: "Test",
      })

      expect(createMessage).not.toHaveBeenCalled()
    })
  })
})
