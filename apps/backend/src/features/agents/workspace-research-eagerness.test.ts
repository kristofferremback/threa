import { describe, expect, test } from "bun:test"
import { shouldEagerlyPrefetchWorkspaceResearch } from "./workspace-research-eagerness"

describe("shouldEagerlyPrefetchWorkspaceResearch", () => {
  test("should prefetch for explicit memory recall questions", () => {
    const shouldPrefetch = shouldEagerlyPrefetchWorkspaceResearch({
      streamType: "channel",
      latestUserMessage: "Do you remember who owns the release checklist?",
    })

    expect(shouldPrefetch).toBe(true)
  })

  test("should prefetch for substantive scratchpad prompts", () => {
    const shouldPrefetch = shouldEagerlyPrefetchWorkspaceResearch({
      streamType: "scratchpad",
      latestUserMessage: "Can you help me plan the rollout for next week?",
    })

    expect(shouldPrefetch).toBe(true)
  })

  test("should not prefetch for trivial acknowledgements", () => {
    const shouldPrefetch = shouldEagerlyPrefetchWorkspaceResearch({
      streamType: "scratchpad",
      latestUserMessage: "Thanks!",
    })

    expect(shouldPrefetch).toBe(false)
  })

  test("should not prefetch for non-memory channel questions", () => {
    const shouldPrefetch = shouldEagerlyPrefetchWorkspaceResearch({
      streamType: "channel",
      latestUserMessage: "How do I center a div in CSS?",
    })

    expect(shouldPrefetch).toBe(false)
  })
})
