import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AuthorTypes, CompanionModes, StreamTypes, Visibilities } from "@threa/types"
import { StreamRepository } from "../streams"
import { MemberRepository } from "../workspaces"
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
    it("should format budget data as markdown and delegate to notifyWorkspace", async () => {
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
          email: "alice@test.com",
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

  describe("notifyWorkspace", () => {
    it("should send message to each member's system stream", async () => {
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
          email: "alice@test.com",
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
          email: "bob@test.com",
          joinedAt: new Date(),
        },
      ])
      spyOn(StreamRepository, "list").mockResolvedValue([streamA, streamB])

      const { service, createMessage } = createService()
      await service.notifyWorkspace(WORKSPACE_ID, "Workspace-wide alert")

      expect(StreamRepository.list).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, {
        types: [StreamTypes.SYSTEM],
      })
      expect(createMessage).toHaveBeenCalledTimes(2)
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ streamId: streamA.id, content: "Workspace-wide alert" })
      )
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ streamId: streamB.id, content: "Workspace-wide alert" })
      )
    })

    it("should skip members with missing streams and continue notifying others", async () => {
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
          email: "alice@test.com",
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
          email: "bob@test.com",
          joinedAt: new Date(),
        },
      ])

      // Only member B has a system stream
      spyOn(StreamRepository, "list").mockResolvedValue([streamB])

      const { service, createMessage } = createService()
      await service.notifyWorkspace(WORKSPACE_ID, "Alert")

      expect(createMessage).toHaveBeenCalledTimes(1)
      expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ streamId: streamB.id }))
    })

    it("should continue notifying remaining members when one fails", async () => {
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
          email: "alice@test.com",
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
          email: "bob@test.com",
          joinedAt: new Date(),
        },
      ])

      spyOn(StreamRepository, "list").mockResolvedValue([streamA, streamB])

      const { service, createMessage } = createService()
      createMessage.mockRejectedValueOnce(new Error("message creation failed")).mockResolvedValueOnce({} as any)

      await service.notifyWorkspace(WORKSPACE_ID, "Alert")

      expect(createMessage).toHaveBeenCalledTimes(2)
      expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ streamId: streamB.id }))
    })
  })
})
