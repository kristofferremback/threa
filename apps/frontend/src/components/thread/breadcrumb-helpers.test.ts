import { describe, test, expect } from "vitest"
import { getThreadDisplayName, getThreadRootContext, getStreamBreadcrumbName } from "./breadcrumb-helpers"

describe("getThreadDisplayName", () => {
  test("returns displayName when set", () => {
    expect(getThreadDisplayName({ displayName: "Fixing the auth bug", rootStreamId: "stream_123" })).toBe(
      "Fixing the auth bug"
    )
  })

  test("returns 'Thread' when displayName is null", () => {
    expect(getThreadDisplayName({ displayName: null, rootStreamId: "stream_123" })).toBe("Thread")
  })

  test("returns 'Thread' when displayName is undefined", () => {
    expect(getThreadDisplayName({ rootStreamId: "stream_123" })).toBe("Thread")
  })
})

describe("getThreadRootContext", () => {
  const allStreams = [
    { id: "stream_ch", type: "channel", displayName: "General", slug: "general" },
    { id: "stream_sp", type: "scratchpad", displayName: "My Notes", slug: null },
    { id: "stream_dm", type: "dm", displayName: "Alice, Bob", slug: null },
  ]

  test("returns '#slug' for channel root with slug", () => {
    expect(getThreadRootContext({ rootStreamId: "stream_ch" }, allStreams)).toBe("#general")
  })

  test("returns '#displayName' for channel root without slug", () => {
    const streams = [{ id: "stream_ch2", type: "channel", displayName: "No Slug", slug: null }]
    expect(getThreadRootContext({ rootStreamId: "stream_ch2" }, streams)).toBe("#No Slug")
  })

  test("falls back to '#channel' for channel root without slug or displayName", () => {
    const streams = [{ id: "stream_x", type: "channel", displayName: null, slug: null }]
    expect(getThreadRootContext({ rootStreamId: "stream_x" }, streams)).toBe("#channel")
  })

  test("returns displayName for scratchpad root", () => {
    expect(getThreadRootContext({ rootStreamId: "stream_sp" }, allStreams)).toBe("My Notes")
  })

  test("falls back to 'Scratchpad' for scratchpad root without displayName", () => {
    const streams = [{ id: "stream_x", type: "scratchpad", displayName: null }]
    expect(getThreadRootContext({ rootStreamId: "stream_x" }, streams)).toBe("Scratchpad")
  })

  test("returns displayName for dm root", () => {
    expect(getThreadRootContext({ rootStreamId: "stream_dm" }, allStreams)).toBe("Alice, Bob")
  })

  test("falls back to 'DM' for dm root without displayName", () => {
    const streams = [{ id: "stream_x", type: "dm", displayName: null }]
    expect(getThreadRootContext({ rootStreamId: "stream_x" }, streams)).toBe("DM")
  })

  test("returns null when rootStreamId is null", () => {
    expect(getThreadRootContext({ rootStreamId: null }, allStreams)).toBeNull()
  })

  test("returns null when root stream not found", () => {
    expect(getThreadRootContext({ rootStreamId: "stream_missing" }, allStreams)).toBeNull()
  })

  test("returns null for unknown stream type", () => {
    const streams = [{ id: "stream_x", type: "unknown", displayName: "Foo" }]
    expect(getThreadRootContext({ rootStreamId: "stream_x" }, streams)).toBeNull()
  })
})

describe("getStreamBreadcrumbName", () => {
  test("returns '#slug' for stream with slug", () => {
    expect(getStreamBreadcrumbName({ id: "1", type: "channel", displayName: "General", slug: "general" })).toBe(
      "#general"
    )
  })

  test("returns displayName for thread with displayName", () => {
    expect(getStreamBreadcrumbName({ id: "1", type: "thread", displayName: "Fix auth" })).toBe("Fix auth")
  })

  test("returns 'Thread' for thread without displayName", () => {
    expect(getStreamBreadcrumbName({ id: "1", type: "thread", displayName: null })).toBe("Thread")
  })

  test("returns displayName for non-thread, non-slug stream", () => {
    expect(getStreamBreadcrumbName({ id: "1", type: "scratchpad", displayName: "My Notes" })).toBe("My Notes")
  })

  test("returns '...' when no displayName and no slug", () => {
    expect(getStreamBreadcrumbName({ id: "1", type: "dm", displayName: null })).toBe("...")
  })

  test("prefers slug over displayName for non-thread streams", () => {
    expect(getStreamBreadcrumbName({ id: "1", type: "channel", displayName: "General Chat", slug: "general" })).toBe(
      "#general"
    )
  })
})
