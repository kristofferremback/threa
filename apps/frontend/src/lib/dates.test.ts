import { describe, it, expect } from "vitest"
import {
  formatISODate,
  formatDisplayDate,
  formatTime24h,
  isSameDay,
  formatRelativeTime,
  formatFullDateTime,
  getPastDatePresets,
  getFutureDatePresets,
} from "./dates"

describe("dates", () => {
  // Use a fixed reference date for tests that need "now"
  const fixedNow = new Date("2025-06-15T12:00:00Z")

  describe("formatISODate", () => {
    it("should format date as YYYY-MM-DD", () => {
      const date = new Date("2025-06-15T12:00:00Z")
      expect(formatISODate(date)).toBe("2025-06-15")
    })

    it("should handle single digit months and days", () => {
      const date = new Date("2025-01-05T12:00:00Z")
      expect(formatISODate(date)).toBe("2025-01-05")
    })
  })

  describe("formatDisplayDate", () => {
    it("should format date as 'Mon D, YYYY'", () => {
      const date = new Date("2025-06-15T12:00:00Z")
      expect(formatDisplayDate(date)).toBe("Jun 15, 2025")
    })

    it("should handle different months", () => {
      const date = new Date("2025-01-01T12:00:00Z")
      expect(formatDisplayDate(date)).toBe("Jan 1, 2025")
    })
  })

  describe("formatTime24h", () => {
    it("should format time in 24-hour format", () => {
      const date = new Date("2025-06-15T14:30:00Z")
      expect(formatTime24h(date)).toBe("14:30")
    })

    it("should pad single digit hours", () => {
      const date = new Date("2025-06-15T09:05:00Z")
      expect(formatTime24h(date)).toBe("09:05")
    })

    it("should handle midnight", () => {
      const date = new Date("2025-06-15T00:00:00Z")
      expect(formatTime24h(date)).toBe("00:00")
    })
  })

  describe("isSameDay", () => {
    it("should return true for same day", () => {
      const a = new Date("2025-06-15T10:00:00Z")
      const b = new Date("2025-06-15T22:00:00Z")
      expect(isSameDay(a, b)).toBe(true)
    })

    it("should return false for different days", () => {
      const a = new Date("2025-06-15T10:00:00Z")
      const b = new Date("2025-06-14T10:00:00Z")
      expect(isSameDay(a, b)).toBe(false)
    })

    it("should return false for same day different month", () => {
      const a = new Date("2025-06-15T10:00:00Z")
      const b = new Date("2025-07-15T10:00:00Z")
      expect(isSameDay(a, b)).toBe(false)
    })
  })

  describe("formatRelativeTime", () => {
    it("should show just time for same day", () => {
      const date = new Date("2025-06-15T10:00:00Z")
      const result = formatRelativeTime(date, fixedNow)
      // Should contain time format
      expect(result).toMatch(/\d{1,2}:\d{2}/)
      // Should not contain 'yesterday' or day name
      expect(result.toLowerCase()).not.toContain("yesterday")
    })

    it("should show 'yesterday' for yesterday", () => {
      const yesterday = new Date("2025-06-14T15:00:00Z")
      const result = formatRelativeTime(yesterday, fixedNow)
      expect(result.toLowerCase()).toContain("yesterday")
    })

    it("should show day name for dates within last week", () => {
      // Thursday, June 12 (3 days before Sunday June 15)
      const thursday = new Date("2025-06-12T10:00:00Z")
      const result = formatRelativeTime(thursday, fixedNow)
      expect(result).toMatch(/Thursday/i)
    })

    it("should show month and day for dates in same year over a week ago", () => {
      const twoWeeksAgo = new Date("2025-06-01T10:00:00Z")
      const result = formatRelativeTime(twoWeeksAgo, fixedNow)
      expect(result).toMatch(/June 1/i)
    })

    it("should show full date for dates in previous years", () => {
      const lastYear = new Date("2024-03-15T10:00:00Z")
      const result = formatRelativeTime(lastYear, fixedNow)
      expect(result).toMatch(/March 15, 2024/i)
    })
  })

  describe("formatFullDateTime", () => {
    it("should include weekday, full date, and time", () => {
      const date = new Date("2025-06-15T14:30:00Z")
      const result = formatFullDateTime(date)
      expect(result).toMatch(/Sunday/i)
      expect(result).toMatch(/June/i)
      expect(result).toMatch(/15/i)
      expect(result).toMatch(/2025/i)
    })
  })

  describe("getPastDatePresets", () => {
    it("should return array of past date presets", () => {
      const presets = getPastDatePresets(fixedNow)
      expect(presets.length).toBeGreaterThan(0)
      expect(presets[0].id).toBe("today")
      expect(presets[0].label).toBe("Today")
    })

    it("should include common past date options", () => {
      const presets = getPastDatePresets(fixedNow)
      const labels = presets.map((p) => p.label)
      expect(labels).toContain("Today")
      expect(labels).toContain("Yesterday")
      expect(labels).toContain("Last week")
      expect(labels).toContain("Last month")
    })

    it("should have correct date values", () => {
      const presets = getPastDatePresets(fixedNow)
      const today = presets.find((p) => p.id === "today")
      const yesterday = presets.find((p) => p.id === "yesterday")

      expect(formatISODate(today!.date)).toBe("2025-06-15")
      expect(formatISODate(yesterday!.date)).toBe("2025-06-14")
    })
  })

  describe("getFutureDatePresets", () => {
    it("should return array of future date presets", () => {
      const presets = getFutureDatePresets(fixedNow)
      expect(presets.length).toBeGreaterThan(0)
    })

    it("should include future-oriented options first", () => {
      const presets = getFutureDatePresets(fixedNow)
      const labels = presets.map((p) => p.label)
      expect(labels).toContain("Tomorrow")
      expect(labels).toContain("Next week")
      expect(labels).toContain("Next month")
    })

    it("should have correct date values for future dates", () => {
      const presets = getFutureDatePresets(fixedNow)
      const tomorrow = presets.find((p) => p.id === "tomorrow")

      expect(formatISODate(tomorrow!.date)).toBe("2025-06-16")
    })
  })
})
