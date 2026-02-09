import { describe, it, expect } from "bun:test"
import { extractMentions, extractMentionSlugs, hasMention } from "./mention-extractor"

describe("mention-extractor", () => {
  describe("extractMentions", () => {
    it("should extract single mention", () => {
      const result = extractMentions("Hello @ariadne, can you help?")

      expect(result).toEqual([{ slug: "ariadne", position: 6 }])
    })

    it("should extract multiple mentions", () => {
      const result = extractMentions("@alice and @bob should review this")

      expect(result).toEqual([
        { slug: "alice", position: 0 },
        { slug: "bob", position: 11 },
      ])
    })

    it("should dedupe repeated mentions", () => {
      const result = extractMentions("@ariadne please help @ariadne")

      expect(result).toEqual([{ slug: "ariadne", position: 0 }])
    })

    it("should handle mentions with hyphens", () => {
      const result = extractMentions("Ask @customer-support for help")

      expect(result).toEqual([{ slug: "customer-support", position: 4 }])
    })

    it("should extract mentions with underscores", () => {
      const result = extractMentions("Ask @tech_lead for help")

      expect(result).toEqual([{ slug: "tech_lead", position: 4 }])
    })

    it("should handle mentions at start of message", () => {
      const result = extractMentions("@ariadne help")

      expect(result).toEqual([{ slug: "ariadne", position: 0 }])
    })

    it("should handle mentions at end of message", () => {
      const result = extractMentions("help @ariadne")

      expect(result).toEqual([{ slug: "ariadne", position: 5 }])
    })

    it("should return empty array for no mentions", () => {
      const result = extractMentions("Hello world, no mentions here")

      expect(result).toEqual([])
    })

    it("should return empty array for empty string", () => {
      const result = extractMentions("")

      expect(result).toEqual([])
    })

    it("should NOT match email addresses", () => {
      // Email format: user@domain - should not extract domain as mention
      const result = extractMentions("Contact me at test@example.com")

      expect(result).toEqual([])
    })

    it("should handle mentions in markdown", () => {
      const result = extractMentions("**@ariadne** can you help with `code`?")

      expect(result).toEqual([{ slug: "ariadne", position: 2 }])
    })
  })

  describe("extractMentionSlugs", () => {
    it("should return just the slugs", () => {
      const result = extractMentionSlugs("Hello @alice and @bob")

      expect(result).toEqual(["alice", "bob"])
    })

    it("should return empty array for no mentions", () => {
      const result = extractMentionSlugs("No mentions here")

      expect(result).toEqual([])
    })
  })

  describe("hasMention", () => {
    it("should return true when mention exists", () => {
      expect(hasMention("Hello @ariadne", "ariadne")).toBe(true)
    })

    it("should return false when mention does not exist", () => {
      expect(hasMention("Hello @alice", "ariadne")).toBe(false)
    })

    it("should not match partial slugs", () => {
      expect(hasMention("Hello @ariadne-helper", "ariadne")).toBe(false)
    })

    it("should match exact slug with trailing text", () => {
      expect(hasMention("@ariadne can you help?", "ariadne")).toBe(true)
    })

    it("should return false for invalid slug parameter", () => {
      // test.user contains a dot which is invalid
      expect(hasMention("Hello @test", "test.user")).toBe(false)
    })
  })
})
