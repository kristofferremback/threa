import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { OutboxRepository } from "../../lib/outbox"
import * as cursorLockModule from "../../lib/cursor-lock"
import * as dbModule from "../../db"
import { ActivityFeedHandler } from "./outbox-handler"
import type { ActivityService } from "./service"
import type { ProcessResult } from "../../lib/cursor-lock"
import { AuthorTypes } from "@threa/types"

function makeFakeCursorLock(onRun?: (result: ProcessResult) => void) {
  return () => ({
    run: mock(async (processor: (cursor: bigint, processedIds: bigint[]) => Promise<ProcessResult>) => {
      const result = await processor(0n, [])
      onRun?.(result)
    }),
  })
}

function mockCursorLock(onRun?: (result: ProcessResult) => void) {
  ;(spyOn(cursorLockModule, "CursorLock") as any).mockImplementation(makeFakeCursorLock(onRun))
}

function createHandler() {
  const activityService = {
    processMessageMentions: mock(async () => []),
    processMessageNotifications: mock(async () => []),
    listFeed: mock(async () => []),
    getUnreadCounts: mock(async () => ({ mentionsByStream: new Map(), totalByStream: new Map(), total: 0 })),
    markAsRead: mock(async () => {}),
    markStreamActivityAsRead: mock(async () => {}),
    markAllAsRead: mock(async () => {}),
  } as unknown as ActivityService

  mockCursorLock()

  const handler = new ActivityFeedHandler({} as any, activityService)

  return { handler, activityService }
}

function makeMessageCreatedEvent(
  id: bigint,
  overrides?: {
    actorType?: string
    actorId?: string | null
    contentMarkdown?: string
    workspaceId?: string
    streamId?: string
    messageId?: string
  }
) {
  return {
    id,
    eventType: "message:created" as const,
    payload: {
      workspaceId: overrides?.workspaceId ?? "ws_test",
      streamId: overrides?.streamId ?? "stream_test",
      event: {
        id: "event_1",
        sequence: "1",
        actorType: overrides?.actorType ?? AuthorTypes.MEMBER,
        actorId: "actorId" in (overrides ?? {}) ? overrides!.actorId : "member_author",
        payload: {
          messageId: overrides?.messageId ?? "msg_test",
          contentMarkdown: overrides?.contentMarkdown ?? "hello @alice check this",
        },
      },
    },
    createdAt: new Date(),
  }
}

describe("ActivityFeedHandler", () => {
  afterEach(() => {
    mock.restore()
  })

  it("should call processMessageMentions for message:created events from members", async () => {
    const event = makeMessageCreatedEvent(1n, {
      contentMarkdown: "hey @alice look at this",
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event] as any)

    const { handler, activityService } = createHandler()
    handler.handle()

    await new Promise((r) => setTimeout(r, 300))

    expect(activityService.processMessageMentions).toHaveBeenCalledWith({
      workspaceId: "ws_test",
      streamId: "stream_test",
      messageId: "msg_test",
      actorId: "member_author",
      actorType: "member",
      contentMarkdown: "hey @alice look at this",
    })
  })

  it("should process persona messages for mentions and notifications", async () => {
    const event = makeMessageCreatedEvent(1n, {
      actorType: "persona",
      actorId: "persona_agent1",
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event] as any)

    const { handler, activityService } = createHandler()
    handler.handle()

    await new Promise((r) => setTimeout(r, 300))

    expect(activityService.processMessageMentions).toHaveBeenCalled()
  })

  it("should skip system-authored messages", async () => {
    const event = makeMessageCreatedEvent(1n, {
      actorType: "system",
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event] as any)

    const { handler, activityService } = createHandler()
    handler.handle()

    await new Promise((r) => setTimeout(r, 300))

    expect(activityService.processMessageMentions).not.toHaveBeenCalled()
  })

  it("should skip events with no actorId", async () => {
    const event = makeMessageCreatedEvent(1n, {
      actorId: null,
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event] as any)

    const { handler, activityService } = createHandler()
    handler.handle()

    await new Promise((r) => setTimeout(r, 300))

    expect(activityService.processMessageMentions).not.toHaveBeenCalled()
  })

  it("should skip non-message:created events", async () => {
    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([
      { id: 1n, eventType: "stream:created", payload: {}, createdAt: new Date() },
      { id: 2n, eventType: "reaction:added", payload: {}, createdAt: new Date() },
    ] as any)

    const { handler, activityService } = createHandler()
    handler.handle()

    await new Promise((r) => setTimeout(r, 300))

    expect(activityService.processMessageMentions).not.toHaveBeenCalled()
  })

  it("should publish activity:created outbox events for each created activity", async () => {
    const createdActivity = {
      id: "activity_test123",
      workspaceId: "ws_test",
      memberId: "member_alice",
      activityType: "mention",
      streamId: "stream_test",
      messageId: "msg_test",
      actorId: "member_author",
      actorType: "member",
      context: { contentPreview: "hey @alice" },
      readAt: null,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    }

    const event = makeMessageCreatedEvent(1n)

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event] as any)
    const insertSpy = spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

    // Mock withTransaction to just call the callback directly
    spyOn(dbModule, "withTransaction").mockImplementation(async (_pool, callback) => {
      return callback({} as any)
    })

    const { handler, activityService } = createHandler()
    ;(activityService.processMessageMentions as any).mockResolvedValue([createdActivity])

    handler.handle()

    await new Promise((r) => setTimeout(r, 300))

    expect(insertSpy).toHaveBeenCalledWith({}, "activity:created", {
      workspaceId: "ws_test",
      targetMemberId: "member_alice",
      activity: {
        id: "activity_test123",
        activityType: "mention",
        streamId: "stream_test",
        messageId: "msg_test",
        actorId: "member_author",
        actorType: "member",
        context: { contentPreview: "hey @alice" },
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    })
  })

  it("should return no_events when batch is empty", async () => {
    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([])

    let result: ProcessResult | undefined
    mockCursorLock((r) => {
      result = r
    })

    const activityService = {
      processMessageMentions: mock(async () => []),
      processMessageNotifications: mock(async () => []),
    } as unknown as ActivityService
    const handler = new ActivityFeedHandler({} as any, activityService)
    handler.handle()

    await new Promise((r) => setTimeout(r, 300))

    expect(result).toEqual({ status: "no_events" })
  })

  it("should publish outbox events on retry when activities already exist", async () => {
    // Simulates retry: insertBatch returns pre-existing rows via ON CONFLICT DO UPDATE
    const preExistingActivity = {
      id: "activity_existing",
      workspaceId: "ws_test",
      memberId: "member_bob",
      activityType: "mention",
      streamId: "stream_test",
      messageId: "msg_test",
      actorId: "member_author",
      actorType: "member",
      context: { contentPreview: "hey @bob" },
      readAt: null,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    }

    const event = makeMessageCreatedEvent(1n, {
      contentMarkdown: "hey @bob check this",
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event] as any)
    const insertSpy = spyOn(OutboxRepository, "insert").mockResolvedValue({} as any)

    spyOn(dbModule, "withTransaction").mockImplementation(async (_pool, callback) => {
      return callback({} as any)
    })

    const { handler, activityService } = createHandler()
    ;(activityService.processMessageMentions as any).mockResolvedValue([preExistingActivity])

    handler.handle()

    await new Promise((r) => setTimeout(r, 300))

    const want = {
      workspaceId: "ws_test",
      targetMemberId: "member_bob",
      activity: {
        id: "activity_existing",
        activityType: "mention",
        streamId: "stream_test",
        messageId: "msg_test",
        actorId: "member_author",
        actorType: "member",
        context: { contentPreview: "hey @bob" },
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    }
    expect(insertSpy).toHaveBeenCalledWith({}, "activity:created", want)
  })

  it("should advance cursor past all events including skipped ones", async () => {
    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([
      { id: 1n, eventType: "stream:created", payload: {}, createdAt: new Date() },
      { id: 2n, eventType: "reaction:added", payload: {}, createdAt: new Date() },
      makeMessageCreatedEvent(3n),
    ] as any)

    let result: ProcessResult | undefined
    mockCursorLock((r) => {
      result = r
    })

    const activityService = {
      processMessageMentions: mock(async () => []),
      processMessageNotifications: mock(async () => []),
    } as unknown as ActivityService
    const handler = new ActivityFeedHandler({} as any, activityService)
    handler.handle()

    await new Promise((r) => setTimeout(r, 300))

    expect(result).toEqual({ status: "processed", processedIds: [1n, 2n, 3n] })
  })
})
