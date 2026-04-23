import { afterEach, describe, expect, it, vi } from "vitest"
import {
  __resetShareHandoffStoreForTesting,
  consumeShareHandoff,
  peekShareHandoff,
  queueShareHandoff,
} from "./share-handoff-store"

const sampleAttrs = {
  messageId: "msg_1",
  streamId: "stream_src",
  authorName: "Alice",
  authorId: "usr_1",
  actorType: "user",
}

afterEach(() => {
  __resetShareHandoffStoreForTesting()
  vi.useRealTimers()
})

describe("share handoff store", () => {
  it("returns null when nothing is queued for the stream", () => {
    expect(consumeShareHandoff("stream_a")).toBeNull()
  })

  it("returns the queued attrs and clears the entry on consume", () => {
    queueShareHandoff("stream_a", sampleAttrs)
    expect(consumeShareHandoff("stream_a")).toEqual(sampleAttrs)
    expect(consumeShareHandoff("stream_a")).toBeNull()
  })

  it("queues independently per target stream", () => {
    queueShareHandoff("stream_a", { ...sampleAttrs, messageId: "msg_a" })
    queueShareHandoff("stream_b", { ...sampleAttrs, messageId: "msg_b" })
    expect(consumeShareHandoff("stream_a")?.messageId).toBe("msg_a")
    expect(consumeShareHandoff("stream_b")?.messageId).toBe("msg_b")
  })

  it("evicts entries whose TTL has expired", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-23T12:00:00Z"))
    queueShareHandoff("stream_a", sampleAttrs)

    vi.setSystemTime(new Date("2026-04-23T12:10:00Z")) // 10 minutes later, past 5m TTL
    expect(consumeShareHandoff("stream_a")).toBeNull()
  })

  it("peek does not clear the entry", () => {
    queueShareHandoff("stream_a", sampleAttrs)
    expect(peekShareHandoff("stream_a")).toEqual(sampleAttrs)
    expect(peekShareHandoff("stream_a")).toEqual(sampleAttrs)
    expect(consumeShareHandoff("stream_a")).toEqual(sampleAttrs)
    expect(peekShareHandoff("stream_a")).toBeNull()
  })
})
