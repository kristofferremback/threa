import { describe, expect, it } from "vitest"
import { formatContextRefLabel } from "./format-label"

describe("formatContextRefLabel", () => {
  it("uses #slug + count for a sized full thread", () => {
    expect(formatContextRefLabel({ slug: "intro", itemCount: 12 })).toBe("12 messages in #intro")
  })

  it("falls back to displayName when slug is missing", () => {
    expect(formatContextRefLabel({ displayName: "Intro Thread", itemCount: 5 })).toBe("5 messages in Intro Thread")
  })

  it("uses singular form for a single message", () => {
    expect(formatContextRefLabel({ slug: "intro", itemCount: 1 })).toBe("1 message in #intro")
  })

  it("falls back to 'Thread in …' when itemCount is unknown or zero", () => {
    expect(formatContextRefLabel({ slug: "intro", itemCount: 0 })).toBe("Thread in #intro")
    expect(formatContextRefLabel({ slug: "intro" })).toBe("Thread in #intro")
  })

  it("uses 'this thread' when no slug or displayName is available", () => {
    expect(formatContextRefLabel({ itemCount: 5 })).toBe("5 messages in this thread")
  })

  it("renders anchored slices with a 'Slice of …' framing", () => {
    expect(formatContextRefLabel({ slug: "intro", itemCount: 12, fromMessageId: "msg_1" })).toBe("Slice of #intro")
    expect(formatContextRefLabel({ slug: "intro", toMessageId: "msg_5" })).toBe("Slice of #intro")
  })

  it("never returns an empty string", () => {
    expect(formatContextRefLabel({})).toBe("Thread in this thread")
  })
})
