import { describe, expect, test } from "bun:test"
import { ContextIntents, ContextRefKinds } from "@threa/types"
import { DiscussThreadIntent } from "./discuss-thread"
import { renderStable } from "../render"
import type { RenderableMessage } from "../types"

function msg(overrides: Partial<RenderableMessage>): RenderableMessage {
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

describe("DiscussThreadIntent config", () => {
  test("declares the intent and supported kinds expected by the registry", () => {
    expect(DiscussThreadIntent.intent).toBe(ContextIntents.DISCUSS_THREAD)
    expect(DiscussThreadIntent.supportedKinds).toContain(ContextRefKinds.THREAD)
  })

  test("sets a positive inline character threshold so tiny threads inline and big ones summarize", () => {
    expect(DiscussThreadIntent.inlineCharThreshold).toBeGreaterThan(0)
  })

  test("system preamble instructs the model to treat the delta as authoritative", () => {
    expect(DiscussThreadIntent.systemPreamble).toContain("Since last turn")
    expect(DiscussThreadIntent.systemPreamble.toLowerCase()).toContain("authoritative")
  })

  test("system preamble forbids leaking internal ids to the user", () => {
    // Regression for early behaviour where Ariadne copied `[msg_xyz]` into her
    // user-facing output. The preamble must frame ids as internal-only.
    expect(DiscussThreadIntent.systemPreamble.toLowerCase()).toContain("never include them")
  })

  test("orientation prompt asks for a neutral, conversational first turn and bans ids / headers", () => {
    expect(DiscussThreadIntent.orientationUserPrompt.toLowerCase()).toContain("neutral")
    expect(DiscussThreadIntent.orientationUserPrompt.toLowerCase()).toContain("conversational")
    expect(DiscussThreadIntent.orientationUserPrompt).toContain("Do NOT paste message ids")
  })
})

describe("inline-vs-summarize strategy (via renderStable)", () => {
  // The inline threshold is a soft size gate enforced in `resolveBagForStream`.
  // The intent config declares the gate; this test sanity-checks that the
  // renderer honors each branch — summary path when summaryText is supplied,
  // inline path otherwise.
  test("renders the summary text when the large-thread branch is taken", () => {
    const out = renderStable({
      preamble: DiscussThreadIntent.systemPreamble,
      summaryText: "A short summary [msg_a].",
      refLabel: "thread:stream_x",
    })
    expect(out).toContain("A short summary [msg_a]")
    expect(out).not.toContain("Messages (chronological)")
  })

  test("renders inline messages when the small-thread branch is taken", () => {
    const out = renderStable({
      preamble: DiscussThreadIntent.systemPreamble,
      inlineItems: [msg({})],
      refLabel: "thread:stream_x",
    })
    expect(out).toContain("Messages (chronological)")
    expect(out).toContain("[msg_a]")
  })
})
