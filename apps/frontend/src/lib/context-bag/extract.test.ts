import { describe, it, expect } from "vitest"
import type { JSONContent } from "@tiptap/core"
import { ContextIntents } from "@threa/types"
import {
  canSendContextBag,
  collectContextRefChips,
  extractContextBagFromContent,
  hasPendingContextRefs,
} from "./extract"

function doc(children: JSONContent[]): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: children }] }
}

function chip(overrides: Partial<JSONContent["attrs"]> & Record<string, unknown> = {}): JSONContent {
  return {
    type: "contextRefChip",
    attrs: {
      refKind: "thread",
      streamId: "stream_a",
      fromMessageId: null,
      toMessageId: null,
      label: "Thread A",
      status: "ready",
      fingerprint: "fp_a",
      errorMessage: null,
      ...overrides,
    },
  }
}

describe("collectContextRefChips", () => {
  it("returns an empty array for null/empty docs", () => {
    expect(collectContextRefChips(null)).toEqual([])
    expect(collectContextRefChips(undefined)).toEqual([])
    expect(collectContextRefChips({ type: "doc" })).toEqual([])
  })

  it("collects all chips in document order", () => {
    const result = collectContextRefChips(
      doc([chip({ streamId: "stream_a" }), { type: "text", text: " " }, chip({ streamId: "stream_b" })])
    )
    expect(result.map((c) => c.streamId)).toEqual(["stream_a", "stream_b"])
  })

  it("dedupes chips with the same identity tuple", () => {
    const result = collectContextRefChips(
      doc([chip({ streamId: "stream_a" }), { type: "text", text: " " }, chip({ streamId: "stream_a" })])
    )
    expect(result).toHaveLength(1)
  })

  it("treats chips with different anchors as distinct (same streamId, different fromMessageId)", () => {
    const result = collectContextRefChips(
      doc([
        chip({ streamId: "stream_a", fromMessageId: "msg_1" }),
        chip({ streamId: "stream_a", fromMessageId: "msg_2" }),
      ])
    )
    expect(result).toHaveLength(2)
  })

  it("walks nested content (blockquote, lists)", () => {
    const nested: JSONContent = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [chip({ streamId: "stream_nested" })] }],
        },
      ],
    }
    const result = collectContextRefChips(nested)
    expect(result[0]?.streamId).toBe("stream_nested")
  })
})

describe("extractContextBagFromContent", () => {
  it("returns null when the doc has no chips", () => {
    const result = extractContextBagFromContent(doc([{ type: "text", text: "hello" }]), ContextIntents.DISCUSS_THREAD)
    expect(result).toBeNull()
  })

  it("produces a ContextBag with the given intent and one ref per unique chip", () => {
    const result = extractContextBagFromContent(
      doc([chip({ streamId: "stream_a" }), chip({ streamId: "stream_b" })]),
      ContextIntents.DISCUSS_THREAD
    )
    expect(result).toEqual({
      intent: ContextIntents.DISCUSS_THREAD,
      refs: [
        { kind: "thread", streamId: "stream_a" },
        { kind: "thread", streamId: "stream_b" },
      ],
    })
  })

  it("carries through anchors when present", () => {
    const result = extractContextBagFromContent(
      doc([chip({ streamId: "stream_a", fromMessageId: "msg_1", toMessageId: "msg_5" })]),
      ContextIntents.DISCUSS_THREAD
    )
    expect(result?.refs[0]).toEqual({
      kind: "thread",
      streamId: "stream_a",
      fromMessageId: "msg_1",
      toMessageId: "msg_5",
    })
  })

  it("omits null anchors from the serialized ref (no fromMessageId: null on the wire)", () => {
    const result = extractContextBagFromContent(doc([chip({ streamId: "stream_a" })]), ContextIntents.DISCUSS_THREAD)
    expect(result?.refs[0]).toEqual({ kind: "thread", streamId: "stream_a" })
    expect(result?.refs[0]).not.toHaveProperty("fromMessageId")
    expect(result?.refs[0]).not.toHaveProperty("toMessageId")
  })
})

describe("canSendContextBag", () => {
  it("is true when there are no chips at all", () => {
    expect(canSendContextBag(doc([{ type: "text", text: "hi" }]))).toBe(true)
  })

  it("is true when every chip is ready or inline", () => {
    expect(canSendContextBag(doc([chip({ status: "ready" }), chip({ streamId: "stream_b", status: "inline" })]))).toBe(
      true
    )
  })

  it("is false when any chip is still pending", () => {
    expect(canSendContextBag(doc([chip({ status: "ready" }), chip({ streamId: "stream_b", status: "pending" })]))).toBe(
      false
    )
  })

  it("is false when any chip errored during precompute", () => {
    expect(canSendContextBag(doc([chip({ status: "error", errorMessage: "boom" })]))).toBe(false)
  })
})

describe("hasPendingContextRefs", () => {
  it("is true when at least one chip is pending", () => {
    expect(
      hasPendingContextRefs(doc([chip({ status: "ready" }), chip({ streamId: "stream_b", status: "pending" })]))
    ).toBe(true)
  })

  it("is false when no chips are pending (even if some errored)", () => {
    expect(
      hasPendingContextRefs(doc([chip({ status: "ready" }), chip({ streamId: "stream_b", status: "error" })]))
    ).toBe(false)
  })
})
