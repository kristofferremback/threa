import { useId, useMemo, useState } from "react"
import { CalendarClock } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { REMINDER_PRESETS, computeRemindAt, type ReminderPreset } from "@/lib/reminder-presets"
import { usePreferences } from "@/contexts"
import { formatFutureTime } from "@/lib/dates"

interface SchedulePickerProps {
  /**
   * Trigger control. The picker injects a default `Schedule` button when this
   * is omitted, but most callers want their own glyph (e.g. a calendar icon
   * sitting next to the send button).
   */
  trigger?: React.ReactNode
  /** Disabled state — propagated to both the trigger and the picker form. */
  disabled?: boolean
  /** Called with the chosen schedule date. Picker closes itself on submit. */
  onPick: (when: Date) => void
  /** Side hint — defaults to top so the popover opens above the composer. */
  side?: "top" | "bottom" | "left" | "right"
}

/**
 * Lightweight schedule-time picker shared by the composer entry-point and the
 * page edit modal. Reuses the reminder presets so timezone math + label
 * vocabulary stays consistent across surfaces.
 *
 * Custom path uses `<input type="datetime-local">` — small enough that we
 * don't need a full calendar widget for v1; users picking unusual times can
 * open the system picker. Past selections clamp to a 30s offset so the
 * server's clamp doesn't surprise the user with an immediate fire.
 */
/**
 * datetime-local needs YYYY-MM-DDTHH:mm in the user's local zone. Built fresh
 * each time the user enters custom mode — the composer is mounted for the
 * lifetime of a session, so anything memoized at mount goes stale within
 * minutes (a user opening the picker hours later would see a past datetime as
 * the default and a stale `min` constraint).
 */
function buildLocalDatetimeOneHourAhead(): string {
  const d = new Date(Date.now() + 60 * 60_000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function SchedulePicker({ trigger, disabled, onPick, side = "top" }: SchedulePickerProps) {
  const [open, setOpen] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [customValue, setCustomValue] = useState<string>("")
  const [customMin, setCustomMin] = useState<string>("")
  const inputId = useId()
  const { preferences } = usePreferences()

  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  const handlePreset = (preset: ReminderPreset) => {
    const when = computeRemindAt(preset, new Date(), timezone)
    onPick(when)
    setOpen(false)
    setCustomMode(false)
  }

  const handleCustomSubmit = () => {
    if (!customValue) return
    const when = new Date(customValue)
    if (Number.isNaN(when.getTime())) return
    // Clamp to 30s in the future so the server's 5s clamp doesn't surprise
    // a user who picked "now-ish" as a way of saying "send shortly".
    const minMs = Date.now() + 30_000
    onPick(when.getTime() < minMs ? new Date(minMs) : when)
    setOpen(false)
    setCustomMode(false)
    setCustomValue("")
  }

  const previewLabel = useMemo(() => {
    if (!customValue) return null
    const d = new Date(customValue)
    if (Number.isNaN(d.getTime())) return null
    return formatFutureTime(d, new Date(), { timezone })
  }, [customValue, timezone])

  return (
    <Popover
      open={open}
      // Guard the open transition so a custom trigger that doesn't itself
      // honor `disabled` can't bypass the disabled state. The default Button
      // fallback already disables click — this covers caller-supplied nodes.
      onOpenChange={(next) => {
        if (disabled) return
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Schedule send"
            className="h-[30px] w-[30px] shrink-0 p-0 rounded-md"
          >
            <CalendarClock className="h-4 w-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent side={side} align="end" className="w-64 p-2">
        {!customMode ? (
          <>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Schedule send</div>
            <div className="flex flex-col">
              {REMINDER_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handlePreset(preset)}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span>{preset.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatFutureTime(computeRemindAt(preset, new Date(), timezone), new Date(), { timezone })}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const dt = buildLocalDatetimeOneHourAhead()
                  setCustomMin(dt)
                  setCustomValue(dt)
                  setCustomMode(true)
                }}
                className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                Pick a time…
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="px-1 text-xs font-medium text-muted-foreground">
              Pick a time
            </label>
            <Input
              id={inputId}
              type="datetime-local"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              min={customMin}
              autoFocus
            />
            {previewLabel && <div className="px-1 text-xs text-muted-foreground">Sends {previewLabel}</div>}
            <div className="flex justify-between gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCustomMode(false)}>
                Back
              </Button>
              <Button type="button" size="sm" onClick={handleCustomSubmit} disabled={!customValue}>
                Schedule
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
