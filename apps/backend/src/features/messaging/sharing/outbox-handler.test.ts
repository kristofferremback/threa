import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { invalidatePointersForEvent, POINTER_INVALIDATED_EVENT } from "./outbox-handler"
import { SharedMessageRepository } from "./repository"

afterEach(() => {
  mock.restore()
})

function fakeIo() {
  const emits: Array<{ room: string; event: string; payload: unknown }> = []
  const io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emits.push({ room, event, payload })
        },
      }
    },
  }
  return { io: io as any, emits }
}

describe("invalidatePointersForEvent", () => {
  it("is a no-op for event types that don't affect pointer renders", async () => {
    const list = spyOn(SharedMessageRepository, "listBySourceMessageIds").mockResolvedValue([])
    const { io } = fakeIo()
    await invalidatePointersForEvent(
      { eventType: "stream:created", payload: { workspaceId: "ws_1" } } as any,
      {} as any,
      io
    )
    expect(list).not.toHaveBeenCalled()
  })

  it("is a no-op when no pointers reference the changed source", async () => {
    spyOn(SharedMessageRepository, "listBySourceMessageIds").mockResolvedValue([])
    const { io, emits } = fakeIo()
    await invalidatePointersForEvent(
      {
        eventType: "message:deleted",
        payload: { workspaceId: "ws_1", streamId: "stream_src", messageId: "msg_a" },
      } as any,
      {} as any,
      io
    )
    expect(emits).toEqual([])
  })

  it("emits pointer:invalidated once per distinct target stream when pointers exist", async () => {
    spyOn(SharedMessageRepository, "listBySourceMessageIds").mockResolvedValue([
      { targetStreamId: "stream_t1" },
      { targetStreamId: "stream_t2" },
      { targetStreamId: "stream_t1" }, // duplicate → deduped
    ] as any)
    const { io, emits } = fakeIo()
    await invalidatePointersForEvent(
      {
        eventType: "message:deleted",
        payload: { workspaceId: "ws_1", streamId: "stream_src", messageId: "msg_a" },
      } as any,
      {} as any,
      io
    )
    expect(emits.map((e) => e.room).sort()).toEqual(["ws:ws_1:stream:stream_t1", "ws:ws_1:stream:stream_t2"])
    expect(emits[0].event).toBe(POINTER_INVALIDATED_EVENT)
    expect(emits[0].payload).toMatchObject({
      workspaceId: "ws_1",
      sourceMessageId: "msg_a",
    })
  })

  it("reads the edited message id from the nested outbox payload for message:edited events", async () => {
    const list = spyOn(SharedMessageRepository, "listBySourceMessageIds").mockResolvedValue([])
    const { io } = fakeIo()
    await invalidatePointersForEvent(
      {
        eventType: "message:edited",
        payload: {
          workspaceId: "ws_1",
          streamId: "stream_src",
          event: { payload: { messageId: "msg_edited" } },
        },
      } as any,
      {} as any,
      io
    )
    expect(list).toHaveBeenCalledWith({}, ["msg_edited"])
  })
})
