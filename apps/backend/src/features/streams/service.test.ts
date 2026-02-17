import { describe, test, expect, spyOn, beforeEach } from "bun:test"
import type { PoolClient } from "pg"
import { StreamService } from "./service"
import { StreamRepository } from "./repository"
import { StreamMemberRepository } from "./member-repository"
import { StreamEventRepository } from "./event-repository"
import { OutboxRepository } from "../../lib/outbox"
import { MemberRepository } from "../workspaces"
import * as idModule from "../../lib/id"
import * as db from "../../db"
import { HttpError } from "../../lib/errors"

const mockFindById = spyOn(StreamRepository, "findById")
const mockInsertOrFindByUniquenessKey = spyOn(StreamRepository, "insertOrFindByUniquenessKey")
const mockInsertMember = spyOn(StreamMemberRepository, "insert")
const mockInsertManyMembers = spyOn(StreamMemberRepository, "insertMany")
const mockInsertEvent = spyOn(StreamEventRepository, "insert")
const mockInsertOutbox = spyOn(OutboxRepository, "insert")
const mockFindMembersByIds = spyOn(MemberRepository, "findByIds")

spyOn(idModule, "eventId").mockReturnValue("evt_1")
spyOn(idModule, "streamId").mockReturnValue("stream_new")
spyOn(db, "withClient").mockImplementation((_pool, fn) => fn({} as PoolClient))
spyOn(db, "withTransaction").mockImplementation((_pool, fn) => fn({} as PoolClient))

describe("StreamService.joinPublicChannel", () => {
  let service: StreamService

  beforeEach(() => {
    mockFindById.mockReset()
    mockInsertMember.mockReset().mockResolvedValue({
      streamId: "stream_1",
      memberId: "member_1",
      pinned: false,
      pinnedAt: null,
      notificationLevel: null,
      lastReadEventId: null,
      lastReadAt: null,
      joinedAt: new Date(),
    } as never)
    mockInsertEvent.mockReset().mockResolvedValue({
      id: "evt_1",
      streamId: "stream_1",
      sequence: 1n,
      eventType: "member_joined",
      payload: {},
      actorId: "member_1",
      actorType: "member",
      createdAt: new Date(),
    } as never)
    mockInsertOutbox.mockReset().mockResolvedValue({
      id: 1n,
      eventType: "stream:member_joined",
      payload: {},
      createdAt: new Date(),
    } as never)
    service = new StreamService({} as never)
  })

  test("should return membership when joining a public channel", async () => {
    mockFindById.mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_1",
      type: "channel",
      visibility: "public",
    } as never)

    const result = await service.joinPublicChannel("stream_1", "ws_1", "member_1")

    expect(result).toMatchObject({ streamId: "stream_1", memberId: "member_1" })
    expect(mockInsertMember).toHaveBeenCalledWith({}, "stream_1", "member_1")
  })

  test("should emit member_joined stream event and outbox event", async () => {
    mockFindById.mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_1",
      type: "channel",
      visibility: "public",
    } as never)

    await service.joinPublicChannel("stream_1", "ws_1", "member_1")

    expect(mockInsertEvent).toHaveBeenCalledWith(
      {},
      {
        id: "evt_1",
        streamId: "stream_1",
        eventType: "member_joined",
        payload: {},
        actorId: "member_1",
        actorType: "member",
      }
    )

    expect(mockInsertOutbox).toHaveBeenCalledWith({}, "stream:member_joined", {
      workspaceId: "ws_1",
      streamId: "stream_1",
      event: expect.objectContaining({
        id: "evt_1",
        streamId: "stream_1",
        eventType: "member_joined",
        actorId: "member_1",
      }),
    })
  })

  test("should throw 404 when stream does not exist", async () => {
    mockFindById.mockResolvedValue(null)

    await expect(service.joinPublicChannel("stream_x", "ws_1", "member_1")).rejects.toThrow("Stream not found")
  })

  test("should throw 404 when stream belongs to different workspace", async () => {
    mockFindById.mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_other",
      type: "channel",
      visibility: "public",
    } as never)

    await expect(service.joinPublicChannel("stream_1", "ws_1", "member_1")).rejects.toThrow("Stream not found")
  })

  test("should throw 403 when stream is not a channel", async () => {
    mockFindById.mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_1",
      type: "scratchpad",
      visibility: "public",
    } as never)

    const error = await service.joinPublicChannel("stream_1", "ws_1", "member_1").catch((e) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(403)
    expect((error as HttpError).message).toBe("Can only join public channels")
  })

  test("should throw 403 when channel is private", async () => {
    mockFindById.mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_1",
      type: "channel",
      visibility: "private",
    } as never)

    const error = await service.joinPublicChannel("stream_1", "ws_1", "member_1").catch((e) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(403)
  })
})

describe("StreamService.resolveWritableMessageStream", () => {
  let service: StreamService

  beforeEach(() => {
    service = new StreamService({} as never)
  })

  test("should resolve DM target via findOrCreateDm", async () => {
    const dmStream = {
      id: "stream_dm",
      workspaceId: "ws_1",
      type: "dm",
      archivedAt: null,
    } as never

    const findOrCreateDmSpy = spyOn(service, "findOrCreateDm").mockResolvedValue(dmStream)
    const isMemberSpy = spyOn(service, "isMember").mockResolvedValue(true)

    const resolved = await service.resolveWritableMessageStream({
      workspaceId: "ws_1",
      memberId: "member_1",
      target: { dmMemberId: "member_2" },
    })

    expect(findOrCreateDmSpy).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      memberOneId: "member_1",
      memberTwoId: "member_2",
    })
    expect(isMemberSpy).not.toHaveBeenCalled()
    expect(resolved).toBe(dmStream)
  })

  test("should throw 403 when stream is archived", async () => {
    spyOn(service, "getStreamById").mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_1",
      type: "scratchpad",
      archivedAt: new Date(),
    } as never)

    const error = await service
      .resolveWritableMessageStream({
        workspaceId: "ws_1",
        memberId: "member_1",
        target: { streamId: "stream_1" },
      })
      .catch((e) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(403)
    expect((error as HttpError).message).toBe("Cannot send messages to an archived stream")
  })

  test("should throw 403 when member cannot write to stream", async () => {
    spyOn(service, "getStreamById").mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_1",
      type: "scratchpad",
      archivedAt: null,
    } as never)
    spyOn(service, "isMember").mockResolvedValue(false)

    const error = await service
      .resolveWritableMessageStream({
        workspaceId: "ws_1",
        memberId: "member_1",
        target: { streamId: "stream_1" },
      })
      .catch((e) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(403)
    expect((error as HttpError).message).toBe("Not a member of this stream")
  })
})

describe("StreamService.findOrCreateDm", () => {
  let service: StreamService

  beforeEach(() => {
    service = new StreamService({} as never)
    mockFindMembersByIds.mockReset()
    mockInsertOrFindByUniquenessKey.mockReset()
    mockInsertManyMembers.mockReset().mockResolvedValue([] as never)
    mockInsertOutbox.mockReset().mockResolvedValue({
      id: 1n,
      eventType: "stream:created",
      payload: {},
      createdAt: new Date(),
    } as never)
  })

  test("should create or find dm by canonical uniqueness key without pre-read", async () => {
    const stream = {
      id: "stream_dm_1",
      workspaceId: "ws_1",
      type: "dm",
      visibility: "private",
    } as never

    mockFindMembersByIds.mockResolvedValue([
      { id: "member_1", workspaceId: "ws_1" },
      { id: "member_2", workspaceId: "ws_1" },
    ] as never)
    mockInsertOrFindByUniquenessKey.mockResolvedValue({ stream, created: true } as never)

    const result = await service.findOrCreateDm({
      workspaceId: "ws_1",
      memberOneId: "member_2",
      memberTwoId: "member_1",
    })

    expect(mockInsertOrFindByUniquenessKey).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        workspaceId: "ws_1",
        type: "dm",
        uniquenessKey: "dm:member_1:member_2",
        createdBy: "member_2",
      })
    )
    expect(mockInsertManyMembers).toHaveBeenCalledWith({}, "stream_dm_1", ["member_1", "member_2"])
    expect(mockInsertOutbox).toHaveBeenCalledWith(
      {},
      "stream:created",
      expect.objectContaining({
        workspaceId: "ws_1",
        streamId: "stream_dm_1",
        dmMemberIds: ["member_1", "member_2"],
      })
    )
    expect(result).toBe(stream)
  })

  test("should not emit stream created event when dm already exists", async () => {
    const stream = {
      id: "stream_dm_1",
      workspaceId: "ws_1",
      type: "dm",
      visibility: "private",
    } as never

    mockFindMembersByIds.mockResolvedValue([
      { id: "member_1", workspaceId: "ws_1" },
      { id: "member_2", workspaceId: "ws_1" },
    ] as never)
    mockInsertOrFindByUniquenessKey.mockResolvedValue({ stream, created: false } as never)

    await service.findOrCreateDm({
      workspaceId: "ws_1",
      memberOneId: "member_1",
      memberTwoId: "member_2",
    })

    expect(mockInsertOutbox).not.toHaveBeenCalled()
  })

  test("should throw when either member is outside the workspace", async () => {
    mockFindMembersByIds.mockResolvedValue([{ id: "member_1", workspaceId: "ws_1" }] as never)

    const error = await service
      .findOrCreateDm({
        workspaceId: "ws_1",
        memberOneId: "member_1",
        memberTwoId: "member_2",
      })
      .catch((e) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(404)
    expect((error as HttpError).message).toBe("Both members must belong to this workspace")
  })
})
