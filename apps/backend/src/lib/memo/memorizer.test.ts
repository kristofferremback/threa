import { describe, expect, it } from "bun:test"
import { getSystemPrompt } from "./memorizer"

describe("getSystemPrompt", () => {
  it("should inject current date in YYYY-MM-DD format", () => {
    const prompt = getSystemPrompt()
    const today = new Date().toISOString().split("T")[0]

    expect(prompt).toContain(`today's date: ${today}`)
  })

  it("should contain normalization guidance", () => {
    const prompt = getSystemPrompt()

    expect(prompt).toContain("RESOLVE PRONOUNS")
    expect(prompt).toContain("ANCHOR DATES")
  })
})
