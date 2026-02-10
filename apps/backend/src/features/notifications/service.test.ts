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
    it("should create stream with type system and private visibility", async () => {
      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValue(null)
      spyOn(db, "withTransaction").mockImplementation((async (_db: unknown, callback: (client: any) => Promise<any>) =>
        callback({})) as any)

      const insertedStream = fakeStream({ createdBy: MEMBER_A })
      spyOn(StreamRepository, "insert").mockResolvedValue(insertedStream)
      spyOn(StreamMemberRepository, "insert").mockResolvedValue({} as any)
      spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

      const { service } = createService()
      const stream = await service.provisionSystemStream(WORKSPACE_ID, MEMBER_A)

      expect(stream).toBe(insertedStream)
      expect(StreamRepository.insert).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          type: StreamTypes.SYSTEM,
          displayName: "System",
          visibility: Visibilities.PRIVATE,
          companionMode: CompanionModes.OFF,
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

    it("should handle concurrent provisioning via in-transaction re-check", async () => {
      const existingStream = fakeStream({ createdBy: MEMBER_A })

      // First call: findByTypeAndOwner returns null (outside tx)
      // Inside transaction: findByTypeAndOwner returns existing (race resolved)
      spyOn(StreamRepository, "findByTypeAndOwner")
        .mockResolvedValueOnce(null) // pre-tx check
        .mockResolvedValueOnce(existingStream) // in-tx re-check

      spyOn(db, "withTransaction").mockImplementation((async (_db: unknown, callback: (client: any) => Promise<any>) =>
        callback({})) as any)

      const insertSpy = spyOn(StreamRepository, "insert")

      const { service } = createService()
      const stream = await service.provisionSystemStream(WORKSPACE_ID, MEMBER_A)

      expect(stream).toBe(existingStream)
      expect(insertSpy).not.toHaveBeenCalled()
    })
  })

  describe("notifyMember", () => {
    it("should create message with authorType system and authorId system", async () => {
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
      spyOn(StreamRepository, "insert").mockResolvedValue(newStream)
      spyOn(StreamMemberRepository, "insert").mockResolvedValue({} as any)
      spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

      const { service, createMessage } = createService()
      await service.notifyMember(WORKSPACE_ID, MEMBER_A, "Test notification")

      expect(StreamRepository.insert).toHaveBeenCalled()
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          streamId: newStream.id,
        })
      )
    })
  })

  describe("notifyWorkspace", () => {
    it("should create messages for all workspace members", async () => {
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

      spyOn(StreamRepository, "findByTypeAndOwner").mockResolvedValueOnce(streamA).mockResolvedValueOnce(streamB)

      const { service, createMessage } = createService()
      await service.notifyWorkspace(WORKSPACE_ID, "Workspace-wide alert")

      expect(createMessage).toHaveBeenCalledTimes(2)
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ streamId: streamA.id, content: "Workspace-wide alert" })
      )
      expect(createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ streamId: streamB.id, content: "Workspace-wide alert" })
      )
    })

    it("should continue notifying remaining members when one fails", async () => {
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

      // First member's stream lookup fails
      spyOn(StreamRepository, "findByTypeAndOwner")
        .mockRejectedValueOnce(new Error("db error"))
        .mockResolvedValueOnce(streamB)

      const { service, createMessage } = createService()
      await service.notifyWorkspace(WORKSPACE_ID, "Alert")

      // Second member still got notified despite first failing
      expect(createMessage).toHaveBeenCalledTimes(1)
      expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({ streamId: streamB.id }))
    })
  })
})
