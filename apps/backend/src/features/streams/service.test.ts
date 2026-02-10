import { describe, test, expect, mock, beforeEach } from "bun:test"
import { StreamService } from "./service"
import { HttpError } from "../../lib/errors"

const mockFindById = mock(() => Promise.resolve(null as Record<string, unknown> | null))
const mockInsertMember = mock(() =>
  Promise.resolve({
    streamId: "stream_1",
    memberId: "member_1",
    pinned: false,
    pinnedAt: null,
    muted: false,
    lastReadEventId: null,
    lastReadAt: null,
    joinedAt: new Date(),
  })
)

const mockInsertEvent = mock(() =>
  Promise.resolve({
    id: "evt_1",
    streamId: "stream_1",
    sequence: 1n,
    eventType: "member_joined",
    payload: {},
    actorId: "member_1",
    actorType: "member",
    createdAt: new Date(),
  })
)

const mockInsertOutbox = mock(() =>
  Promise.resolve({ id: 1n, eventType: "stream:member_joined", payload: {}, createdAt: new Date() })
)

mock.module("./repository", () => ({
  StreamRepository: {
    findById: mockFindById,
  },
}))

mock.module("./member-repository", () => ({
  StreamMemberRepository: {
    insert: mockInsertMember,
  },
}))

mock.module("./event-repository", () => ({
  StreamEventRepository: {
    insert: mockInsertEvent,
  },
}))

mock.module("../../lib/outbox", () => ({
  OutboxRepository: {
    insert: mockInsertOutbox,
  },
}))

mock.module("../../lib/id", () => ({
  eventId: () => "evt_1",
  streamId: () => "stream_new",
}))

mock.module("../../db", () => ({
  withClient: (_pool: unknown, fn: (client: unknown) => Promise<unknown>) => fn({}),
  withTransaction: (_pool: unknown, fn: (client: unknown) => Promise<unknown>) => fn({}),
}))

describe("StreamService.joinPublicChannel", () => {
  let service: StreamService

  beforeEach(() => {
    mockFindById.mockReset()
    mockInsertMember.mockReset()
    mockInsertEvent.mockReset()
    mockInsertOutbox.mockReset()
    mockInsertMember.mockResolvedValue({
      streamId: "stream_1",
      memberId: "member_1",
      pinned: false,
      pinnedAt: null,
      muted: false,
      lastReadEventId: null,
      lastReadAt: null,
      joinedAt: new Date(),
    })
    mockInsertEvent.mockResolvedValue({
      id: "evt_1",
      streamId: "stream_1",
      sequence: 1n,
      eventType: "member_joined",
      payload: {},
      actorId: "member_1",
      actorType: "member",
      createdAt: new Date(),
    })
    mockInsertOutbox.mockResolvedValue({
      id: 1n,
      eventType: "stream:member_joined",
      payload: {},
      createdAt: new Date(),
    })
    service = new StreamService({} as never)
  })

  test("should return membership when joining a public channel", async () => {
    mockFindById.mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_1",
      type: "channel",
      visibility: "public",
    })

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
    })

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
    })

    await expect(service.joinPublicChannel("stream_1", "ws_1", "member_1")).rejects.toThrow("Stream not found")
  })

  test("should throw 403 when stream is not a channel", async () => {
    mockFindById.mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_1",
      type: "scratchpad",
      visibility: "public",
    })

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
    })

    const error = await service.joinPublicChannel("stream_1", "ws_1", "member_1").catch((e) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(403)
  })
})
