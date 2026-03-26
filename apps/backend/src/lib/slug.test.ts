import { describe, test, expect } from "bun:test"
import { generateSlug, generateUniqueSlug } from "@threa/backend-common"

describe("Slug Generation", () => {
  describe("generateSlug", () => {
    test("should convert to lowercase and use underscores", () => {
      expect(generateSlug("My Workspace")).toBe("my_workspace")
      expect(generateSlug("UPPERCASE")).toBe("uppercase")
      expect(generateSlug("MixedCase")).toBe("mixedcase")
    })

    test("should replace spaces with underscores", () => {
      expect(generateSlug("my workspace")).toBe("my_workspace")
      expect(generateSlug("multiple   spaces")).toBe("multiple_spaces")
    })

    test("should preserve numbers", () => {
      expect(generateSlug("project123")).toBe("project123")
      expect(generateSlug("Team 42")).toBe("team_42")
    })

    test("should trim leading and trailing underscores", () => {
      expect(generateSlug("-leading")).toBe("leading")
      expect(generateSlug("trailing-")).toBe("trailing")
      expect(generateSlug("--both--")).toBe("both")
      expect(generateSlug("!special!")).toBe("special")
    })

    test("should collapse multiple separators into one", () => {
      expect(generateSlug("multiple---hyphens")).toBe("multiple_hyphens")
      expect(generateSlug("test   space   here")).toBe("test_space_here")
    })

    test("should truncate to 50 characters", () => {
      const longName = "a".repeat(100)
      const slug = generateSlug(longName)
      expect(slug.length).toBe(50)
      expect(slug).toBe("a".repeat(50))
    })

    test("should return empty string for empty input", () => {
      expect(generateSlug("")).toBe("")
    })

    test("should transliterate accented Latin characters", () => {
      expect(generateSlug("café")).toBe("cafe")
      expect(generateSlug("Strömsö")).toBe("stromso")
      expect(generateSlug("Ärligt Talat")).toBe("arligt_talat")
      expect(generateSlug("Müller")).toBe("muller")
      expect(generateSlug("naïve résumé")).toBe("naive_resume")
    })

    test("should transliterate non-decomposable characters", () => {
      expect(generateSlug("Ærø")).toBe("aero")
      expect(generateSlug("Straße")).toBe("strasse")
      expect(generateSlug("Łódź")).toBe("lodz")
      expect(generateSlug("Bjørn")).toBe("bjorn")
    })

    test("should transliterate CJK to pinyin", () => {
      expect(generateSlug("日本語")).toBe("ri_ben_yu")
    })

    test("should handle real-world workspace names", () => {
      expect(generateSlug("Acme Corporation")).toBe("acme_corporation")
      expect(generateSlug("John's Team")).toBe("johns_team")
      expect(generateSlug("Q1 2025 Planning")).toBe("q1_2025_planning")
      expect(generateSlug("Engineering (Frontend)")).toBe("engineering_frontend")
    })
  })

  describe("generateUniqueSlug", () => {
    test("should return base slug when no collision", async () => {
      const checkExists = async () => false
      const slug = await generateUniqueSlug("My Workspace", checkExists)
      expect(slug).toBe("my_workspace")
    })

    test("should append suffix on first collision", async () => {
      const existingSlugs = new Set(["my_workspace"])
      const checkExists = async (slug: string) => existingSlugs.has(slug)
      const slug = await generateUniqueSlug("My Workspace", checkExists)
      expect(slug).toBe("my_workspace_1")
    })

    test("should increment suffix until unique", async () => {
      const existingSlugs = new Set(["my_workspace", "my_workspace_1", "my_workspace_2"])
      const checkExists = async (slug: string) => existingSlugs.has(slug)
      const slug = await generateUniqueSlug("My Workspace", checkExists)
      expect(slug).toBe("my_workspace_3")
    })

    test("should default to 'workspace' for empty base slug", async () => {
      const checkExists = async () => false
      const slug = await generateUniqueSlug("", checkExists)
      expect(slug).toBe("workspace")
    })

    test("should handle empty base slug with collision", async () => {
      const existingSlugs = new Set(["workspace"])
      const checkExists = async (slug: string) => existingSlugs.has(slug)
      const slug = await generateUniqueSlug("", checkExists)
      expect(slug).toBe("workspace_1")
    })

    test("should truncate base to leave room for suffix", async () => {
      const longName = "a".repeat(60)
      const existingSlugs = new Set(["a".repeat(50)])
      const checkExists = async (slug: string) => existingSlugs.has(slug)

      const slug = await generateUniqueSlug(longName, checkExists)

      expect(slug).toBe("a".repeat(44) + "_1")
      expect(slug.length).toBeLessThanOrEqual(50)
    })

    test("should handle high collision counts", async () => {
      const existingSlugs = new Set<string>()
      for (let i = 0; i <= 100; i++) {
        existingSlugs.add(i === 0 ? "test" : `test_${i}`)
      }
      const checkExists = async (slug: string) => existingSlugs.has(slug)

      const slug = await generateUniqueSlug("Test", checkExists)
      expect(slug).toBe("test_101")
    })

    test("should produce same slug regardless of input case", async () => {
      const checkExists = async () => false

      const slug1 = await generateUniqueSlug("My Team", checkExists)
      const slug2 = await generateUniqueSlug("MY TEAM", checkExists)
      const slug3 = await generateUniqueSlug("my team", checkExists)

      expect(slug1).toBe("my_team")
      expect(slug2).toBe("my_team")
      expect(slug3).toBe("my_team")
    })
  })
})
