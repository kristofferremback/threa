import { describe, test, expect } from "bun:test"
import { toShortcode, toEmoji, isValidShortcode, getShortcodeNames, normalizeMessage } from "./emoji"
import emojiData from "./emoji-data.json"

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

  describe("dataset integrity", () => {
    // The shortcode regex used everywhere a shortcode crosses the wire
    // (composer input rule, toShortcode/toEmoji APIs). If a shortcode in
    // the JSON doesn't satisfy this, it cannot round-trip through the
    // system — catch it here rather than at runtime.
    const SHORTCODE_BODY = /^[a-z0-9_+-]+$/

    test("no shortcode collisions across emojis", () => {
      // Every shortcode (primary or alias) must map to exactly one emoji.
      // Without this, toEmoji() becomes ambiguous and which mapping wins
      // depends on JSON insertion order — a silent footgun when expanding
      // aliases. If this fails, the failure message lists every offending
      // shortcode and the emojis fighting over it.
      const owners = new Map<string, string[]>()
      for (const { emoji, shortcodes } of emojiData.emojis) {
        for (const sc of shortcodes) {
          const list = owners.get(sc) ?? []
          if (!list.includes(emoji)) list.push(emoji)
          owners.set(sc, list)
        }
      }
      const collisions = Array.from(owners.entries())
        .filter(([, emojis]) => emojis.length > 1)
        .map(([sc, emojis]) => `${sc} -> ${emojis.join(", ")}`)
      expect(collisions).toEqual([])
    })

    test("every shortcode satisfies the wire-format regex", () => {
      const invalid: string[] = []
      for (const { emoji, shortcodes } of emojiData.emojis) {
        for (const sc of shortcodes) {
          if (!SHORTCODE_BODY.test(sc)) invalid.push(`${emoji} -> "${sc}"`)
        }
      }
      expect(invalid).toEqual([])
    })

    test("every emoji has at least one shortcode", () => {
      const empty = emojiData.emojis.filter((e) => e.shortcodes.length === 0).map((e) => e.emoji)
      expect(empty).toEqual([])
    })
  })

  describe("Unicode version coverage", () => {
    // Guards against silently falling behind Unicode releases. When a new
    // Emoji version ships, add a block below for it AND add the emojis to
    // emoji-data.json — this test fails on either half being missing.
    //
    // Version labels are best-effort; the test only asserts presence in
    // the dataset, not the exact version. If a label is slightly off
    // (some borderline characters move between 14.0 and 15.0 in different
    // sources), the test still passes as long as the emoji is present.
    const dataset = new Set(emojiData.emojis.map((e) => e.emoji))
    const has = (emojis: string[]) => emojis.filter((e) => !dataset.has(e))

    // Emoji 14.0 (Sept 2021)
    test("supports Emoji 14.0 (2021)", () => {
      const set = [
        // Faces
        "🥹",
        "🫠",
        "🫡",
        "🫢",
        "🫣",
        "🫤",
        "🫥",
        // Hands
        "🫰",
        "🫱",
        "🫲",
        "🫳",
        "🫴",
        "🫵",
        "🫶",
        // Person
        "🫅",
        "🫃",
        "🫄",
        // Animals & nature
        "🪺",
        "🪹",
        "🪷",
        "🪸",
        // Food & drink
        "🫘",
        "🫗",
        "🫙",
        // Travel
        "🛞",
        // Objects
        "🩼",
        "🩻",
        "🪪",
        "🪫",
        "🪩",
        "🛟",
        "🪬",
        "🪮",
        "🪯",
        // Symbols
        "🟰",
        "🫧",
      ]
      expect(has(set)).toEqual([])
    })

    // Emoji 15.0 (Sept 2022)
    test("supports Emoji 15.0 (2022)", () => {
      const set = [
        // Faces
        "🫨",
        // Hands
        "🫷",
        "🫸",
        // Animals
        "🐦‍⬛",
        "🪿",
        "🪼",
        "🪽",
        "🫎",
        "🫏",
        // Plants
        "🪻",
        // Food
        "🫚",
        "🫛",
        // Activities
        "🪈",
        "🪇",
        // Objects
        "🪭",
        // Symbols
        "🛜",
        "🩷",
        "🩵",
        "🩶",
      ]
      expect(has(set)).toEqual([])
    })

    // Emoji 15.1 (Sept 2023) — small release of ZWJ sequences
    test("supports Emoji 15.1 (2023)", () => {
      const set = ["🐦‍🔥", "🍋‍🟩", "🍄‍🟫", "⛓️‍💥"]
      expect(has(set)).toEqual([])
    })

    // Emoji 16.0 (Sept 2024)
    test("supports Emoji 16.0 (2024)", () => {
      const set = ["🫩", "🫆", "🪾", "🫜", "🪉", "🪏", "🫟"]
      expect(has(set)).toEqual([])
    })

    // Sanity: the user's reported gap that triggered this expansion.
    // Keep this regardless of version groupings above.
    test("supports the rightwards-hand family (regression guard)", () => {
      expect(has(["🫱", "🫲", "🫳", "🫴", "🫵", "🫶"])).toEqual([])
      expect(toEmoji(":rightwards_hand:")).toBe("🫱")
      expect(toEmoji(":open_hand_right:")).toBe("🫱")
    })
  })

  describe("normalizeMessage", () => {
    test("should convert emoji in text to shortcodes", () => {
      expect(normalizeMessage("Hi there 👋")).toBe("Hi there :wave:")
      expect(normalizeMessage("Great job! 👍")).toBe("Great job! :+1:")
      expect(normalizeMessage("I ❤️ this")).toBe("I :heart: this")
    })

    test("should handle multiple emoji", () => {
      expect(normalizeMessage("🎉 Party time! 🚀")).toBe(":tada: Party time! :rocket:")
      expect(normalizeMessage("👍👍👍")).toBe(":+1::+1::+1:")
    })

    test("should leave text without emoji unchanged", () => {
      expect(normalizeMessage("Hello world")).toBe("Hello world")
      expect(normalizeMessage("No emoji here!")).toBe("No emoji here!")
    })

    test("should leave existing shortcodes unchanged", () => {
      expect(normalizeMessage("Already :+1: normalized")).toBe("Already :+1: normalized")
    })

    test("should handle emoji without variation selector", () => {
      expect(normalizeMessage("Love ❤")).toBe("Love :heart:")
    })

    test("should handle complex emoji sequences", () => {
      // Pirate flag is in our mapping
      expect(normalizeMessage("Arr 🏴‍☠️")).toBe("Arr :pirate_flag:")
    })
  })
})
