/**
 * Unit tests for emoji shortcode library.
 * Run with: bun test tests/emoji.test.ts
 */

import { describe, test, expect } from "bun:test"
import { toShortcode, toEmoji, isValidShortcode, getShortcodeNames } from "../src/lib/emoji"

describe("Emoji Library", () => {
  describe("toShortcode", () => {
    test("should convert raw emoji to shortcode", () => {
      expect(toShortcode("👍")).toBe(":+1:")
      expect(toShortcode("👎")).toBe(":-1:")
      expect(toShortcode("❤️")).toBe(":heart:")
      expect(toShortcode("🎉")).toBe(":tada:")
      expect(toShortcode("🔥")).toBe(":fire:")
      expect(toShortcode("🚀")).toBe(":rocket:")
    })

    test("should pass through valid shortcodes", () => {
      expect(toShortcode(":+1:")).toBe(":+1:")
      expect(toShortcode(":heart:")).toBe(":heart:")
      expect(toShortcode(":fire:")).toBe(":fire:")
      expect(toShortcode(":tada:")).toBe(":tada:")
    })

    test("should handle emoji without variation selector", () => {
      // Heart without FE0F variation selector
      expect(toShortcode("❤")).toBe(":heart:")
    })

    test("should return null for invalid emoji", () => {
      expect(toShortcode("not-an-emoji")).toBeNull()
      expect(toShortcode("123")).toBeNull()
      expect(toShortcode("abc")).toBeNull()
    })

    test("should return null for unknown shortcodes", () => {
      expect(toShortcode(":not_a_real_shortcode:")).toBeNull()
      expect(toShortcode(":unknown_emoji_name:")).toBeNull()
    })

    test("should handle whitespace", () => {
      expect(toShortcode(" 👍 ")).toBe(":+1:")
      expect(toShortcode(" :heart: ")).toBe(":heart:")
    })
  })

  describe("toEmoji", () => {
    test("should convert shortcode to emoji", () => {
      expect(toEmoji(":+1:")).toBe("👍")
      expect(toEmoji(":-1:")).toBe("👎")
      expect(toEmoji(":heart:")).toBe("❤️")
      expect(toEmoji(":tada:")).toBe("🎉")
      expect(toEmoji(":fire:")).toBe("🔥")
    })

    test("should work with shortcode without colons", () => {
      expect(toEmoji("+1")).toBe("👍")
      expect(toEmoji("heart")).toBe("❤️")
      expect(toEmoji("fire")).toBe("🔥")
    })

    test("should return null for unknown shortcodes", () => {
      expect(toEmoji(":not_real:")).toBeNull()
      expect(toEmoji("not_real")).toBeNull()
    })
  })

  describe("isValidShortcode", () => {
    test("should return true for valid shortcodes", () => {
      expect(isValidShortcode(":+1:")).toBe(true)
      expect(isValidShortcode(":heart:")).toBe(true)
      expect(isValidShortcode("+1")).toBe(true)
      expect(isValidShortcode("heart")).toBe(true)
    })

    test("should return false for invalid shortcodes", () => {
      expect(isValidShortcode(":not_a_real_one:")).toBe(false)
      expect(isValidShortcode("not_a_real_one")).toBe(false)
    })
  })

  describe("getShortcodeNames", () => {
    test("should return array of shortcode names", () => {
      const names = getShortcodeNames()
      expect(Array.isArray(names)).toBe(true)
      expect(names.length).toBeGreaterThan(100)
      expect(names).toContain("+1")
      expect(names).toContain("heart")
      expect(names).toContain("fire")
    })
  })

  describe("Common emoji coverage", () => {
    const commonEmoji = [
      { emoji: "😀", shortcode: ":grinning:" },
      { emoji: "😂", shortcode: ":joy:" },
      { emoji: "🤔", shortcode: ":thinking:" },
      { emoji: "👀", shortcode: ":eyes:" },
      { emoji: "✅", shortcode: ":white_check_mark:" },
      { emoji: "❌", shortcode: ":x:" },
      { emoji: "💯", shortcode: ":100:" },
      { emoji: "✨", shortcode: ":sparkles:" },
      { emoji: "👏", shortcode: ":clap:" },
      { emoji: "🙏", shortcode: ":pray:" },
      { emoji: "💪", shortcode: ":muscle:" },
      { emoji: "🧵", shortcode: ":thread:" },
    ]

    for (const { emoji, shortcode } of commonEmoji) {
      test(`should convert ${emoji} to ${shortcode}`, () => {
        expect(toShortcode(emoji)).toBe(shortcode)
      })

      test(`should convert ${shortcode} to ${emoji}`, () => {
        expect(toEmoji(shortcode)).toBe(emoji)
      })
    }
  })
})
