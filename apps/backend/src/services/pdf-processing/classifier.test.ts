/**
 * PDF Page Classifier Unit Tests
 *
 * Tests verify:
 * 1. Page classification based on text content, images, tables, and layout
 * 2. Classification logic for each category
 * 3. Edge cases (empty pages, mixed content)
 */

import { describe, test, expect } from "bun:test"
import { classifyPage, type ClassificationInput } from "./classifier"

describe("PDF Page Classifier", () => {
  describe("text_rich classification", () => {
    test("classifies page with substantial text and no images as text_rich", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(150), // More than 100 chars
        imageCount: 0,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("text_rich")
    })

    test("classifies page with text exactly at threshold as text_rich", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(100), // Exactly at threshold
        imageCount: 0,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("text_rich")
    })
  })

  describe("scanned classification", () => {
    test("classifies page with minimal text and images as scanned", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(30), // Less than 50 chars
        imageCount: 1, // Has images
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("scanned")
    })

    test("classifies page with images but very little text as scanned", () => {
      const input: ClassificationInput = {
        rawText: "abc",
        imageCount: 2,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("scanned")
    })
  })

  describe("empty classification", () => {
    test("classifies page with no text and no images as empty", () => {
      const input: ClassificationInput = {
        rawText: "",
        imageCount: 0,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("empty")
    })

    test("classifies page with null text and no images as empty", () => {
      const input: ClassificationInput = {
        rawText: null,
        imageCount: 0,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("empty")
    })

    test("classifies page with very minimal text (< 10 chars) and no images as empty", () => {
      const input: ClassificationInput = {
        rawText: "abc",
        imageCount: 0,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("empty")
    })
  })

  describe("complex_layout classification", () => {
    test("classifies page with tables as complex_layout", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(150),
        imageCount: 0,
        hasTables: true,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("complex_layout")
    })

    test("classifies page with multi-column layout as complex_layout", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(150),
        imageCount: 0,
        hasTables: false,
        isMultiColumn: true,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("complex_layout")
    })

    test("classifies page with both tables and multi-column as complex_layout", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(150),
        imageCount: 0,
        hasTables: true,
        isMultiColumn: true,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("complex_layout")
    })

    test("tables take priority over images for classification", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(150),
        imageCount: 2,
        hasTables: true,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("complex_layout")
    })
  })

  describe("mixed classification", () => {
    test("classifies page with substantial text and images as mixed", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(150), // More than 100 chars (text_rich threshold)
        imageCount: 2,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("mixed")
    })

    test("classifies page with text exactly at threshold and images as mixed", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(100), // At text_rich threshold
        imageCount: 1,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.classification).toBe("mixed")
    })
  })

  describe("edge cases and priority", () => {
    test("handles text between scanned and text_rich thresholds with images", () => {
      // Text between 50-100 with images
      const input: ClassificationInput = {
        rawText: "a".repeat(75),
        imageCount: 1,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      // Not enough text for mixed, but has images - falls to scanned
      expect(result.classification).toBe("scanned")
    })

    test("handles text between thresholds without images", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(75), // Between 10 and 100
        imageCount: 0,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      // Falls through to empty fallback
      expect(result.classification).toBe("empty")
    })

    test("returns confidence scores", () => {
      const input: ClassificationInput = {
        rawText: "a".repeat(150),
        imageCount: 0,
        hasTables: false,
        isMultiColumn: false,
      }

      const result = classifyPage(input)
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })
  })
})
