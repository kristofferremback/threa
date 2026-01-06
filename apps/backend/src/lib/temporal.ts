import type { DateFormat, TimeFormat } from "@threa/types"

/**
 * Temporal context for agent invocations.
 * Captures the invoking user's timezone and preferences.
 */
export interface TemporalContext {
  /** Current time in ISO format at invocation */
  currentTime: string
  /** Invoking user's timezone (IANA identifier, e.g., "America/New_York") */
  timezone: string
  /** UTC offset string (e.g., "UTC-5") */
  utcOffset: string
  /** User's preferred date format */
  dateFormat: DateFormat
  /** User's preferred time format */
  timeFormat: TimeFormat
}

/**
 * Participant with timezone information.
 */
export interface ParticipantTemporal {
  id: string
  name: string
  timezone: string
  utcOffset: string
}

/**
 * Get the UTC offset string for a timezone (e.g., "UTC+1", "UTC-5").
 */
export function getUtcOffset(timezone: string, date: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    })

    const parts = formatter.formatToParts(date)
    const offsetPart = parts.find((p) => p.type === "timeZoneName")

    if (offsetPart?.value) {
      // Format like "GMT+1" or "GMT-5" -> normalize to "UTC+1" or "UTC-5"
      const offset = offsetPart.value.replace("GMT", "UTC")
      // Handle "UTC" (no offset) case
      if (offset === "UTC") return "UTC+0"
      return offset
    }
  } catch {
    // Invalid timezone, fall back to UTC
  }
  return "UTC+0"
}

/**
 * Parse UTC offset string to minutes (e.g., "UTC+1" -> 60, "UTC-5:30" -> -330).
 */
export function parseUtcOffsetMinutes(offset: string): number {
  const match = offset.match(/UTC([+-])(\d+)(?::(\d+))?/)
  if (!match) return 0

  const sign = match[1] === "+" ? 1 : -1
  const hours = parseInt(match[2], 10)
  const minutes = parseInt(match[3] ?? "0", 10)

  return sign * (hours * 60 + minutes)
}

/**
 * Check if all participants share the same UTC offset.
 */
export function hasSameOffset(offsets: string[]): boolean {
  if (offsets.length === 0) return true

  const firstMinutes = parseUtcOffsetMinutes(offsets[0])
  return offsets.every((o) => parseUtcOffsetMinutes(o) === firstMinutes)
}

/**
 * Format a time according to user preferences.
 * Returns format like "14:30" (24h) or "2:30 PM" (12h).
 */
export function formatTime(date: Date, timezone: string, format: TimeFormat): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12h",
  }

  return new Intl.DateTimeFormat("en-US", options).format(date)
}

/**
 * Format a date according to user preferences.
 */
export function formatDate(date: Date, timezone: string, format: DateFormat): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }

  const formatter = new Intl.DateTimeFormat("en-US", options)
  const parts = formatter.formatToParts(date)

  const year = parts.find((p) => p.type === "year")?.value ?? ""
  const month = parts.find((p) => p.type === "month")?.value ?? ""
  const day = parts.find((p) => p.type === "day")?.value ?? ""

  switch (format) {
    case "YYYY-MM-DD":
      return `${year}-${month}-${day}`
    case "DD/MM/YYYY":
      return `${day}/${month}/${year}`
    case "MM/DD/YYYY":
      return `${month}/${day}/${year}`
    default:
      return `${year}-${month}-${day}`
  }
}

/**
 * Get the date string for a given Date in a timezone (for grouping).
 */
export function getDateKey(date: Date, timezone: string): string {
  return formatDate(date, timezone, "YYYY-MM-DD")
}

/**
 * Format the current time for inclusion in system prompts.
 * Uses hour-level granularity when minute precision isn't needed.
 */
export function formatCurrentTime(
  date: Date,
  timezone: string,
  dateFormat: DateFormat,
  timeFormat: TimeFormat
): string {
  const dateStr = formatDate(date, timezone, dateFormat)
  const timeStr = formatTime(date, timezone, timeFormat)
  return `${dateStr} ${timeStr}`
}

/**
 * Build temporal context section for system prompt.
 *
 * For same-offset participants: simple format without timezone indicators.
 * For different-offset participants: shows participant offsets once.
 */
export function buildTemporalPromptSection(temporal: TemporalContext, participants?: ParticipantTemporal[]): string {
  const currentTimeFormatted = formatCurrentTime(
    new Date(temporal.currentTime),
    temporal.timezone,
    temporal.dateFormat,
    temporal.timeFormat
  )

  // Check if we have mixed timezones
  const hasMixedTimezones =
    participants &&
    participants.length > 0 &&
    !hasSameOffset([temporal.utcOffset, ...participants.map((p) => p.utcOffset)])

  // Instruction about time format
  const formatExample = temporal.timeFormat === "12h" ? "2:30 PM" : "14:30"
  const formatInstruction = `When referencing times, use ${temporal.timeFormat === "12h" ? "12-hour" : "24-hour"} format (e.g., ${formatExample}).`

  if (hasMixedTimezones && participants) {
    // Different offsets: state offsets once in system prompt
    let section = `\n\n## Current Time\n\n`
    section += `Current time: ${currentTimeFormatted} (${temporal.utcOffset}, canonical)\n\n`
    section += `Participant timezones:\n`

    for (const p of participants) {
      if (p.utcOffset !== temporal.utcOffset) {
        const offsetDiff = getOffsetDifference(temporal.utcOffset, p.utcOffset)
        section += `- ${p.name}: ${p.utcOffset} (${offsetDiff})\n`
      }
    }

    section += `\n${formatInstruction}`
    return section
  }

  // Same offset: simple format
  return `\n\n## Current Time\n\nCurrent time: ${currentTimeFormatted}\n\n${formatInstruction}`
}

/**
 * Get human-readable offset difference (e.g., "2h ahead", "3h behind").
 */
function getOffsetDifference(canonicalOffset: string, otherOffset: string): string {
  const canonicalMinutes = parseUtcOffsetMinutes(canonicalOffset)
  const otherMinutes = parseUtcOffsetMinutes(otherOffset)
  const diffMinutes = otherMinutes - canonicalMinutes

  if (diffMinutes === 0) return "same time"

  const hours = Math.abs(diffMinutes) / 60
  const direction = diffMinutes > 0 ? "ahead" : "behind"

  if (hours === Math.floor(hours)) {
    return `${hours}h ${direction}`
  }
  // Handle half-hour offsets
  return `${hours.toFixed(1)}h ${direction}`
}
