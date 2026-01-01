/**
 * Centralized date utilities using date-fns.
 *
 * All date formatting and manipulation should go through this module to:
 * 1. Enable future user preference support (locale, format preferences)
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
  isYesterday,
  differenceInDays,
  startOfDay,
} from "date-fns"

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
 * Format a date for human-readable display.
 * Example: "Jan 15, 2025"
 */
export function formatDisplayDate(date: Date): string {
  return format(date, "MMM d, yyyy")
}

/**
 * Format time in 24-hour format.
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

/**
 * Format a date relative to now (e.g., "yesterday 14:30", "Monday 09:00").
 * Uses locale-aware formatting for day names and dates.
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

  // Same day: just show time
  if (isSameDay(date, now)) {
    return time
  }

  // Yesterday
  if (isYesterday(date)) {
    return `yesterday ${time}`
  }

  // Within the last week: show day name
  const daysAgo = differenceInDays(startOfDay(now), startOfDay(date))
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

/**
 * Format a full date-time for tooltips.
 * Example: "Wednesday, January 15, 2025, 14:30"
 */
export function formatFullDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
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
