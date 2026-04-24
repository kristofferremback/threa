import { afterEach, describe, expect, it, mock } from "bun:test"
import { crossesPrivacyBoundary, type IsAncestorStream, type SharingStream } from "./access-check"

afterEach(() => {
  mock.restore()
})

function findStreamFrom(streams: Record<string, Partial<SharingStream>>) {
  return async (_db: unknown, id: string) => (streams[id] ? ({ id, ...streams[id] } as SharingStream) : null)
}

function isAncestorReturning(value: boolean): IsAncestorStream {
  return async () => value
}

describe("crossesPrivacyBoundary", () => {
  it("never triggers when source and target are the same stream", async () => {
    const result = await crossesPrivacyBoundary(
      {} as any,
      findStreamFrom({}),
      isAncestorReturning(false),
      "stream_a",
      "stream_a"
    )
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
  })

  it("never triggers when the target is an ancestor of the source (share-to-parent)", async () => {
    const db = { query: mock(() => ({ rows: [{ count: "5" }] })) } as any
    const result = await crossesPrivacyBoundary(
      db,
      findStreamFrom({}),
      isAncestorReturning(true),
      "stream_thread",
      "stream_parent"
    )
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it("never triggers when the source is public", async () => {
    const find = findStreamFrom({ stream_src: { visibility: "public", workspaceId: "ws_1" } })
    const db = { query: mock(() => ({ rows: [] })) } as any
    const result = await crossesPrivacyBoundary(db, find, isAncestorReturning(false), "stream_src", "stream_target")
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it("triggers with the count of exposed users when target has outsiders", async () => {
    const find = findStreamFrom({ stream_src: { visibility: "private", workspaceId: "ws_1" } })
    const db = { query: mock(async () => ({ rows: [{ count: "3" }] })) } as any
    const result = await crossesPrivacyBoundary(db, find, isAncestorReturning(false), "stream_src", "stream_target")
    expect(result).toEqual({ triggered: true, exposedUserCount: 3 })
  })

  it("does not trigger when target membership is a subset of source membership", async () => {
    const find = findStreamFrom({ stream_src: { visibility: "private", workspaceId: "ws_1" } })
    const db = { query: mock(async () => ({ rows: [{ count: "0" }] })) } as any
    const result = await crossesPrivacyBoundary(db, find, isAncestorReturning(false), "stream_src", "stream_target")
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
  })

  it("delegates ancestor resolution to the injected callback with source/target args", async () => {
    const calls: Array<[string, string]> = []
    const isAncestor: IsAncestorStream = async (_db, ancestorId, streamId) => {
      calls.push([ancestorId, streamId])
      return false
    }
    const find = findStreamFrom({ stream_src: { visibility: "public", workspaceId: "ws_1" } })
    await crossesPrivacyBoundary({} as any, find, isAncestor, "stream_src", "stream_target")
    // Target is the candidate ancestor of source (share-to-parent detection).
    expect(calls).toEqual([["stream_target", "stream_src"]])
  })
})
