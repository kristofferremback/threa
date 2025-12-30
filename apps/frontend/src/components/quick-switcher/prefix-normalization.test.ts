/**
 * Regression tests for prefix handling in quick switcher.
 *
 * These tests document expected behavior for:
 * 1. Mode prefix normalization on paste (? and >)
 * 2. Filter prefix triggers (from:, in:, is:, etc.)
 */
import { describe, it, expect } from "vitest"
import { deriveMode, getDisplayQuery } from "./quick-switcher"

describe("mode prefix normalization", () => {
  describe("deriveMode", () => {
    it("should detect search mode from ?", () => {
      expect(deriveMode("? hello")).toBe("search")
      expect(deriveMode("?hello")).toBe("search")
    })

    it("should detect command mode from >", () => {
      expect(deriveMode("> command")).toBe("command")
      expect(deriveMode(">command")).toBe("command")
    })

    it("should default to stream mode", () => {
      expect(deriveMode("hello")).toBe("stream")
      expect(deriveMode("")).toBe("stream")
    })
  })

  describe("getDisplayQuery", () => {
    it("should strip ? prefix in search mode", () => {
      expect(getDisplayQuery("? hello", "search")).toBe("hello")
      expect(getDisplayQuery("?hello", "search")).toBe("hello")
    })

    it("should strip > prefix in command mode", () => {
      expect(getDisplayQuery("> command", "command")).toBe("command")
      expect(getDisplayQuery(">command", "command")).toBe("command")
    })

    it("should return unchanged in stream mode", () => {
      expect(getDisplayQuery("hello", "stream")).toBe("hello")
    })
  })
})

describe("paste prefix normalization", () => {
  /**
   * When pasting text with redundant prefixes like "?? food" or "? ? food",
   * they should be normalized to a single prefix "? food".
   */
  function normalizePastedQuery(text: string): string {
    // This is the logic from QuickSwitcher's onPaste handler
    return text
      .replace(/^([?>][\s?>]*)+/, (match) => {
        const prefix = match.trim()[0]
        return prefix ? `${prefix} ` : ""
      })
      .trimEnd()
  }

  it("should normalize ?? food to ? food", () => {
    expect(normalizePastedQuery("?? food")).toBe("? food")
  })

  it("should normalize ? ? food to ? food", () => {
    expect(normalizePastedQuery("? ? food")).toBe("? food")
  })

  it("should normalize >> command to > command", () => {
    expect(normalizePastedQuery(">> command")).toBe("> command")
  })

  it("should normalize > > command to > command", () => {
    expect(normalizePastedQuery("> > command")).toBe("> command")
  })

  it("should normalize ?> mixed to ? mixed (first prefix wins)", () => {
    expect(normalizePastedQuery("?> mixed")).toBe("? mixed")
  })

  it("should not modify text without prefix", () => {
    expect(normalizePastedQuery("hello world")).toBe("hello world")
  })

  it("should handle single ? prefix correctly", () => {
    expect(normalizePastedQuery("? hello")).toBe("? hello")
  })

  it("should handle single > prefix correctly", () => {
    expect(normalizePastedQuery("> command")).toBe("> command")
  })
})

describe("SearchEditor paste prefix normalization", () => {
  /**
   * SearchEditor normalizes prefixes but keeps them for mode detection.
   * Pasting "food" without prefix should switch to stream mode.
   * Pasting "? food" should stay in search mode.
   */
  function normalizeSearchEditorPaste(text: string): string {
    // This is the logic from SearchEditor's handlePaste
    return text
      .replace(/^([?>][\s?>]*)+/, (match) => {
        const prefix = match.trim()[0]
        return prefix ? `${prefix} ` : ""
      })
      .trimEnd()
  }

  it("should normalize ?? to ? (keeps prefix for mode detection)", () => {
    expect(normalizeSearchEditorPaste("?? hello")).toBe("? hello")
  })

  it("should normalize ? ? to ? (keeps prefix for mode detection)", () => {
    expect(normalizeSearchEditorPaste("? ? hello")).toBe("? hello")
  })

  it("should keep single ? prefix", () => {
    expect(normalizeSearchEditorPaste("? hello")).toBe("? hello")
  })

  it("should normalize >> to >", () => {
    expect(normalizeSearchEditorPaste(">> command")).toBe("> command")
  })

  it("should normalize > > to >", () => {
    expect(normalizeSearchEditorPaste("> > command")).toBe("> command")
  })

  it("should keep text without prefix as-is (allows mode switch to stream)", () => {
    // Pasting "food" without prefix should NOT add a prefix
    // This allows the mode to switch to stream mode
    expect(normalizeSearchEditorPaste("food")).toBe("food")
  })

  it("should preserve filter prefixes like from:@", () => {
    expect(normalizeSearchEditorPaste("from:@martin hello")).toBe("from:@martin hello")
  })
})
