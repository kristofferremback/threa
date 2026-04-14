import { describe, it, expect } from "vitest"
import { hashCodeBlock } from "./code-block-context"

describe("hashCodeBlock", () => {
  it("returns a stable hash for identical content + language", () => {
    const a = hashCodeBlock("const x = 1", "typescript")
    const b = hashCodeBlock("const x = 1", "typescript")
    expect(a).toBe(b)
  })

  it("returns different hashes when content differs", () => {
    const a = hashCodeBlock("const x = 1", "typescript")
    const b = hashCodeBlock("const x = 2", "typescript")
    expect(a).not.toBe(b)
  })

  it("returns different hashes when language differs", () => {
    const a = hashCodeBlock("print('hi')", "python")
    const b = hashCodeBlock("print('hi')", "ruby")
    expect(a).not.toBe(b)
  })

  it("handles empty content", () => {
    const result = hashCodeBlock("", "text")
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })

  it("handles multi-line content", () => {
    const content = "line 1\nline 2\nline 3"
    const result = hashCodeBlock(content, "text")
    expect(typeof result).toBe("string")
  })

  it("handles unicode content", () => {
    const a = hashCodeBlock("const greeting = '🚀'", "typescript")
    const b = hashCodeBlock("const greeting = '🎉'", "typescript")
    expect(a).not.toBe(b)
  })

  it("produces URL-safe base36 output", () => {
    const result = hashCodeBlock("some code", "js")
    expect(result).toMatch(/^[0-9a-z]+$/)
  })
})
