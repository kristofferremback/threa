import { describe, test, expect } from "bun:test"
import { renderStable, renderDelta, buildSnapshot } from "./render"
import type { LastRenderedSnapshot, RenderableMessage, SummaryInput } from "./types"
import { diffInputs } from "./diff"

function item(overrides: Partial<RenderableMessage>): RenderableMessage {
  return {
    messageId: "msg_a",
    authorId: "usr_1",
    authorName: "Alice",
    contentMarkdown: "hello",
    createdAt: "2026-04-22T09:00:00Z",
    editedAt: null,
    sequence: 1n,
    ...overrides,
  }
}

function input(overrides: Partial<SummaryInput>): SummaryInput {
  return {
    messageId: "msg_a",
    contentFingerprint: "sha256:aaa",
    editedAt: null,
    deleted: false,
    ...overrides,
  }
}

describe("renderStable", () => {
  test("produces identical output across calls with the same inline items (cache-prefix stability)", () => {
    const items = [item({ messageId: "msg_a" }), item({ messageId: "msg_b", contentMarkdown: "second" })]
    const first = renderStable({ preamble: "p", inlineItems: items, refLabel: "thread:stream_x" })
    const second = renderStable({ preamble: "p", inlineItems: items, refLabel: "thread:stream_x" })
    expect(first).toBe(second)
  })

  test("rendering the same inline items again after an edit keeps the stable region byte-identical", () => {
    // First render: original content.
    const first = renderStable({
      preamble: "p",
      inlineItems: [item({ messageId: "msg_a", contentMarkdown: "first version" })],
      refLabel: "thread:stream_x",
    })
    // Later on the source message is edited — but the stable region is
    // supposed to keep rendering the SAME original inline content. Callers
    // must not re-render with the edited text in the stable region.
    const staleReRender = renderStable({
      preamble: "p",
      inlineItems: [item({ messageId: "msg_a", contentMarkdown: "first version" })],
      refLabel: "thread:stream_x",
    })
    expect(staleReRender).toBe(first)
  })

  test("picks the summary path when summaryText is provided", () => {
    const rendered = renderStable({
      preamble: "discuss",
      summaryText: "A short summary [msg_a].",
      refLabel: "thread:stream_x",
    })
    expect(rendered).toContain("A short summary [msg_a]")
    expect(rendered).not.toContain("Messages (chronological)")
  })
})

describe("renderDelta", () => {
  test("returns empty string when nothing drifted", () => {
    const prev: LastRenderedSnapshot = { renderedAt: "t0", items: [input({})], tailMessageId: "msg_a" }
    const diff = diffInputs([input({})], prev)
    const out = renderDelta({
      diff,
      currentByMessageId: new Map([["msg_a", item({})]]),
    })
    expect(out).toBe("")
  })

  test("lists appends, edits and deletes under distinct sections", () => {
    const prev: LastRenderedSnapshot = {
      renderedAt: "t0",
      items: [input({ messageId: "msg_a" }), input({ messageId: "msg_b", contentFingerprint: "sha256:b1" })],
      tailMessageId: "msg_b",
    }
    const currentInputs = [
      input({ messageId: "msg_a" }),
      input({ messageId: "msg_b", contentFingerprint: "sha256:b2", editedAt: "2026-04-22T09:10:00Z" }),
      input({ messageId: "msg_c", contentFingerprint: "sha256:c1" }),
    ]
    // msg_d was present in a different (non-prev) state; not tested here.
    const diff = diffInputs(currentInputs, prev)
    // Simulate a delete by removing msg_c from "current" vs a snapshot with it:
    const prevWithC: LastRenderedSnapshot = {
      ...prev,
      items: [...prev.items, input({ messageId: "msg_c", contentFingerprint: "sha256:c1" })],
    }
    const diff2 = diffInputs([input({ messageId: "msg_a" })], prevWithC)

    const combined = renderDelta({
      diff: {
        appends: diff.appends,
        edits: diff.edits,
        deletes: diff2.deletes,
      },
      currentByMessageId: new Map([
        ["msg_a", item({ messageId: "msg_a" })],
        ["msg_b", item({ messageId: "msg_b", contentMarkdown: "new body" })],
        ["msg_c", item({ messageId: "msg_c", contentMarkdown: "three" })],
      ]),
    })

    expect(combined).toContain("Appended messages")
    expect(combined).toContain("msg_c")
    expect(combined).toContain("Edited messages")
    expect(combined).toContain("msg_b")
    expect(combined).toContain("Deleted messages")
  })
})

describe("buildSnapshot", () => {
  test("captures inputs verbatim and derives tail from the trailing item", () => {
    const inputs = [input({ messageId: "msg_a" }), input({ messageId: "msg_b" })]
    const snap = buildSnapshot(inputs, "msg_b")
    expect(snap.items).toEqual(inputs)
    expect(snap.tailMessageId).toBe("msg_b")
    expect(snap.renderedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
  })
})
