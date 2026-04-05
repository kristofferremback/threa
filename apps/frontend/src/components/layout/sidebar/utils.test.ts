import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { StreamTypes, Visibilities, type StreamWithPreview } from "@threa/types"
import { categorizeStream } from "./utils"

function makeStream(overrides: Partial<StreamWithPreview> = {}): StreamWithPreview {
  return {
    id: "stream_1",
    workspaceId: "workspace_1",
    type: StreamTypes.DM,
    displayName: "Pierre",
    slug: null,
    description: null,
    visibility: Visibilities.PRIVATE,
    parentStreamId: null,
    parentMessageId: null,
    rootStreamId: null,
    companionMode: "off",
    companionPersonaId: null,
    createdBy: "user_1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
    lastMessagePreview: null,
    ...overrides,
  }
}

describe("categorizeStream", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("puts mentioned streams in 'important'", () => {
    expect(categorizeStream(makeStream(), 3, "mentions")).toBe("important")
  })

  it("puts AI activity with unread in 'important'", () => {
    expect(categorizeStream(makeStream(), 2, "ai")).toBe("important")
  })

  it("puts recently-active streams in 'recent'", () => {
    const stream = makeStream({
      lastMessagePreview: {
        authorId: "user_2",
        authorType: "user",
        content: "hello",
        createdAt: "2026-04-04T12:00:00Z", // 1 day ago
      },
    })
    expect(categorizeStream(stream, 0, "quiet")).toBe("recent")
  })

  it("puts old, inactive streams in 'other'", () => {
    const stream = makeStream({
      lastMessagePreview: {
        authorId: "user_2",
        authorType: "user",
        content: "hello",
        createdAt: "2026-03-01T12:00:00Z", // >7 days ago
      },
    })
    expect(categorizeStream(stream, 0, "quiet")).toBe("other")
  })

  it("keeps unread streams in 'recent' even when the cached preview is older than 7 days", () => {
    // Regression: an active DM should not sink into "Everything else" while
    // the user still has unread messages, even if the sidebar's cached
    // lastMessagePreview is momentarily stale.
    const stream = makeStream({
      lastMessagePreview: {
        authorId: "user_2",
        authorType: "user",
        content: "hello",
        createdAt: "2026-03-01T12:00:00Z", // >7 days ago
      },
    })
    expect(categorizeStream(stream, 3, "activity")).toBe("recent")
  })

  it("keeps unread streams in 'recent' even when there is no cached preview at all", () => {
    const stream = makeStream({ lastMessagePreview: null })
    expect(categorizeStream(stream, 1, "activity")).toBe("recent")
  })

  it("puts streams with no preview and no unread in 'other'", () => {
    const stream = makeStream({ lastMessagePreview: null })
    expect(categorizeStream(stream, 0, "quiet")).toBe("other")
  })
})
