import { useMemo } from "react"
import { usePreferences } from "@/contexts"
import { formatDisplayDate, formatTime, formatRelativeTime, formatFullDateTime } from "@/lib/dates"

/**
 * Hook that provides preference-aware date formatting functions.
 * Uses the current user's preferences from PreferencesContext.
 */
export function useFormattedDate() {
  const { preferences } = usePreferences()

  return useMemo(
    () => ({
      /**
       * Format a date according to user preferences.
       * @returns Formatted date string (e.g., "2025-01-15", "15/01/2025", or "01/15/2025")
       */
      formatDate: (date: Date) => formatDisplayDate(date, preferences ?? undefined),

      /**
       * Format time according to user preferences.
       * @returns Formatted time string (e.g., "14:30" or "2:30 PM")
       */
      formatTime: (date: Date) => formatTime(date, preferences ?? undefined),

      /**
       * Format a date relative to now using user time preferences.
       * @returns Relative time string (e.g., "yesterday 14:30", "Monday 2:30 PM")
       */
      formatRelative: (date: Date, now?: Date) => formatRelativeTime(date, now, preferences ?? undefined),

      /**
       * Format a full date-time for tooltips using user preferences.
       * @returns Full date-time string
       */
      formatFull: (date: Date) => formatFullDateTime(date, preferences ?? undefined),
    }),
    [preferences]
  )
}
