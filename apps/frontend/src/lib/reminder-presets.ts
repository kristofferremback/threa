/**
 * Re-exported from the shared scheduling lib. Keep this file for backward
 * compatibility — all existing imports still resolve. New code should import
 * from `@/lib/schedule-presets` directly.
 */

export type { SchedulePreset as ReminderPreset } from "@/lib/schedule-presets"
export { SCHEDULE_PRESETS as REMINDER_PRESETS, computeScheduledAt as computeRemindAt } from "@/lib/schedule-presets"
