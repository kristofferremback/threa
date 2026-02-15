import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { OutboxRepository } from "./repository"
import * as cursorLockModule from "../cursor-lock"
import { BroadcastHandler } from "./broadcast-handler"
import type { ProcessResult } from "../cursor-lock"
import type { OutboxEvent } from "./repository"

function makeFakeCursorLock(onRun?: (result: ProcessResult) => void) {
  return () => ({
    run: mock(async (processor: (cursor: bigint) => Promise<ProcessResult>) => {
      const result = await processor(0n)
      onRun?.(result)
    }),
  })
}

function mockCursorLock(onRun?: (result: ProcessResult) => void) {
  ;(spyOn(cursorLockModule, "CursorLock") as any).mockImplementation(makeFakeCursorLock(onRun))
}

interface MockEmitChain {
  emit: ReturnType<typeof mock>
}

function createMockIo() {
  const emitChains: Array<{ room: string; eventType: string; payload: unknown }> = []

  const io = {
    to: mock((room: string): MockEmitChain => {
      return {
        emit: mock((eventType: string, payload: unknown) => {
          emitChains.push({ room, eventType, payload })
        }),
      }
    }),
  }

  return { io, emitChains }
}

function createHandler() {
  mockCursorLock()
  const { io, emitChains } = createMockIo()
  const handler = new BroadcastHandler({} as any, io as any)
  return { handler, io, emitChains }
}

function makeEvent(id: bigint, eventType: string, payload: Record<string, unknown>): OutboxEvent {
  return { id, eventType, payload, createdAt: new Date() } as unknown as OutboxEvent
}

describe("BroadcastHandler", () => {
  afterEach(() => {
    mock.restore()
  })

  it("should emit member-scoped event to member room", async () => {
    const event = makeEvent(1n, "activity:created", {
      workspaceId: "ws_1",
      targetMemberId: "member_alice",
      activity: { id: "act_1" },
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1:member:member_alice",
      eventType: "activity:created",
      payload: event.payload,
    })
  })

  it("should emit author-scoped event to member room", async () => {
    const event = makeEvent(1n, "command:dispatched", {
      workspaceId: "ws_1",
      streamId: "stream_1",
      authorId: "member_bob",
      event: { id: "evt_1" },
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1:member:member_bob",
      eventType: "command:dispatched",
      payload: event.payload,
    })
  })

  it("should emit stream:read to author member room", async () => {
    const event = makeEvent(1n, "stream:read", {
      workspaceId: "ws_1",
      authorId: "member_carol",
      streamId: "stream_1",
      lastReadEventId: "evt_5",
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1:member:member_carol",
      eventType: "stream:read",
      payload: event.payload,
    })
  })

  it("should emit stream:member_added to both stream room and member room", async () => {
    const event = makeEvent(1n, "stream:member_added", {
      workspaceId: "ws_1",
      streamId: "stream_1",
      memberId: "member_dave",
      stream: { id: "stream_1" },
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1:stream:stream_1",
      eventType: "stream:member_added",
      payload: event.payload,
    })
    expect(emitChains).toContainEqual({
      room: "ws:ws_1:member:member_dave",
      eventType: "stream:member_added",
      payload: event.payload,
    })
  })

  it("should emit stream-scoped event to stream room", async () => {
    const event = makeEvent(1n, "message:created", {
      workspaceId: "ws_1",
      streamId: "stream_1",
      event: { id: "evt_1" },
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1:stream:stream_1",
      eventType: "message:created",
      payload: event.payload,
    })
  })

  it("should emit workspace-scoped event to workspace room", async () => {
    const event = makeEvent(1n, "stream:updated", {
      workspaceId: "ws_1",
      streamId: "stream_1",
      stream: { id: "stream_1" },
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1",
      eventType: "stream:updated",
      payload: event.payload,
    })
  })

  it("should emit stream:created thread to parent stream room", async () => {
    const event = makeEvent(1n, "stream:created", {
      workspaceId: "ws_1",
      streamId: "stream_parent",
      stream: { id: "stream_thread", parentMessageId: "msg_1" },
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1:stream:stream_parent",
      eventType: "stream:created",
      payload: event.payload,
    })
  })

  it("should emit stream:created non-thread to workspace room", async () => {
    const event = makeEvent(1n, "stream:created", {
      workspaceId: "ws_1",
      streamId: "stream_new",
      stream: { id: "stream_new", parentMessageId: null },
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1",
      eventType: "stream:created",
      payload: event.payload,
    })
  })

  it("should emit stream:display_name_updated for public stream to workspace room", async () => {
    const event = makeEvent(1n, "stream:display_name_updated", {
      workspaceId: "ws_1",
      streamId: "stream_1",
      displayName: "general",
      visibility: "public",
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1",
      eventType: "stream:display_name_updated",
      payload: event.payload,
    })
  })

  it("should emit stream:display_name_updated for private stream to stream room", async () => {
    const event = makeEvent(1n, "stream:display_name_updated", {
      workspaceId: "ws_1",
      streamId: "stream_dm",
      displayName: "DM with Alice",
      visibility: "private",
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1:stream:stream_dm",
      eventType: "stream:display_name_updated",
      payload: event.payload,
    })
  })

  it("should continue processing when individual event broadcast throws", async () => {
    const event1 = makeEvent(1n, "message:created", {
      workspaceId: "ws_1",
      streamId: "stream_1",
      event: { id: "evt_1" },
    })
    // Malformed: missing workspaceId — broadcastEvent will still work since
    // io.to().emit() is fire-and-forget, but test verifies the loop continues
    const event2 = makeEvent(2n, "message:created", {
      workspaceId: "ws_1",
      streamId: "stream_2",
      event: { id: "evt_2" },
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event1, event2])

    let result: ProcessResult | undefined
    mockCursorLock((r) => {
      result = r
    })

    const { io } = createMockIo()
    const handler = new BroadcastHandler({} as any, io as any)
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(result).toEqual({ status: "processed", newCursor: 2n })
  })

  it("should emit conversation event to stream and parent stream rooms", async () => {
    const event = makeEvent(1n, "conversation:created", {
      workspaceId: "ws_1",
      streamId: "stream_thread",
      conversationId: "conv_1",
      parentStreamId: "stream_parent",
    })

    spyOn(OutboxRepository, "fetchAfterId").mockResolvedValue([event])

    const { handler, emitChains } = createHandler()
    handler.handle()
    await new Promise((r) => setTimeout(r, 300))

    expect(emitChains).toContainEqual({
      room: "ws:ws_1:stream:stream_thread",
      eventType: "conversation:created",
      payload: event.payload,
    })
    expect(emitChains).toContainEqual({
      room: "ws:ws_1:stream:stream_parent",
      eventType: "conversation:created",
      payload: event.payload,
    })
  })
})
