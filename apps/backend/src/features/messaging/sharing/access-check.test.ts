import { afterEach, describe, expect, it, mock } from "bun:test"
import {
  crossesPrivacyBoundary,
  type CountExposedMembers,
  type IsAncestorStream,
  type ResolveEffectiveStream,
  type SharingStream,
} from "./access-check"

afterEach(() => {
  mock.restore()
})

/**
 * Builds matched `findStream` + `resolveEffective` callbacks from a single
 * map of stream rows. The resolver mirrors `streams/access.ts`'s
 * `resolveEffectiveAccessStream`: threads route through to the root, with
 * a dangling-root fallback to the input.
 */
function streamHelpers(streams: Record<string, Partial<SharingStream>>) {
  const findStream = async (_db: unknown, id: string) =>
    streams[id] ? ({ id, rootStreamId: null, ...streams[id] } as SharingStream) : null
  const resolveEffective: ResolveEffectiveStream = async (_db, source) => {
    if (!source.rootStreamId) return source
    const root = streams[source.rootStreamId]
    return root ? ({ id: source.rootStreamId, rootStreamId: null, ...root } as SharingStream) : source
  }
  return { findStream, resolveEffective }
}

function isAncestorReturning(value: boolean): IsAncestorStream {
  return async () => value
}

function countExposedReturning(value: number): CountExposedMembers {
  return async () => value
}

describe("crossesPrivacyBoundary", () => {
  it("never triggers when source and target are the same stream", async () => {
    const { findStream, resolveEffective } = streamHelpers({})
    const result = await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestorReturning(false),
      countExposedReturning(999),
      "stream_a",
      "stream_a"
    )
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
  })

  it("never triggers when the target is an ancestor of the source (share-to-parent)", async () => {
    const countExposed = mock(countExposedReturning(999))
    const { findStream, resolveEffective } = streamHelpers({})
    const result = await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestorReturning(true),
      countExposed,
      "stream_thread",
      "stream_parent"
    )
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
    expect(countExposed).not.toHaveBeenCalled()
  })

  it("never triggers when the source is public", async () => {
    const { findStream, resolveEffective } = streamHelpers({
      stream_src: { visibility: "public", workspaceId: "ws_1" },
    })
    const countExposed = mock(countExposedReturning(999))
    const result = await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestorReturning(false),
      countExposed,
      "stream_src",
      "stream_target"
    )
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
    expect(countExposed).not.toHaveBeenCalled()
  })

  it("triggers with the count of exposed users when target has outsiders", async () => {
    const { findStream, resolveEffective } = streamHelpers({
      stream_src: { visibility: "private", workspaceId: "ws_1" },
    })
    const result = await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestorReturning(false),
      countExposedReturning(3),
      "stream_src",
      "stream_target"
    )
    expect(result).toEqual({ triggered: true, exposedUserCount: 3 })
  })

  it("does not trigger when target membership is a subset of source membership", async () => {
    const { findStream, resolveEffective } = streamHelpers({
      stream_src: { visibility: "private", workspaceId: "ws_1" },
    })
    const result = await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestorReturning(false),
      countExposedReturning(0),
      "stream_src",
      "stream_target"
    )
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
  })

  it("delegates ancestor resolution to the injected callback with source/target args", async () => {
    const calls: Array<[string, string]> = []
    const isAncestor: IsAncestorStream = async (_db, ancestorId, streamId) => {
      calls.push([ancestorId, streamId])
      return false
    }
    const { findStream, resolveEffective } = streamHelpers({
      stream_src: { visibility: "public", workspaceId: "ws_1" },
    })
    await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestor,
      countExposedReturning(0),
      "stream_src",
      "stream_target"
    )
    // Target is the candidate ancestor of source (share-to-parent detection).
    expect(calls).toEqual([["stream_target", "stream_src"]])
  })

  it("passes target and source to countExposedMembers in that order", async () => {
    const calls: Array<[string, string]> = []
    const countExposed: CountExposedMembers = async (_db, targetStreamId, sourceStreamId) => {
      calls.push([targetStreamId, sourceStreamId])
      return 0
    }
    const { findStream, resolveEffective } = streamHelpers({
      stream_src: { visibility: "private", workspaceId: "ws_1" },
    })
    await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestorReturning(false),
      countExposed,
      "stream_src",
      "stream_target"
    )
    expect(calls).toEqual([["stream_target", "stream_src"]])
  })

  it("for thread sources, uses the root's visibility (not the thread row's stale value)", async () => {
    // Thread row stored visibility="public" at create time; root has since
    // been flipped to private. Without root resolution the boundary check
    // would short-circuit on source.visibility !== PRIVATE and silently
    // miss the leak. The injected resolver routes thread → root via the
    // canonical helper in streams/access.ts.
    const { findStream, resolveEffective } = streamHelpers({
      stream_thread: { visibility: "public", workspaceId: "ws_1", rootStreamId: "stream_root" },
      stream_root: { visibility: "private", workspaceId: "ws_1", rootStreamId: null },
    })
    const result = await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestorReturning(false),
      countExposedReturning(2),
      "stream_thread",
      "stream_target"
    )
    expect(result).toEqual({ triggered: true, exposedUserCount: 2 })
  })

  it("for thread sources, counts exposure against the root's members (not the thread's sparse member set)", async () => {
    const calls: Array<[string, string]> = []
    const countExposed: CountExposedMembers = async (_db, targetStreamId, sourceStreamId) => {
      calls.push([targetStreamId, sourceStreamId])
      return 1
    }
    const { findStream, resolveEffective } = streamHelpers({
      stream_thread: { visibility: "private", workspaceId: "ws_1", rootStreamId: "stream_root" },
      stream_root: { visibility: "private", workspaceId: "ws_1", rootStreamId: null },
    })
    await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestorReturning(false),
      countExposed,
      "stream_thread",
      "stream_target"
    )
    expect(calls).toEqual([["stream_target", "stream_root"]])
  })

  it("for a thread of a public root, does not trigger (root visibility wins)", async () => {
    // Inverse of the staleness case: thread's stored visibility happens to
    // be "private", but the root is public. The root is the source of
    // truth, so no boundary fires.
    const { findStream, resolveEffective } = streamHelpers({
      stream_thread: { visibility: "private", workspaceId: "ws_1", rootStreamId: "stream_root" },
      stream_root: { visibility: "public", workspaceId: "ws_1", rootStreamId: null },
    })
    const result = await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestorReturning(false),
      countExposedReturning(99),
      "stream_thread",
      "stream_target"
    )
    expect(result).toEqual({ triggered: false, exposedUserCount: 0 })
  })

  it("falls back to the source itself when the root row is missing", async () => {
    // Defensive: shared_messages and streams have no FKs, so a thread
    // pointing at a deleted root is possible. The resolver collapses back
    // to the source rather than crashing; the rest of the check plays out
    // against the thread row's own visibility.
    const { findStream, resolveEffective } = streamHelpers({
      stream_thread: { visibility: "private", workspaceId: "ws_1", rootStreamId: "stream_missing_root" },
    })
    const result = await crossesPrivacyBoundary(
      {} as any,
      findStream,
      resolveEffective,
      isAncestorReturning(false),
      countExposedReturning(2),
      "stream_thread",
      "stream_target"
    )
    expect(result).toEqual({ triggered: true, exposedUserCount: 2 })
  })
})
