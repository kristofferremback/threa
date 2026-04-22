import { describe, it, expect } from "bun:test"
import { sliceLines, truncateBytes, toActor } from "./format"

describe("sliceLines", () => {
  const sample = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")

  it("returns the whole file when it fits", () => {
    const result = sliceLines(sample, { maxLines: 100, maxBytes: 10_000 })
    expect(result.truncated).toBe(false)
    expect(result.startLine).toBe(1)
    expect(result.endLine).toBe(20)
    expect(result.totalLines).toBe(20)
    expect(result.text.split("\n")).toHaveLength(20)
    expect(result.nextStartLine).toBeUndefined()
  })

  it("respects fromLine and toLine", () => {
    const result = sliceLines(sample, { fromLine: 5, toLine: 8, maxLines: 100, maxBytes: 10_000 })
    expect(result.startLine).toBe(5)
    expect(result.endLine).toBe(8)
    expect(result.text).toBe("line 5\nline 6\nline 7\nline 8")
    expect(result.truncated).toBe(false)
  })

  it("truncates by line cap and reports nextStartLine", () => {
    const result = sliceLines(sample, { fromLine: 1, maxLines: 5, maxBytes: 10_000 })
    expect(result.endLine).toBe(5)
    expect(result.truncated).toBe(true)
    expect(result.truncationReason).toBe("line_cap")
    expect(result.nextStartLine).toBe(6)
  })

  it("truncates by byte cap and reports it", () => {
    const bigLine = "x".repeat(200)
    const bigSample = Array.from({ length: 10 }, () => bigLine).join("\n")
    const result = sliceLines(bigSample, { maxLines: 100, maxBytes: 500 })
    expect(result.truncated).toBe(true)
    expect(result.truncationReason).toBe("byte_cap")
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(500)
    expect(result.nextStartLine).toBeGreaterThan(result.startLine)
  })

  it("handles normalization of CRLF line endings", () => {
    const result = sliceLines("a\r\nb\r\nc", { maxLines: 100, maxBytes: 10_000 })
    expect(result.totalLines).toBe(3)
    expect(result.text).toBe("a\nb\nc")
  })
})

describe("truncateBytes", () => {
  it("passes through short strings untouched", () => {
    const result = truncateBytes("hello", 100)
    expect(result.truncated).toBe(false)
    expect(result.text).toBe("hello")
    expect(result.totalBytes).toBe(5)
    expect(result.returnedBytes).toBe(5)
  })

  it("truncates long strings and reports totals", () => {
    const text = "x".repeat(500)
    const result = truncateBytes(text, 100)
    expect(result.truncated).toBe(true)
    expect(result.totalBytes).toBe(500)
    expect(result.returnedBytes).toBeLessThanOrEqual(100)
    expect(result.text.length).toBe(result.returnedBytes)
  })

  it("does not split a UTF-8 multi-byte character", () => {
    const text = "a" + "ä".repeat(50) + "b"
    const result = truncateBytes(text, 11)
    expect(result.truncated).toBe(true)
    // Byte 0 is 'a', then each 'ä' is 2 bytes; byte 11 would fall mid-character.
    // We walk back to a valid boundary so the returned string always decodes cleanly.
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(11)
    expect(() => Buffer.from(result.text, "utf8").toString("utf8")).not.toThrow()
  })
})

describe("toActor", () => {
  it("extracts login and html_url", () => {
    expect(toActor({ login: "octocat", html_url: "https://github.com/octocat" })).toEqual({
      login: "octocat",
      htmlUrl: "https://github.com/octocat",
    })
  })

  it("returns null for anonymous actors", () => {
    expect(toActor(null)).toBeNull()
    expect(toActor({})).toBeNull()
    expect(toActor({ login: 42 })).toBeNull()
  })
})
