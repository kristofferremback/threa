/**
 * Shared scheduling preset logic. Used by reminders and scheduled messages.
 * Preset math is timezone-aware via `Intl.DateTimeFormat` so "Tomorrow 9am"
 * means the user's local morning, not the browser's.
 */

export type SchedulePreset =
  | { label: string; kind: "duration"; minutes: number }
  | { label: string; kind: "calendar"; calendar: "tomorrow-9am" | "next-monday-9am" }

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { label: "In 15 minutes", kind: "duration", minutes: 15 },
  { label: "In 1 hour", kind: "duration", minutes: 60 },
  { label: "In 3 hours", kind: "duration", minutes: 180 },
  { label: "Tomorrow 9am", kind: "calendar", calendar: "tomorrow-9am" },
  { label: "Next Monday 9am", kind: "calendar", calendar: "next-monday-9am" },
]

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

function nextMondayAt9(now: Date, timezone: string): Date {
  const today = calendarInZone(now, timezone)
  const daysUntilMonday = today.weekday === 1 ? 7 : (1 - today.weekday + 7) % 7 || 7
  const target = calendarInZone(new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60_000), timezone)
  return buildZonedDate(timezone, target.y, target.m, target.d, 9, 0)
}

function tomorrowAt9(now: Date, timezone: string): Date {
  const tomorrow = calendarInZone(new Date(now.getTime() + 24 * 60 * 60_000), timezone)
  return buildZonedDate(timezone, tomorrow.y, tomorrow.m, tomorrow.d, 9, 0)
}

export function computeScheduledAt(preset: SchedulePreset, now: Date, timezone: string): Date {
  switch (preset.kind) {
    case "duration":
      return new Date(now.getTime() + preset.minutes * 60_000)
    case "calendar":
      return preset.calendar === "tomorrow-9am" ? tomorrowAt9(now, timezone) : nextMondayAt9(now, timezone)
  }
}
