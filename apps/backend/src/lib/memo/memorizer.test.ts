import { describe, expect, it, beforeEach, mock, spyOn } from "bun:test"
import { getSystemPrompt, _resetSystemPromptCache } from "./memorizer"

describe("getSystemPrompt", () => {
  beforeEach(() => {
    _resetSystemPromptCache()
  })

  it("should inject current date in YYYY-MM-DD format", () => {
    const prompt = getSystemPrompt()
    const today = new Date().toISOString().split("T")[0]

    expect(prompt).toContain(`today's date: ${today}`)
  })

  it("should cache the prompt for the same day", () => {
    const prompt1 = getSystemPrompt()
    const prompt2 = getSystemPrompt()

    expect(prompt1).toBe(prompt2)
  })

  it("should contain normalization guidance", () => {
    const prompt = getSystemPrompt()

    expect(prompt).toContain("RESOLVE PRONOUNS")
    expect(prompt).toContain("ANCHOR DATES")
  })
})
