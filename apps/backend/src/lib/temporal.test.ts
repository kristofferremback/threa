import { describe, it, expect } from "bun:test"
import {
  getUtcOffset,
  parseUtcOffsetMinutes,
  hasSameOffset,
  formatTime,
  formatDate,
  getDateKey,
  formatCurrentTime,
  buildTemporalPromptSection,
  formatConversationHistory,
  type TemporalContext,
  type ParticipantTemporal,
  type MessageForFormatting,
} from "./temporal"

describe("temporal utilities", () => {
  describe("getUtcOffset", () => {
    it("should return UTC offset for a timezone", () => {
      const date = new Date("2026-01-06T12:00:00Z")
      const offset = getUtcOffset("America/New_York", date)
      // New York is UTC-5 in winter
      expect(offset).toBe("UTC-5")
    })

    it("should handle UTC timezone", () => {
      const date = new Date("2026-01-06T12:00:00Z")
      const offset = getUtcOffset("UTC", date)
      expect(offset).toBe("UTC+0")
    })

    it("should handle positive offsets", () => {
      const date = new Date("2026-01-06T12:00:00Z")
      const offset = getUtcOffset("Europe/Stockholm", date)
      // Stockholm is UTC+1 in winter
      expect(offset).toBe("UTC+1")
    })

    it("should fallback to UTC+0 for invalid timezone", () => {
      const offset = getUtcOffset("Invalid/Timezone")
      expect(offset).toBe("UTC+0")
    })
  })

  describe("parseUtcOffsetMinutes", () => {
    it("should parse positive UTC offset", () => {
      expect(parseUtcOffsetMinutes("UTC+1")).toBe(60)
      expect(parseUtcOffsetMinutes("UTC+5")).toBe(300)
    })

    it("should parse negative UTC offset", () => {
      expect(parseUtcOffsetMinutes("UTC-5")).toBe(-300)
      expect(parseUtcOffsetMinutes("UTC-8")).toBe(-480)
    })

    it("should parse zero offset", () => {
      expect(parseUtcOffsetMinutes("UTC+0")).toBe(0)
    })

    it("should parse half-hour offsets", () => {
      expect(parseUtcOffsetMinutes("UTC+5:30")).toBe(330)
      expect(parseUtcOffsetMinutes("UTC-9:30")).toBe(-570)
    })

    it("should return 0 for invalid format", () => {
      expect(parseUtcOffsetMinutes("invalid")).toBe(0)
      expect(parseUtcOffsetMinutes("GMT+5")).toBe(0)
    })
  })

  describe("hasSameOffset", () => {
    it("should return true for empty array", () => {
      expect(hasSameOffset([])).toBe(true)
    })

    it("should return true when all offsets are the same", () => {
      expect(hasSameOffset(["UTC+1", "UTC+1", "UTC+1"])).toBe(true)
    })

    it("should return false when offsets differ", () => {
      expect(hasSameOffset(["UTC+1", "UTC+3"])).toBe(false)
    })

    it("should return true for single offset", () => {
      expect(hasSameOffset(["UTC+5"])).toBe(true)
    })
  })

  describe("formatTime", () => {
    it("should format time in 24h format", () => {
      const date = new Date("2026-01-06T14:30:00Z")
      const time = formatTime(date, "UTC", "24h")
      expect(time).toBe("14:30")
    })

    it("should format time in 12h format", () => {
      const date = new Date("2026-01-06T14:30:00Z")
      const time = formatTime(date, "UTC", "12h")
      expect(time).toBe("2:30 PM")
    })

    it("should respect timezone", () => {
      const date = new Date("2026-01-06T14:30:00Z")
      const time = formatTime(date, "America/New_York", "24h")
      // New York is UTC-5 in winter, so 14:30 UTC = 09:30 EST
      expect(time).toBe("09:30")
    })
  })

  describe("formatDate", () => {
    it("should format date in ISO format (YYYY-MM-DD)", () => {
      const date = new Date("2026-01-06T14:30:00Z")
      expect(formatDate(date, "UTC", "YYYY-MM-DD")).toBe("2026-01-06")
    })

    it("should format date in EU format (DD/MM/YYYY)", () => {
      const date = new Date("2026-01-06T14:30:00Z")
      expect(formatDate(date, "UTC", "DD/MM/YYYY")).toBe("06/01/2026")
    })

    it("should format date in US format (MM/DD/YYYY)", () => {
      const date = new Date("2026-01-06T14:30:00Z")
      expect(formatDate(date, "UTC", "MM/DD/YYYY")).toBe("01/06/2026")
    })

    it("should respect timezone for date boundaries", () => {
      // 2026-01-07T01:00:00Z is still Jan 6 in New York (UTC-5)
      const date = new Date("2026-01-07T01:00:00Z")
      expect(formatDate(date, "America/New_York", "YYYY-MM-DD")).toBe("2026-01-06")
      expect(formatDate(date, "UTC", "YYYY-MM-DD")).toBe("2026-01-07")
    })
  })

  describe("getDateKey", () => {
    it("should return ISO date string for grouping", () => {
      const date = new Date("2026-01-06T14:30:00Z")
      expect(getDateKey(date, "UTC")).toBe("2026-01-06")
    })
  })

  describe("formatCurrentTime", () => {
    it("should format current time with date and time", () => {
      const date = new Date("2026-01-06T14:30:00Z")
      const result = formatCurrentTime(date, "UTC", "YYYY-MM-DD", "24h")
      expect(result).toBe("2026-01-06 14:30")
    })

    it("should use user's preferred formats", () => {
      const date = new Date("2026-01-06T14:30:00Z")
      const result = formatCurrentTime(date, "UTC", "DD/MM/YYYY", "12h")
      expect(result).toBe("06/01/2026 2:30 PM")
    })
  })

  describe("buildTemporalPromptSection", () => {
    const baseContext: TemporalContext = {
      currentTime: "2026-01-06T14:30:00Z",
      timezone: "UTC",
      utcOffset: "UTC+0",
      dateFormat: "YYYY-MM-DD",
      timeFormat: "24h",
    }

    it("should build simple time section without participants", () => {
      const section = buildTemporalPromptSection(baseContext)
      expect(section).toContain("Current time: 2026-01-06 14:30")
    })

    it("should build simple section when all participants have same offset", () => {
      const participants: ParticipantTemporal[] = [
        { id: "1", name: "Alice", timezone: "UTC", utcOffset: "UTC+0" },
        { id: "2", name: "Bob", timezone: "UTC", utcOffset: "UTC+0" },
      ]
      const section = buildTemporalPromptSection(baseContext, participants)
      expect(section).toContain("Current time: 2026-01-06 14:30")
      expect(section).not.toContain("Participant timezones")
    })

    it("should show participant offsets when timezones differ", () => {
      const context: TemporalContext = {
        ...baseContext,
        timezone: "Europe/London",
        utcOffset: "UTC+0",
      }
      const participants: ParticipantTemporal[] = [
        { id: "1", name: "Alice", timezone: "Europe/Stockholm", utcOffset: "UTC+1" },
        { id: "2", name: "Bob", timezone: "America/New_York", utcOffset: "UTC-5" },
      ]
      const section = buildTemporalPromptSection(context, participants)
      expect(section).toContain("canonical")
      expect(section).toContain("Participant timezones")
      expect(section).toContain("Alice: UTC+1")
      expect(section).toContain("Bob: UTC-5")
    })
  })

  describe("formatConversationHistory", () => {
    const messages: MessageForFormatting[] = [
      { authorName: "alice", createdAt: new Date("2026-01-06T09:00:00Z"), content: "Good morning!" },
      { authorName: "bob", createdAt: new Date("2026-01-06T09:05:00Z"), content: "Hi there!" },
      { authorName: "alice", createdAt: new Date("2026-01-07T10:00:00Z"), content: "New day!" },
    ]

    it("should format messages with timestamps", () => {
      const result = formatConversationHistory(messages, "UTC", "YYYY-MM-DD", "24h")
      expect(result).toContain("(09:00)")
      expect(result).toContain("[@alice]")
      expect(result).toContain("Good morning!")
    })

    it("should insert date boundaries when date changes", () => {
      const result = formatConversationHistory(messages, "UTC", "YYYY-MM-DD", "24h")
      expect(result).toContain("— 2026-01-06 —")
      expect(result).toContain("— 2026-01-07 —")
    })

    it("should return empty string for empty messages", () => {
      const result = formatConversationHistory([], "UTC", "YYYY-MM-DD", "24h")
      expect(result).toBe("")
    })

    it("should use 12h format when specified", () => {
      const result = formatConversationHistory(messages, "UTC", "YYYY-MM-DD", "12h")
      expect(result).toContain("(9:00 AM)")
    })
  })
})
