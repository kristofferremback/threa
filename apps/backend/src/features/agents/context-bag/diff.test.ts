import { describe, test, expect } from "bun:test"
import { diffInputs } from "./diff"
import type { LastRenderedSnapshot, SummaryInput } from "./types"

function input(messageId: string, contentFingerprint: string, opts: Partial<SummaryInput> = {}): SummaryInput {
  return {
    messageId,
    contentFingerprint,
    editedAt: null,
    deleted: false,
    ...opts,
  }
}

function snapshot(items: SummaryInput[]): LastRenderedSnapshot {
  return {
    renderedAt: "2026-04-22T09:00:00.000Z",
    items,
    tailMessageId: items[items.length - 1]?.messageId ?? null,
  }
}

describe("diffInputs", () => {
  test("returns empty diff when there's no previous snapshot", () => {
    const current = [input("msg_a", "sha256:a1")]
    const diff = diffInputs(current, null)
    expect(diff).toEqual({ appends: [], edits: [], deletes: [] })
  })

  test("reports newly-added messages as appends", () => {
    const previous = snapshot([input("msg_a", "sha256:a1")])
    const current = [input("msg_a", "sha256:a1"), input("msg_b", "sha256:b1")]
    const diff = diffInputs(current, previous)
    expect(diff.appends.map((a) => a.messageId)).toEqual(["msg_b"])
    expect(diff.edits).toEqual([])
    expect(diff.deletes).toEqual([])
  })

  test("reports content-changed messages as edits", () => {
    const previous = snapshot([input("msg_a", "sha256:a1")])
    const current = [input("msg_a", "sha256:a2", { editedAt: "2026-04-22T09:10:00Z" })]
    const diff = diffInputs(current, previous)
    expect(diff.appends).toEqual([])
    expect(diff.edits).toHaveLength(1)
    expect(diff.edits[0].current.contentFingerprint).toBe("sha256:a2")
    expect(diff.edits[0].previous.contentFingerprint).toBe("sha256:a1")
  })

  test("reports previously-present messages that are missing as deletes", () => {
    const previous = snapshot([input("msg_a", "sha256:a1"), input("msg_b", "sha256:b1")])
    const current = [input("msg_a", "sha256:a1")]
    const diff = diffInputs(current, previous)
    expect(diff.appends).toEqual([])
    expect(diff.edits).toEqual([])
    expect(diff.deletes).toHaveLength(1)
    expect(diff.deletes[0].messageId).toBe("msg_b")
    expect(diff.deletes[0].deleted).toBe(true)
  })

  test("is a stable no-op when inputs match the snapshot exactly", () => {
    const items = [input("msg_a", "sha256:a1"), input("msg_b", "sha256:b1")]
    const diff = diffInputs(items, snapshot(items))
    expect(diff.appends).toEqual([])
    expect(diff.edits).toEqual([])
    expect(diff.deletes).toEqual([])
  })

  test("surfaces all three categories simultaneously", () => {
    const previous = snapshot([input("msg_a", "sha256:a1"), input("msg_b", "sha256:b1"), input("msg_c", "sha256:c1")])
    const current = [input("msg_a", "sha256:a1"), input("msg_b", "sha256:b2"), input("msg_d", "sha256:d1")]
    const diff = diffInputs(current, previous)
    expect(diff.appends.map((a) => a.messageId)).toEqual(["msg_d"])
    expect(diff.edits.map((e) => e.current.messageId)).toEqual(["msg_b"])
    expect(diff.deletes.map((d) => d.messageId)).toEqual(["msg_c"])
  })
})
