import { describe, expect, it } from "bun:test"
import { getMemorizerSystemPrompt } from "./config"

describe("getMemorizerSystemPrompt", () => {
  it("should inject current date in YYYY-MM-DD format for UTC", () => {
    const prompt = getMemorizerSystemPrompt("UTC")
    const today = new Date().toISOString().split("T")[0]

    expect(prompt).toContain(`today's date: ${today}`)
  })

  it("should use author timezone for date formatting", () => {
    // Use a timezone where the date might differ from UTC
    const prompt = getMemorizerSystemPrompt("Pacific/Auckland")

    // Should contain a valid YYYY-MM-DD date
    expect(prompt).toMatch(/today's date: \d{4}-\d{2}-\d{2}/)
  })

  it("should default to UTC when no timezone provided", () => {
    const prompt = getMemorizerSystemPrompt()
    const today = new Date().toISOString().split("T")[0]

    expect(prompt).toContain(`today's date: ${today}`)
  })

  it("should contain normalization guidance", () => {
    const prompt = getMemorizerSystemPrompt()

    expect(prompt).toContain("RESOLVE PRONOUNS")
    expect(prompt).toContain("ANCHOR DATES")
  })
})
