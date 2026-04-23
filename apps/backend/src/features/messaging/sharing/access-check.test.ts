import { afterEach, describe, expect, it, mock } from "bun:test"
import { crossesPrivacyBoundary, isAncestorStream, type SharingStream } from "./access-check"

afterEach(() => {
  mock.restore()
})

function findStreamFrom(streams: Record<string, Partial<SharingStream>>) {
  return async (_db: unknown, id: string) => (streams[id] ? ({ id, ...streams[id] } as SharingStream) : null)
}

describe("isAncestorStream", () => {
  it("returns true when the candidate is the stream itself", async () => {
    expect(await isAncestorStream({} as any, findStreamFrom({}), "stream_a", "stream_a")).toBe(true)
  })

  it("returns true when the candidate is the direct parent", async () => {
    const find = findStreamFrom({ stream_thread: { parentStreamId: "stream_parent" } })
    expect(await isAncestorStream({} as any, find, "stream_parent", "stream_thread")).toBe(true)
  })

  it("returns true when the candidate is higher up in the chain", async () => {
    const find = findStreamFrom({
      stream_thread: { parentStreamId: "stream_mid" },
      stream_mid: { parentStreamId: "stream_top" },
    })
    expect(await isAncestorStream({} as any, find, "stream_top", "stream_thread")).toBe(true)
  })

  it("returns false for unrelated streams", async () => {
    const find = findStreamFrom({ stream_thread: { parentStreamId: null } })
    expect(await isAncestorStream({} as any, find, "stream_other", "stream_thread")).toBe(false)
  })
})

describe("crossesPrivacyBoundary", () => {
  it("never triggers when source and target are the same stream", async () => {
    const result = await crossesPrivacyBoundary({} as any, findStreamFrom({}), "stream_a", "stream_a")
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
  })

  it("never triggers when the target is an ancestor of the source (share-to-parent)", async () => {
    const find = findStreamFrom({ stream_thread: { parentStreamId: "stream_parent" } })
    const db = { query: mock(() => ({ rows: [{ count: "5" }] })) } as any
    const result = await crossesPrivacyBoundary(db, find, "stream_thread", "stream_parent")
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it("never triggers when the source is public", async () => {
    const find = findStreamFrom({ stream_src: { parentStreamId: null, visibility: "public", workspaceId: "ws_1" } })
    const db = { query: mock(() => ({ rows: [] })) } as any
    const result = await crossesPrivacyBoundary(db, find, "stream_src", "stream_target")
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it("triggers with the count of exposed users when target has outsiders", async () => {
    const find = findStreamFrom({ stream_src: { parentStreamId: null, visibility: "private", workspaceId: "ws_1" } })
    const db = { query: mock(async () => ({ rows: [{ count: "3" }] })) } as any
    const result = await crossesPrivacyBoundary(db, find, "stream_src", "stream_target")
    expect(result).toEqual({ triggered: true, exposedUserCount: 3 })
  })

  it("does not trigger when target membership is a subset of source membership", async () => {
    const find = findStreamFrom({ stream_src: { parentStreamId: null, visibility: "private", workspaceId: "ws_1" } })
    const db = { query: mock(async () => ({ rows: [{ count: "0" }] })) } as any
    const result = await crossesPrivacyBoundary(db, find, "stream_src", "stream_target")
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
  })
})
