import { useState } from "react"
import { Bell, BellOff, Archive, Check, Clock, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import type { SavedMessageView, SavedStatus } from "@threa/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/contexts"
import { useSaveMessage, useUpdateSaved, useDeleteSaved } from "@/hooks/use-saved"
import { ReminderBadge } from "@/components/saved/reminder-badge"

interface ReminderPopoverContentProps {
  workspaceId: string
  messageId: string
  saved: SavedMessageView | null
}

interface ReminderPreset {
  label: string
  minutes: number
}

const PRESETS: ReminderPreset[] = [
  { label: "In 15 minutes", minutes: 15 },
  { label: "In 1 hour", minutes: 60 },
  { label: "In 3 hours", minutes: 180 },
  { label: "Tomorrow 9am", minutes: -1 }, // sentinel — computed below
  { label: "Next Monday 9am", minutes: -2 }, // sentinel — computed below
]

/**
 * Resolve the calendar components of `date` as the user's IANA timezone
 * would see them (year / month / day / weekday). Uses `Intl.DateTimeFormat`
 * which ships with the platform — no date-fns-tz dep needed.
 */
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
 * Binary-search the UTC instant whose timezone-local calendar rendering
 * matches the requested (y, m, d, hh:mm). Intl doesn't expose a tz → offset
 * API directly, so we probe at the target calendar day's noon UTC, read back
 * the calendar day in the target timezone, and nudge the candidate until it
 * lands on the requested local wall-clock time. This avoids pulling in
 * date-fns-tz for a handful of presets.
 */
function buildZonedDate(timezone: string, y: number, m: number, d: number, hours: number, minutes: number): Date {
  // Start from UTC midnight of the requested day.
  let candidate = new Date(Date.UTC(y, m, d, hours, minutes))

  // The candidate's wall clock in `timezone` may be off by the offset
  // relative to UTC. Compute the offset by formatting and correcting once.
  const partsAt = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date)
  const readLocal = (date: Date) => {
    const p = partsAt(date)
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0)
    return new Date(Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")))
  }

  // Offset = local-wall-clock-as-if-UTC − actual UTC instant.
  const offsetMs = readLocal(candidate).getTime() - candidate.getTime()
  candidate = new Date(candidate.getTime() - offsetMs)

  // DST boundaries can shift the offset by an hour; one more pass converges.
  const offsetMs2 = readLocal(candidate).getTime() - candidate.getTime()
  if (offsetMs2 !== 0) candidate = new Date(candidate.getTime() - offsetMs2)

  return candidate
}

function computeRemindAt(preset: ReminderPreset, now: Date, timezone: string): Date {
  if (preset.minutes >= 0) {
    return new Date(now.getTime() + preset.minutes * 60_000)
  }

  const today = calendarInZone(now, timezone)

  if (preset.minutes === -1) {
    // Tomorrow 09:00 in the user's timezone.
    const tomorrow = calendarInZone(new Date(now.getTime() + 24 * 60 * 60_000), timezone)
    return buildZonedDate(timezone, tomorrow.y, tomorrow.m, tomorrow.d, 9, 0)
  }

  // Next Monday 09:00 in the user's timezone (skip today if already Monday).
  const daysUntilMonday = today.weekday === 1 ? 7 : (1 - today.weekday + 7) % 7 || 7
  const target = calendarInZone(new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60_000), timezone)
  return buildZonedDate(timezone, target.y, target.m, target.d, 9, 0)
}

export function ReminderPopoverContent({ workspaceId, messageId, saved }: ReminderPopoverContentProps) {
  const { preferences } = usePreferences()
  // Fall back to the system timezone if the user hasn't set one — matches
  // how `formatFutureTime` treats an absent timezone.
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const saveMutation = useSaveMessage(workspaceId)
  const updateMutation = useUpdateSaved(workspaceId)
  const deleteMutation = useDeleteSaved(workspaceId)
  const [customOpen, setCustomOpen] = useState(false)
  const [customDateTime, setCustomDateTime] = useState("")

  const setReminder = (date: Date | null) => {
    if (!saved) {
      saveMutation.mutate(
        { messageId, remindAt: date?.toISOString() ?? null },
        {
          onSuccess: () => toast.success(date ? "Reminder set" : "Saved"),
          onError: () => toast.error("Could not save"),
        }
      )
      return
    }
    updateMutation.mutate(
      { savedId: saved.id, input: { remindAt: date?.toISOString() ?? null } },
      {
        onSuccess: () => toast.success(date ? "Reminder set" : "Reminder cleared"),
        onError: () => toast.error("Could not update reminder"),
      }
    )
  }

  const setStatus = (status: SavedStatus, successLabel: string) => {
    if (!saved) return
    updateMutation.mutate(
      { savedId: saved.id, input: { status } },
      {
        onSuccess: () => toast.success(successLabel),
        onError: () => toast.error("Could not update"),
      }
    )
  }

  const remove = () => {
    if (!saved) return
    deleteMutation.mutate(saved.id, {
      onSuccess: () => toast.success("Removed from saved"),
      onError: () => toast.error("Could not remove"),
    })
  }

  const handleCustom = () => {
    if (!customDateTime) return
    const parsed = new Date(customDateTime)
    if (isNaN(parsed.getTime())) {
      toast.error("Invalid date")
      return
    }
    setReminder(parsed)
    setCustomOpen(false)
    setCustomDateTime("")
  }

  const status = saved?.status ?? null

  return (
    <div className="flex flex-col divide-y">
      <div className="flex items-center justify-between px-3 py-2 text-sm">
        <span className="font-medium">
          {saved ? "Saved" : "Save for later"}
          {status && status !== "saved" && (
            <span className="ml-1.5 text-xs text-muted-foreground capitalize">· {status}</span>
          )}
        </span>
        {saved && <ReminderBadge remindAt={saved.remindAt} reminderSentAt={saved.reminderSentAt} className="text-xs" />}
      </div>

      <div className="p-1">
        <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Remind me
        </div>
        {PRESETS.map((preset) => (
          <PopoverMenuButton
            key={preset.label}
            onClick={() => setReminder(computeRemindAt(preset, new Date(), timezone))}
          >
            <Bell className="h-3.5 w-3.5" />
            {preset.label}
          </PopoverMenuButton>
        ))}
        <PopoverMenuButton onClick={() => setCustomOpen((o) => !o)}>
          <Bell className="h-3.5 w-3.5" />
          Pick a time…
        </PopoverMenuButton>
        {customOpen && (
          <div className="flex items-center gap-1.5 px-2 py-1">
            <input
              type="datetime-local"
              value={customDateTime}
              onChange={(e) => setCustomDateTime(e.target.value)}
              className="flex-1 text-xs rounded border bg-background px-1.5 py-1"
            />
            <Button size="sm" className="h-7 text-xs" onClick={handleCustom}>
              Set
            </Button>
          </div>
        )}
        {saved?.remindAt && (
          <PopoverMenuButton onClick={() => setReminder(null)}>
            <BellOff className="h-3.5 w-3.5" />
            Clear reminder
          </PopoverMenuButton>
        )}
      </div>

      {saved && (
        <div className="p-1">
          {status === "saved" && (
            <>
              <PopoverMenuButton onClick={() => setStatus("done", "Marked done")}>
                <Check className="h-3.5 w-3.5" />
                Mark done
              </PopoverMenuButton>
              <PopoverMenuButton onClick={() => setStatus("archived", "Archived")}>
                <Archive className="h-3.5 w-3.5" />
                Archive
              </PopoverMenuButton>
            </>
          )}
          {status !== "saved" && (
            <PopoverMenuButton onClick={() => setStatus("saved", "Restored")}>
              <Undo2 className="h-3.5 w-3.5" />
              Move back to Saved
            </PopoverMenuButton>
          )}
          <PopoverMenuButton
            onClick={remove}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </PopoverMenuButton>
        </div>
      )}
    </div>
  )
}

interface PopoverMenuButtonProps {
  children: React.ReactNode
  onClick: () => void
  className?: string
}

function PopoverMenuButton({ children, onClick, className }: PopoverMenuButtonProps) {
  // Shadcn Button with ghost variant (INV-14) — styled as a dense menu row.
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn("w-full justify-start gap-2 h-auto px-2 py-1.5 text-sm font-normal", className)}
    >
      {children}
    </Button>
  )
}
