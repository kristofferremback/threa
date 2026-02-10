import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AuthorTypes, CompanionModes, StreamTypes, Visibilities } from "@threa/types"
import * as db from "../../db"
import { StreamRepository, StreamMemberRepository } from "../streams"
import { OutboxRepository } from "../../lib/outbox"
import { MemberRepository } from "../workspaces"
import { NotificationService } from "./service"
import type { Stream } from "../streams"

const WORKSPACE_ID = `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`
const MEMBER_A = `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`
const MEMBER_B = `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`

function fakeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: `stream_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`,
    workspaceId: WORKSPACE_ID,
    type: StreamTypes.SYSTEM,
    displayName: "System",
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
    service: new NotificationService({ pool: {} as any, createMessage }),
    createMessage,
  }
}

describe("NotificationService", () => {
  afterEach(() => {
    mock.restore()
  })

  describe("provisionSystemStream", () => {
    it("should create stream and emit outbox event when no stream exists", async () => {
      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(null)
      spyOn(db, "withTransaction").mockImplementation((async (_db: unknown, callback: (client: any) => Promise<any>) =>
        callback({})) as any)

      const insertedStream = fakeStream({ createdBy: MEMBER_A })
      spyOn(StreamRepository, "insertSystemStream").mockResolvedValue({ stream: insertedStream, created: true })
      spyOn(StreamMemberRepository, "insert").mockResolvedValue({} as any)
      spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

      const { service } = createService()
      const stream = await service.provisionSystemStream(WORKSPACE_ID, MEMBER_A)

      expect(stream).toBe(insertedStream)
      expect(StreamRepository.insertSystemStream).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          createdBy: MEMBER_A,
        })
      )
      expect(StreamMemberRepository.insert).toHaveBeenCalledWith({}, expect.stringMatching(/^stream_/), MEMBER_A)
      expect(OutboxRepository.insert).toHaveBeenCalledWith(
        {},
        "stream:created",
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
        })
      )
    })

    it("should be idempotent when stream already exists", async () => {
      const existingStream = fakeStream({ createdBy: MEMBER_A })
      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(existingStream)
      const txSpy = spyOn(db, "withTransaction")

      const { service } = createService()
      const stream = await service.provisionSystemStream(WORKSPACE_ID, MEMBER_A)

      expect(stream).toBe(existingStream)
      expect(txSpy).not.toHaveBeenCalled()
    })

    it("should return existing stream when ON CONFLICT resolves concurrent insert", async () => {
      const existingStream = fakeStream({ createdBy: MEMBER_A })

      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(null)
      spyOn(db, "withTransaction").mockImplementation((async (_db: unknown, callback: (client: any) => Promise<any>) =>
        callback({})) as any)

      // insertSystemStream returns created: false (ON CONFLICT hit)
      spyOn(StreamRepository, "insertSystemStream").mockResolvedValue({ stream: existingStream, created: false })

      const memberInsertSpy = spyOn(StreamMemberRepository, "insert")
      const outboxSpy = spyOn(OutboxRepository, "insert")

      const { service } = createService()
      const stream = await service.provisionSystemStream(WORKSPACE_ID, MEMBER_A)

      expect(stream).toBe(existingStream)
      expect(memberInsertSpy).not.toHaveBeenCalled()
      expect(outboxSpy).not.toHaveBeenCalled()
    })
  })

  describe("notifyMember", () => {
    it("should create message with authorType system and authorId system when notifying a member", async () => {
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

    it("should lazily provision stream when none exists", async () => {
      const newStream = fakeStream({ createdBy: MEMBER_A })

      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(null)
      spyOn(db, "withTransaction").mockImplementation((async (_db: unknown, callback: (client: any) => Promise<any>) =>
        callback({})) as any)
      spyOn(StreamRepository, "insertSystemStream").mockResolvedValue({ stream: newStream, created: true })
      spyOn(StreamMemberRepository, "insert").mockResolvedValue({} as any)
      spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

      const { service, createMessage } = createService()
      await service.notifyMember(WORKSPACE_ID, MEMBER_A, "Test notification")

      expect(StreamRepository.insertSystemStream).toHaveBeenCalled()
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          streamId: newStream.id,
        })
      )
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
    it("should use batch-fetched streams when notifying all workspace members", async () => {
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

      // Batch-fetch returns both streams
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

    it("should bulk-provision missing streams in a single transaction when some members lack streams", async () => {
      const streamA = fakeStream({ createdBy: MEMBER_A })
      const newStreamB = fakeStream({ createdBy: MEMBER_B })

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

      // Only stream A exists — stream B needs provisioning
      spyOn(StreamRepository, "list").mockResolvedValue([streamA])
      spyOn(db, "withTransaction").mockImplementation((async (_db: unknown, callback: (client: any) => Promise<any>) =>
        callback({})) as any)
      spyOn(StreamRepository, "insertSystemStream").mockResolvedValue({ stream: newStreamB, created: true })
      spyOn(StreamMemberRepository, "insert").mockResolvedValue({} as any)
      spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

      const { service, createMessage } = createService()
      await service.notifyWorkspace(WORKSPACE_ID, "Alert")

      // Bulk provision was called once (single transaction for all missing)
      expect(db.withTransaction).toHaveBeenCalledTimes(1)
      expect(createMessage).toHaveBeenCalledTimes(2)
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

      // Batch-fetch returns both streams, but createMessage fails for first member
      spyOn(StreamRepository, "list").mockResolvedValue([streamA, streamB])

      const { service, createMessage } = createService()
      createMessage.mockRejectedValueOnce(new Error("message creation failed")).mockResolvedValueOnce({} as any)

      await service.notifyWorkspace(WORKSPACE_ID, "Alert")

      // Second member still got notified despite first failing
      expect(createMessage).toHaveBeenCalledTimes(2)
      expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ streamId: streamB.id }))
    })
  })
})
