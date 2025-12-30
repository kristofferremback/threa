import { describe, test, expect } from "bun:test"
import { isValidSlug, extractMentionSlugs, hasMention, SLUG_MAX_LENGTH } from "./slug"

describe("slug validation", () => {
  describe("isValidSlug", () => {
    test("accepts valid slugs", () => {
      const validSlugs = ["ariadne", "alice", "user-1", "customer-support", "a", "a1", "team-42", "q1-2025-planning"]

      for (const slug of validSlugs) {
        expect(isValidSlug(slug)).toBe(true)
      }
    })

    test("rejects invalid slugs", () => {
      const invalidSlugs = [
        "", // empty
        "123", // starts with number
        "1abc", // starts with number
        "-abc", // starts with hyphen
        "abc-", // ends with hyphen
        "abc--def", // consecutive hyphens
        "ABC", // uppercase
        "aBc", // mixed case
        "hello_world", // underscore
        "hello.world", // dot
        "hello world", // space
        "café", // unicode
        "a".repeat(SLUG_MAX_LENGTH + 1), // too long
      ]

      for (const slug of invalidSlugs) {
        expect(isValidSlug(slug)).toBe(false)
      }
    })

    test("accepts maximum length slug", () => {
      const maxSlug = "a".repeat(SLUG_MAX_LENGTH)
      expect(isValidSlug(maxSlug)).toBe(true)
    })
  })

  describe("extractMentionSlugs", () => {
    test("extracts single mention", () => {
      expect(extractMentionSlugs("Hello @ariadne")).toEqual(["ariadne"])
    })

    test("extracts multiple mentions", () => {
      expect(extractMentionSlugs("@alice and @bob")).toEqual(["alice", "bob"])
    })

    test("deduplicates repeated mentions", () => {
      expect(extractMentionSlugs("@ariadne please help @ariadne")).toEqual(["ariadne"])
    })

    test("extracts mentions with hyphens", () => {
      expect(extractMentionSlugs("Ask @customer-support for help")).toEqual(["customer-support"])
    })

    test("does NOT match email addresses", () => {
      // test@example.com should not extract "example" as a mention
      // because the @ is preceded by "test" (no word boundary)
      expect(extractMentionSlugs("Contact test@example.com")).toEqual([])
    })

    test("does NOT match underscored names", () => {
      // @tech_lead contains underscore which is not valid
      expect(extractMentionSlugs("Ask @tech_lead")).toEqual([])
    })

    test("does NOT match uppercase mentions", () => {
      expect(extractMentionSlugs("Hello @ARIADNE")).toEqual([])
    })

    test("handles mentions at boundaries", () => {
      expect(extractMentionSlugs("@ariadne")).toEqual(["ariadne"])
      expect(extractMentionSlugs("hi @ariadne")).toEqual(["ariadne"])
      expect(extractMentionSlugs("@ariadne!")).toEqual(["ariadne"])
      expect(extractMentionSlugs("(@ariadne)")).toEqual(["ariadne"])
    })

    test("handles mentions in markdown", () => {
      expect(extractMentionSlugs("**@ariadne** can help")).toEqual(["ariadne"])
    })

    test("returns empty for no mentions", () => {
      expect(extractMentionSlugs("No mentions here")).toEqual([])
    })

    test("returns empty for empty string", () => {
      expect(extractMentionSlugs("")).toEqual([])
    })

    test("handles single letter slugs", () => {
      expect(extractMentionSlugs("Hey @a")).toEqual(["a"])
    })
  })

  describe("hasMention", () => {
    test("returns true for exact match", () => {
      expect(hasMention("Hello @ariadne", "ariadne")).toBe(true)
    })

    test("returns false when not present", () => {
      expect(hasMention("Hello @alice", "ariadne")).toBe(false)
    })

    test("does not match partial slugs", () => {
      expect(hasMention("Hello @ariadne-helper", "ariadne")).toBe(false)
    })

    test("matches with trailing punctuation", () => {
      expect(hasMention("@ariadne, help!", "ariadne")).toBe(true)
    })

    test("returns false for invalid slug parameter", () => {
      expect(hasMention("Hello @test", "test.user")).toBe(false)
    })
  })
})
