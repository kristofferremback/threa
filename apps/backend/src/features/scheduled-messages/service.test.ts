import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { PoolClient } from "pg"
import { CompanionModes, ScheduledMessageStatuses, StreamTypes, Visibilities } from "@threa/types"
import { ScheduledMessagesService } from "./service"
import { ScheduledMessagesRepository, type ScheduledMessage } from "./repository"
import { StreamRepository, StreamMemberRepository } from "../streams"
import { MessageRepository } from "../messaging"
import type { EventService } from "../messaging"
import { OutboxRepository } from "../../lib/outbox"
import { QueueRepository } from "../../lib/queue"
import * as dbModule from "../../db"
import type { Stream } from "../streams"

const WORKSPACE_ID = "ws_1"
const USER_ID = "usr_1"
const STREAM_ID = "stream_1"
const SCHEDULED_ID = "sched_01"
const NOW = new Date("2026-05-03T12:00:00.000Z")
const FUTURE = new Date("2099-01-01T00:00:00.000Z")

function fakeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: STREAM_ID,
    workspaceId: WORKSPACE_ID,
    type: StreamTypes.CHANNEL,
    displayName: "General",
    slug: "general",
    description: null,
    visibility: Visibilities.PUBLIC,
    parentStreamId: null,
    parentMessageId: null,
    rootStreamId: null,
    companionMode: CompanionModes.OFF,
    companionPersonaId: null,
    createdBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    displayNameGeneratedAt: null,
    ...overrides,
  }
}

function fakeScheduled(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    id: SCHEDULED_ID,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    streamId: STREAM_ID,
    parentMessageId: null,
    contentJson: { type: "doc", content: [] },
    contentMarkdown: "hello",
    attachmentIds: [],
    metadata: null,
    scheduledFor: FUTURE,
    status: ScheduledMessageStatuses.PENDING,
    sentMessageId: null,
    lastError: null,
    queueMessageId: null,
    editLockOwnerId: null,
    editLockExpiresAt: null,
    clientMessageId: null,
    retryCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    statusChangedAt: NOW,
    ...overrides,
  }
}

const fakeEventService = (override: Partial<EventService> = {}): EventService =>
  ({
    createMessage: mock(async () => ({
      id: "msg_42",
      streamId: STREAM_ID,
      sequence: 1n,
      authorId: USER_ID,
      authorType: "user" as const,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "hello",
      replyCount: 0,
      clientMessageId: null,
      sentVia: null,
      reactions: {},
      metadata: {},
      editedAt: null,
      deletedAt: null,
      createdAt: NOW,
    })),
    ...override,
  }) as unknown as EventService

function setupService(eventService: EventService = fakeEventService()) {
  spyOn(dbModule, "withTransaction").mockImplementation(async (_pool: any, fn: any) => fn({} as PoolClient))
  return new ScheduledMessagesService({ pool: {} as any, eventService })
}

describe("ScheduledMessagesService.schedule", () => {
  afterEach(() => mock.restore())

  it("rejects when the stream isn't in the caller's workspace (workspace-scope guard)", async () => {
    const service = setupService()
    spyOn(StreamRepository, "findById").mockResolvedValue(fakeStream({ workspaceId: "ws_other" }))

    await expect(
      service.schedule({
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        streamId: STREAM_ID,
        parentMessageId: null,
        contentJson: { type: "doc", content: [] },
        contentMarkdown: "x",
        attachmentIds: [],
        metadata: null,
        scheduledFor: FUTURE,
        clientMessageId: null,
      })
    ).rejects.toThrow(/not found/i)
  })

  it("requires stream membership for private streams", async () => {
    const service = setupService()
    spyOn(StreamRepository, "findById").mockResolvedValue(fakeStream({ visibility: Visibilities.PRIVATE }))
    spyOn(StreamMemberRepository, "isMember").mockResolvedValue(false)

    await expect(
      service.schedule({
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        streamId: STREAM_ID,
        parentMessageId: null,
        contentJson: { type: "doc", content: [] },
        contentMarkdown: "x",
        attachmentIds: [],
        metadata: null,
        scheduledFor: FUTURE,
        clientMessageId: null,
      })
    ).rejects.toThrow(/member/i)
  })

  it("returns the existing row when the same clientMessageId was already scheduled (idempotent)", async () => {
    const service = setupService()
    spyOn(StreamRepository, "findById").mockResolvedValue(fakeStream())
    const existing = fakeScheduled({ clientMessageId: "cli_1" })
    spyOn(ScheduledMessagesRepository, "findByClientMessageId").mockResolvedValue(existing)
    const insertSpy = spyOn(ScheduledMessagesRepository, "insert").mockResolvedValue(existing)

    const result = await service.schedule({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      streamId: STREAM_ID,
      parentMessageId: null,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "x",
      attachmentIds: [],
      metadata: null,
      scheduledFor: FUTURE,
      clientMessageId: "cli_1",
    })

    expect(result.id).toBe(SCHEDULED_ID)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it("inserts the row, enqueues the fire job, and emits scheduled_message:upserted in the same tx", async () => {
    const service = setupService()
    spyOn(StreamRepository, "findById").mockResolvedValue(fakeStream())
    const inserted = fakeScheduled()
    spyOn(ScheduledMessagesRepository, "findByClientMessageId").mockResolvedValue(null)
    spyOn(ScheduledMessagesRepository, "insert").mockResolvedValue(inserted)
    spyOn(ScheduledMessagesRepository, "findById").mockResolvedValue(inserted)
    spyOn(ScheduledMessagesRepository, "setQueueMessageId").mockResolvedValue(undefined)
    const queueInsert = spyOn(QueueRepository, "insert").mockResolvedValue({} as any)
    const outboxInsert = spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

    await service.schedule({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      streamId: STREAM_ID,
      parentMessageId: null,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "hello",
      attachmentIds: [],
      metadata: null,
      scheduledFor: FUTURE,
      clientMessageId: null,
    })

    expect(queueInsert).toHaveBeenCalledTimes(1)
    expect(outboxInsert).toHaveBeenCalledWith(expect.anything(), "scheduled_message:upserted", expect.any(Object))
  })
})

describe("ScheduledMessagesService.claim", () => {
  afterEach(() => mock.restore())

  it("rejects when the row is already in flight (status != pending)", async () => {
    const service = setupService()
    spyOn(ScheduledMessagesRepository, "findById").mockResolvedValue(
      fakeScheduled({ status: ScheduledMessageStatuses.SENDING })
    )

    await expect(service.claim({ workspaceId: WORKSPACE_ID, userId: USER_ID, id: SCHEDULED_ID })).rejects.toThrow(
      /already/i
    )
  })

  it("returns sync=true when scheduled_for is within the threshold (server-side hint)", async () => {
    const service = setupService()
    const soon = new Date(Date.now() + 5_000) // 5s out → sync threshold = 30s
    const row = fakeScheduled({ scheduledFor: soon })
    spyOn(ScheduledMessagesRepository, "findById").mockResolvedValue(row)
    spyOn(ScheduledMessagesRepository, "tryAcquireLock").mockResolvedValue({
      ...row,
      editLockOwnerId: "usr:usr_1:sess_1",
      editLockExpiresAt: new Date(Date.now() + 60_000),
    })
    spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

    const result = await service.claim({ workspaceId: WORKSPACE_ID, userId: USER_ID, id: SCHEDULED_ID })
    expect(result.sync).toBe(true)
  })

  it("returns sync=false when scheduled_for is beyond the threshold (async path)", async () => {
    const service = setupService()
    const farFuture = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes out
    const row = fakeScheduled({ scheduledFor: farFuture })
    spyOn(ScheduledMessagesRepository, "findById").mockResolvedValue(row)
    spyOn(ScheduledMessagesRepository, "tryAcquireLock").mockResolvedValue({
      ...row,
      editLockOwnerId: "usr:usr_1:sess_1",
      editLockExpiresAt: new Date(Date.now() + 60_000),
    })
    spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

    const result = await service.claim({ workspaceId: WORKSPACE_ID, userId: USER_ID, id: SCHEDULED_ID })
    expect(result.sync).toBe(false)
  })

  it("throws SCHEDULED_MESSAGE_LOCK_HELD when the CAS returns null (another tab holds the lock)", async () => {
    const service = setupService()
    spyOn(ScheduledMessagesRepository, "findById").mockResolvedValue(fakeScheduled())
    spyOn(ScheduledMessagesRepository, "tryAcquireLock").mockResolvedValue(null)

    await expect(service.claim({ workspaceId: WORKSPACE_ID, userId: USER_ID, id: SCHEDULED_ID })).rejects.toThrow(
      /lock/i
    )
  })
})

describe("ScheduledMessagesService.cancel", () => {
  afterEach(() => mock.restore())

  it("cancels the queue row in the same tx as the status flip (worker can never fire a cancelled row)", async () => {
    const service = setupService()
    const row = fakeScheduled({ queueMessageId: "schedq_1" })
    spyOn(ScheduledMessagesRepository, "findById").mockResolvedValue(row)
    spyOn(ScheduledMessagesRepository, "cancel").mockResolvedValue({
      ...row,
      status: ScheduledMessageStatuses.CANCELLED,
    })
    const queueCancel = spyOn(QueueRepository, "cancelById").mockResolvedValue(true)
    const outboxInsert = spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

    await service.cancel({ workspaceId: WORKSPACE_ID, userId: USER_ID, id: SCHEDULED_ID })

    expect(queueCancel).toHaveBeenCalledWith(expect.anything(), "schedq_1")
    expect(outboxInsert).toHaveBeenCalledWith(expect.anything(), "scheduled_message:cancelled", expect.any(Object))
  })

  it("rejects with 409 ALREADY_SENDING when the row has already moved out of pending", async () => {
    const service = setupService()
    spyOn(ScheduledMessagesRepository, "findById").mockResolvedValue(
      fakeScheduled({ status: ScheduledMessageStatuses.SENDING })
    )

    await expect(service.cancel({ workspaceId: WORKSPACE_ID, userId: USER_ID, id: SCHEDULED_ID })).rejects.toThrow(
      /cannot cancel/i
    )
  })
})

describe("ScheduledMessagesService.fire (worker entry)", () => {
  afterEach(() => mock.restore())

  it("does nothing when the row is missing", async () => {
    const service = setupService()
    spyOn(ScheduledMessagesRepository, "findByIdScoped").mockResolvedValue(null)

    const result = await service.fire({ workspaceId: WORKSPACE_ID, scheduledMessageId: SCHEDULED_ID })
    expect(result).toEqual({ fired: false, reschedule: false })
  })

  it("does nothing when the row is no longer pending (cancelled/sent race)", async () => {
    const service = setupService()
    spyOn(ScheduledMessagesRepository, "findByIdScoped").mockResolvedValue(
      fakeScheduled({ status: ScheduledMessageStatuses.CANCELLED })
    )

    const result = await service.fire({ workspaceId: WORKSPACE_ID, scheduledMessageId: SCHEDULED_ID })
    expect(result).toEqual({ fired: false, reschedule: false })
  })

  it("requests a reschedule when the editor holds the lock and the retry budget isn't exhausted", async () => {
    const service = setupService()
    spyOn(ScheduledMessagesRepository, "findByIdScoped").mockResolvedValue(fakeScheduled())
    spyOn(ScheduledMessagesRepository, "tryAcquireLock").mockResolvedValue(null)
    spyOn(ScheduledMessagesRepository, "incrementRetryCount").mockResolvedValue(1)

    const result = await service.fire({ workspaceId: WORKSPACE_ID, scheduledMessageId: SCHEDULED_ID })
    expect(result).toEqual({ fired: false, reschedule: true })
  })

  it("marks the row failed when retry budget is exhausted", async () => {
    const service = setupService()
    const row = fakeScheduled()
    spyOn(ScheduledMessagesRepository, "findByIdScoped")
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({
        ...row,
        status: ScheduledMessageStatuses.FAILED,
        lastError: "lock_contention_timeout",
      })
    spyOn(ScheduledMessagesRepository, "tryAcquireLock").mockResolvedValue(null)
    spyOn(ScheduledMessagesRepository, "incrementRetryCount").mockResolvedValue(99)
    const markFailed = spyOn(ScheduledMessagesRepository, "markFailed").mockResolvedValue({
      ...row,
      status: ScheduledMessageStatuses.FAILED,
      lastError: "lock_contention_timeout",
    })
    spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

    const result = await service.fire({ workspaceId: WORKSPACE_ID, scheduledMessageId: SCHEDULED_ID })
    expect(result).toEqual({ fired: false, reschedule: false })
    expect(markFailed).toHaveBeenCalled()
  })

  it("calls EventService.createMessage and marks sent on a successful CAS (full happy path)", async () => {
    const createMessage = mock(async () => ({
      id: "msg_42",
      streamId: STREAM_ID,
      sequence: 1n,
      authorId: USER_ID,
      authorType: "user" as const,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "hello",
      replyCount: 0,
      clientMessageId: null,
      sentVia: null,
      reactions: {},
      metadata: {},
      editedAt: null,
      deletedAt: null,
      createdAt: NOW,
    }))
    const service = setupService({ createMessage } as unknown as EventService)
    const row = fakeScheduled()
    spyOn(ScheduledMessagesRepository, "findByIdScoped").mockResolvedValue(row)
    spyOn(ScheduledMessagesRepository, "tryAcquireLock").mockResolvedValue({
      ...row,
      status: ScheduledMessageStatuses.SENDING,
    })
    spyOn(ScheduledMessagesRepository, "markSent").mockResolvedValue({
      ...row,
      status: ScheduledMessageStatuses.SENT,
      sentMessageId: "msg_42",
    })
    const outboxInsert = spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

    const result = await service.fire({ workspaceId: WORKSPACE_ID, scheduledMessageId: SCHEDULED_ID })

    expect(result).toEqual({ fired: true, reschedule: false })
    expect(createMessage).toHaveBeenCalledTimes(1)
    // The clientMessageId we pass to createMessage uses the scheduled-row id so
    // an interrupted finalize (process restart between createMessage and
    // markSent) doesn't double-send when the worker re-runs.
    const call = (createMessage as any).mock.calls[0][0]
    expect(call.clientMessageId).toBe(`scheduled:${SCHEDULED_ID}`)
    expect(outboxInsert).toHaveBeenCalledWith(expect.anything(), "scheduled_message:sent", expect.any(Object))
  })
})
