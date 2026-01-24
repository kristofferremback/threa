/**
 * Centralized date utilities using date-fns.
 *
 * All date formatting and manipulation should go through this module to:
 * 1. Support user preference for date/time formats
 * 2. Ensure consistent date handling across the app
 * 3. Avoid ad-hoc Date manipulation scattered throughout the codebase
 */
import {
  format,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  addDays,
  addWeeks,
  addMonths,
  isSameDay as dateFnsIsSameDay,
  differenceInDays,
  startOfDay,
} from "date-fns"
import type { DateFormat, TimeFormat } from "@threa/types"

// Map user preference format to date-fns format string
const DATE_FORMAT_MAP: Record<DateFormat, string> = {
  "YYYY-MM-DD": "yyyy-MM-dd",
  "DD/MM/YYYY": "dd/MM/yyyy",
  "MM/DD/YYYY": "MM/dd/yyyy",
}

interface DatePrefs {
  dateFormat?: DateFormat
}

interface TimePrefs {
  timeFormat?: TimeFormat
}

// ============================================================================
// ISO Date Formatting (for API/filter values)
// ============================================================================

/**
 * Format a date as ISO date string (YYYY-MM-DD).
 * Used for filter values and API calls.
 */
export function formatISODate(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

// ============================================================================
// Display Formatting (for UI)
// ============================================================================

/**
 * Format a date according to user preferences.
 * @param date - The date to format
 * @param prefs - User preferences for date format
 * @returns Formatted date string (e.g., "2025-01-15", "15/01/2025", or "01/15/2025")
 */
export function formatDisplayDate(date: Date, prefs?: DatePrefs): string {
  const dateFormat = prefs?.dateFormat ?? "YYYY-MM-DD"
  return format(date, DATE_FORMAT_MAP[dateFormat])
}

/**
 * Format time according to user preferences.
 * @param date - The date/time to format
 * @param prefs - User preferences for time format
 * @returns Formatted time string (e.g., "14:30" or "2:30 PM")
 */
export function formatTime(date: Date, prefs?: TimePrefs): string {
  return format(date, prefs?.timeFormat === "12h" ? "h:mm a" : "HH:mm")
}

/**
 * Format time in 24-hour format (legacy, prefer formatTime with prefs).
 * Example: "14:30"
 */
export function formatTime24h(date: Date): string {
  return format(date, "HH:mm")
}

// ============================================================================
// Relative Date Helpers
// ============================================================================

export { isSameDay as dateFnsIsSameDay }

/**
 * Check if two dates are the same day.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return dateFnsIsSameDay(a, b)
}

interface RelativeTimeOptions {
  /** Use terse format (e.g., "2m ago") vs verbose (e.g., "yesterday 14:30") */
  terse?: boolean
}

/**
 * Format a date relative to now.
 *
 * Verbose (default): "yesterday 14:30", "Monday 09:00" - includes time
 * Terse: "2m ago", "1h ago", "yesterday" - compact, no time
 */
export function formatRelativeTime(
  date: Date,
  now: Date = new Date(),
  prefs?: TimePrefs,
  options?: RelativeTimeOptions
): string {
  const terse = options?.terse ?? false

  if (terse) {
    return formatRelativeTimeTerse(date, now)
  }

  return formatRelativeTimeVerbose(date, now, prefs)
}

/** Verbose format: includes time (e.g., "yesterday 14:30", "Monday 09:00") */
function formatRelativeTimeVerbose(date: Date, now: Date, prefs?: TimePrefs): string {
  const time = formatTime(date, prefs)

  // Same day: just show time
  if (isSameDay(date, now)) {
    return time
  }

  // Calculate days difference relative to `now` parameter, not system time
  const daysAgo = differenceInDays(startOfDay(now), startOfDay(date))

  // Yesterday (exactly 1 day ago)
  if (daysAgo === 1) {
    return `yesterday ${time}`
  }

  // Within the last week: show day name
  if (daysAgo < 7 && daysAgo > 0) {
    const dayName = date.toLocaleDateString(undefined, { weekday: "long" })
    return `${dayName} ${time}`
  }

  // Same year: show month and day
  if (date.getFullYear() === now.getFullYear()) {
    const monthDay = date.toLocaleDateString(undefined, { month: "long", day: "numeric" })
    return `${monthDay} ${time}`
  }

  // Different year: show full date
  const fullDate = date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  return `${fullDate} ${time}`
}

/** Terse format: compact, no time (e.g., "2m ago", "yesterday") */
function formatRelativeTimeTerse(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)

  // Less than 1 minute ago
  if (diffSec < 60) {
    return "now"
  }

  // Less than 1 hour ago
  if (diffMin < 60) {
    return `${diffMin}m ago`
  }

  // Less than 24 hours ago
  if (diffHour < 24) {
    return `${diffHour}h ago`
  }

  // Calculate days difference relative to `now` parameter, not system time
  const daysAgo = differenceInDays(startOfDay(now), startOfDay(date))

  // Yesterday (exactly 1 day ago)
  if (daysAgo === 1) {
    return "yesterday"
  }

  // Within the last week: show day name only
  if (daysAgo < 7 && daysAgo > 0) {
    return date.toLocaleDateString(undefined, { weekday: "short" })
  }

  // Same year: show month and day abbreviated
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }

  // Different year: show abbreviated date with year
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  })
}

/**
 * Format a full date-time for tooltips.
 * Uses user preferences for time format.
 * Example: "Wednesday, January 15, 2025, 14:30" or "Wednesday, January 15, 2025, 2:30 PM"
 */
export function formatFullDateTime(date: Date, prefs?: TimePrefs): string {
  const datePart = date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const timePart = formatTime(date, prefs)
  return `${datePart}, ${timePart}`
}

// ============================================================================
// Date Presets (for filter pickers)
// ============================================================================

export interface DatePreset {
  id: string
  label: string
  date: Date
}

/**
 * Get past date presets for "after:" filters.
 * Shows dates you might want to search after (looking back in time).
 */
export function getPastDatePresets(now: Date = new Date()): DatePreset[] {
  return [
    { id: "today", label: "Today", date: now },
    { id: "yesterday", label: "Yesterday", date: subDays(now, 1) },
    { id: "last-week", label: "Last week", date: subWeeks(now, 1) },
    { id: "last-month", label: "Last month", date: subMonths(now, 1) },
    { id: "last-3-months", label: "Last 3 months", date: subMonths(now, 3) },
    { id: "last-year", label: "Last year", date: subYears(now, 1) },
  ]
}

/**
 * Get future date presets for "before:" filters.
 * Shows dates you might want to search before (upper bounds).
 *
 * Note: "before:" typically means "messages sent before this date",
 * so we show a mix of past and future to allow flexible filtering.
 */
export function getFutureDatePresets(now: Date = new Date()): DatePreset[] {
  return [
    { id: "tomorrow", label: "Tomorrow", date: addDays(now, 1) },
    { id: "next-week", label: "Next week", date: addWeeks(now, 1) },
    { id: "next-month", label: "Next month", date: addMonths(now, 1) },
    { id: "today", label: "Today", date: now },
    { id: "yesterday", label: "Yesterday", date: subDays(now, 1) },
    { id: "last-week", label: "Last week", date: subWeeks(now, 1) },
  ]
}

// ============================================================================
// Re-exports from date-fns for convenience
// ============================================================================

export { subDays, subWeeks, subMonths, subYears, addDays, addWeeks, addMonths, format }
