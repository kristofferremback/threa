import { describe, expect, it } from "bun:test"
import { appendBagToSystemPrompt } from "./prompt"
import type { ResolvedBag } from "./resolve"
import { ContextIntents } from "@threa/types"

function makeBag(overrides: Partial<ResolvedBag> = {}): ResolvedBag {
  return {
    bagId: "sca_1",
    intent: ContextIntents.DISCUSS_THREAD,
    stable: "STABLE REGION",
    delta: "",
    items: [],
    refs: [],
    nextSnapshot: { renderedAt: "2026-04-22T09:00:00Z", items: [], tailMessageId: null },
    ...overrides,
  }
}

describe("appendBagToSystemPrompt", () => {
  it("returns the input verbatim when no bag is attached", () => {
    expect(appendBagToSystemPrompt("You are Ariadne.", null)).toBe("You are Ariadne.")
  })

  it("appends only the stable region when the delta is empty", () => {
    const result = appendBagToSystemPrompt("You are Ariadne.", makeBag({ delta: "" }))
    expect(result).toBe("You are Ariadne.\n\nSTABLE REGION")
  })

  it("appends both stable and delta when both are present", () => {
    const result = appendBagToSystemPrompt("You are Ariadne.", makeBag({ delta: "## Since last turn\n- msg_x edited" }))
    expect(result).toBe("You are Ariadne.\n\nSTABLE REGION\n\n## Since last turn\n- msg_x edited")
  })

  it("ignores empty base system prompt so an empty persona does not generate stray newlines", () => {
    const result = appendBagToSystemPrompt("", makeBag({ delta: "DELTA" }))
    expect(result).toBe("STABLE REGION\n\nDELTA")
  })

  it("keeps the base prompt when the stable region is empty (no bag content means nothing to append)", () => {
    const result = appendBagToSystemPrompt("You are Ariadne.", makeBag({ stable: "", delta: "" }))
    expect(result).toBe("You are Ariadne.")
  })
})
