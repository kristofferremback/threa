/**
 * Shared reminder-preset logic for the desktop hover popover, mobile sheet,
 * and Saved-view row popover. Preset math is timezone-aware via
 * `Intl.DateTimeFormat` so "Tomorrow 9am" means the user's local morning, not
 * the browser's.
 */

export interface ReminderPreset {
  label: string
  /** Positive: minutes from now. Negative sentinels pick calendar presets:
   *    -1 = tomorrow 09:00 in the user's timezone
   *    -2 = next Monday 09:00 in the user's timezone
   */
  minutes: number
}

export const REMINDER_PRESETS: ReminderPreset[] = [
  { label: "In 15 minutes", minutes: 15 },
  { label: "In 1 hour", minutes: 60 },
  { label: "In 3 hours", minutes: 180 },
  { label: "Tomorrow 9am", minutes: -1 },
  { label: "Next Monday 9am", minutes: -2 },
]

/** Resolve calendar parts (y/m/d + weekday index) as the user's timezone sees them. */
function calendarInZone(date: Date, timezone: string): { y: number; m: number; d: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    y: Number(get("year")),
    m: Number(get("month")) - 1,
    d: Number(get("day")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  }
}

/**
 * Build the UTC instant that a user in `timezone` would read as the given
 * local wall-clock time. Intl doesn't expose tz-offset lookup directly, so
 * we converge in two passes — enough to handle DST boundaries without a
 * dedicated date-fns-tz dep.
 */
function buildZonedDate(timezone: string, y: number, m: number, d: number, hours: number, minutes: number): Date {
  let candidate = new Date(Date.UTC(y, m, d, hours, minutes))
  const readLocal = (date: Date) => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date)
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0)
    return new Date(Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")))
  }
  const offset1 = readLocal(candidate).getTime() - candidate.getTime()
  candidate = new Date(candidate.getTime() - offset1)
  const offset2 = readLocal(candidate).getTime() - candidate.getTime()
  if (offset2 !== 0) candidate = new Date(candidate.getTime() - offset2)
  return candidate
}

export function computeRemindAt(preset: ReminderPreset, now: Date, timezone: string): Date {
  if (preset.minutes >= 0) {
    return new Date(now.getTime() + preset.minutes * 60_000)
  }
  const today = calendarInZone(now, timezone)
  if (preset.minutes === -1) {
    const tomorrow = calendarInZone(new Date(now.getTime() + 24 * 60 * 60_000), timezone)
    return buildZonedDate(timezone, tomorrow.y, tomorrow.m, tomorrow.d, 9, 0)
  }
  // Next Monday — skip today if already Monday.
  const daysUntilMonday = today.weekday === 1 ? 7 : (1 - today.weekday + 7) % 7 || 7
  const target = calendarInZone(new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60_000), timezone)
  return buildZonedDate(timezone, target.y, target.m, target.d, 9, 0)
}
