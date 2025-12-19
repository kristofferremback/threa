/**
 * Slug Generation Unit Tests
 *
 * Tests verify:
 * 1. generateSlug normalizes strings correctly
 * 2. generateUniqueSlug handles collisions
 * 3. Edge cases (empty strings, special characters, long names)
 */

import { describe, test, expect } from "bun:test"
import { generateSlug, generateUniqueSlug } from "./slug"

describe("Slug Generation", () => {
  describe("generateSlug", () => {
    test("converts to lowercase", () => {
      expect(generateSlug("My Workspace")).toBe("my-workspace")
      expect(generateSlug("UPPERCASE")).toBe("uppercase")
      expect(generateSlug("MixedCase")).toBe("mixedcase")
    })

    test("replaces spaces with hyphens", () => {
      expect(generateSlug("my workspace")).toBe("my-workspace")
      expect(generateSlug("multiple   spaces")).toBe("multiple-spaces")
    })

    test("removes special characters", () => {
      expect(generateSlug("hello!@#$%world")).toBe("hello-world")
      expect(generateSlug("test&more")).toBe("test-more")
      expect(generateSlug("with(parens)")).toBe("with-parens")
    })

    test("preserves numbers", () => {
      expect(generateSlug("project123")).toBe("project123")
      expect(generateSlug("Team 42")).toBe("team-42")
    })

    test("trims leading and trailing hyphens", () => {
      expect(generateSlug("-leading")).toBe("leading")
      expect(generateSlug("trailing-")).toBe("trailing")
      expect(generateSlug("--both--")).toBe("both")
      expect(generateSlug("!special!")).toBe("special")
    })

    test("collapses multiple hyphens into one", () => {
      expect(generateSlug("multiple---hyphens")).toBe("multiple-hyphens")
      expect(generateSlug("test   space   here")).toBe("test-space-here")
    })

    test("truncates to 50 characters", () => {
      const longName = "a".repeat(100)
      const slug = generateSlug(longName)
      expect(slug.length).toBe(50)
      expect(slug).toBe("a".repeat(50))
    })

    test("handles empty string", () => {
      expect(generateSlug("")).toBe("")
    })

    test("handles string with only special characters", () => {
      expect(generateSlug("!@#$%^&*()")).toBe("")
    })

    test("handles unicode characters", () => {
      // Unicode letters are removed (not in a-z0-9)
      expect(generateSlug("café")).toBe("caf")
      expect(generateSlug("日本語")).toBe("")
      expect(generateSlug("mix混合ed")).toBe("mix-ed")
    })

    test("handles real-world workspace names", () => {
      expect(generateSlug("Acme Corporation")).toBe("acme-corporation")
      expect(generateSlug("John's Team")).toBe("john-s-team")
      expect(generateSlug("Q1 2025 Planning")).toBe("q1-2025-planning")
      expect(generateSlug("Engineering (Frontend)")).toBe("engineering-frontend")
    })
  })

  describe("generateUniqueSlug", () => {
    test("returns base slug when no collision", async () => {
      const checkExists = async () => false
      const slug = await generateUniqueSlug("My Workspace", checkExists)
      expect(slug).toBe("my-workspace")
    })

    test("appends suffix on first collision", async () => {
      const existingSlugs = new Set(["my-workspace"])
      const checkExists = async (slug: string) => existingSlugs.has(slug)
      const slug = await generateUniqueSlug("My Workspace", checkExists)
      expect(slug).toBe("my-workspace-1")
    })

    test("increments suffix until unique", async () => {
      const existingSlugs = new Set(["my-workspace", "my-workspace-1", "my-workspace-2"])
      const checkExists = async (slug: string) => existingSlugs.has(slug)
      const slug = await generateUniqueSlug("My Workspace", checkExists)
      expect(slug).toBe("my-workspace-3")
    })

    test("handles empty base slug by defaulting to 'workspace'", async () => {
      const checkExists = async () => false
      const slug = await generateUniqueSlug("!@#$%", checkExists)
      expect(slug).toBe("workspace")
    })

    test("handles empty base slug with collision", async () => {
      const existingSlugs = new Set(["workspace"])
      const checkExists = async (slug: string) => existingSlugs.has(slug)
      const slug = await generateUniqueSlug("!@#$%", checkExists)
      expect(slug).toBe("workspace-1")
    })

    test("truncates base to leave room for suffix", async () => {
      // Create a long name that would exceed 50 chars
      const longName = "a".repeat(60)
      // Make the base slug exist so we need a suffix
      const existingSlugs = new Set(["a".repeat(50)])
      const checkExists = async (slug: string) => existingSlugs.has(slug)

      const slug = await generateUniqueSlug(longName, checkExists)

      // Should be truncated base (50-6=44 chars) + "-1"
      expect(slug).toBe("a".repeat(44) + "-1")
      expect(slug.length).toBeLessThanOrEqual(50)
    })

    test("handles high collision counts", async () => {
      // Simulate many existing slugs
      const existingSlugs = new Set<string>()
      for (let i = 0; i <= 100; i++) {
        existingSlugs.add(i === 0 ? "test" : `test-${i}`)
      }
      const checkExists = async (slug: string) => existingSlugs.has(slug)

      const slug = await generateUniqueSlug("Test", checkExists)
      expect(slug).toBe("test-101")
    })

    test("preserves original case intent through lowercase conversion", async () => {
      const checkExists = async () => false

      // Both should produce same slug
      const slug1 = await generateUniqueSlug("My Team", checkExists)
      const slug2 = await generateUniqueSlug("MY TEAM", checkExists)
      const slug3 = await generateUniqueSlug("my team", checkExists)

      expect(slug1).toBe("my-team")
      expect(slug2).toBe("my-team")
      expect(slug3).toBe("my-team")
    })
  })
})
