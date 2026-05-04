import { useId, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, CalendarClock, ChevronRight, Trash2 } from "lucide-react"
import type { ScheduledMessageView } from "@threa/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { stripMarkdownToInline } from "@/lib/markdown"
import { formatFutureTime } from "@/lib/dates"
import { usePreferences } from "@/contexts"
import { useScheduledList, useCancelScheduled } from "@/hooks"
import { REMINDER_PRESETS, computeRemindAt, type ReminderPreset } from "@/lib/reminder-presets"

interface ScheduledMessagesPickerProps {
  workspaceId: string
  /** Scope the popover to a single stream (the composer's current stream). */
  streamId: string
  /** True when the composer has something worth scheduling — controls the "Schedule send" button. */
  canSchedule: boolean
  /** Called when the user picks a time. Composer-side handler runs the schedule mutation. */
  onSchedule: (when: Date) => void
  /** When `controlsDisabled`, the trigger button is disabled (e.g. composer is sending). */
  controlsDisabled?: boolean
  /**
   * Visual size of the trigger button. `compact` matches the 7x7 toolbar row on
   * desktop inline; `fab` matches the 30x30 floating drawer in expanded mode.
   */
  size?: "compact" | "fab"
}

type Mode = "list" | "picking"

/**
 * datetime-local needs YYYY-MM-DDTHH:mm in the user's local zone. Built fresh
 * each time the user enters picking mode — the composer is mounted for the
 * lifetime of a session, so anything memoized at mount goes stale within
 * minutes (a user opening the picker hours later would see a past datetime
 * as the default and a stale `min` constraint).
 */
function buildLocalDatetimeOneHourAhead(): string {
  const d = new Date(Date.now() + 60 * 60_000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Unified scheduled-messages picker for the composer toolbar (Journey 2 in
 * the plan). Mirrors the StashedDraftsPicker shape: single trigger button
 * with a presence dot when there are pending sends, popover with an action
 * in the header and a list below.
 *
 * Two modes share the popover:
 *   - **list**: pending rows for this stream + a "Schedule send" button in
 *     the header. Clicking a row links to the full /scheduled page; the row
 *     trash icon cancels.
 *   - **picking**: preset chips + custom datetime input. Picking a time
 *     calls `onSchedule(when)` and closes the popover. Back returns to list.
 *
 * Folding both into one button avoids the "two scheduling icons in the
 * composer" smell — the action and the inventory live behind a single
 * affordance.
 */
export function ScheduledMessagesPicker({
  workspaceId,
  streamId,
  canSchedule,
  onSchedule,
  controlsDisabled = false,
  size = "compact",
}: ScheduledMessagesPickerProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>("list")
  const [customValue, setCustomValue] = useState<string>("")
  const [customMin, setCustomMin] = useState<string>("")
  const [showCustom, setShowCustom] = useState(false)
  const inputId = useId()

  const { items } = useScheduledList(workspaceId, "pending", streamId)
  const cancelMutation = useCancelScheduled(workspaceId)
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  const count = items.length
  // Re-anchor relative-time labels each time the popover opens.
  const now = useMemo(() => new Date(), [open])

  const triggerSizeClass = size === "fab" ? "h-[30px] w-[30px] rounded-md bg-background shadow-md" : "h-7 w-7"
  const triggerIconClass = size === "fab" ? "h-4 w-4" : "h-3.5 w-3.5"

  const resetToList = () => {
    setMode("list")
    setShowCustom(false)
    setCustomValue("")
  }

  const handleOpenChange = (next: boolean) => {
    if (controlsDisabled) return
    setOpen(next)
    if (!next) resetToList()
  }

  const enterPickingMode = () => {
    setMode("picking")
    setShowCustom(false)
  }

  const handlePreset = (preset: ReminderPreset) => {
    const when = computeRemindAt(preset, new Date(), timezone)
    onSchedule(when)
    setOpen(false)
    resetToList()
  }

  const handleCustomSubmit = () => {
    if (!customValue) return
    const when = new Date(customValue)
    if (Number.isNaN(when.getTime())) return
    // Clamp 30s into the future so the server's 5s clamp doesn't surprise a
    // user picking "now-ish" as a way of saying "send shortly".
    const minMs = Date.now() + 30_000
    onSchedule(when.getTime() < minMs ? new Date(minMs) : when)
    setOpen(false)
    resetToList()
  }

  const previewLabel = useMemo(() => {
    if (!customValue) return null
    const d = new Date(customValue)
    if (Number.isNaN(d.getTime())) return null
    return formatFutureTime(d, new Date(), { timezone })
  }, [customValue, timezone])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={size === "fab" ? "outline" : "ghost"}
              size="icon"
              aria-label={count > 0 ? `Scheduled (${count} pending)` : "Scheduled"}
              className={cn("relative shrink-0 p-0", triggerSizeClass)}
              disabled={controlsDisabled}
              onPointerDown={size === "fab" ? (e) => e.preventDefault() : undefined}
            >
              <CalendarClock className={triggerIconClass} />
              {count > 0 && (
                <span
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/60 pointer-events-none"
                  aria-hidden
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Scheduled
        </TooltipContent>
      </Tooltip>

      <PopoverContent align="end" side="top" className="w-80 p-0">
        {mode === "list" ? (
          <ListMode
            workspaceId={workspaceId}
            items={items}
            count={count}
            now={now}
            timezone={timezone}
            canSchedule={canSchedule}
            onClose={() => handleOpenChange(false)}
            onSchedulePress={enterPickingMode}
            onCancel={(id) => cancelMutation.mutate(id)}
          />
        ) : (
          <PickingMode
            timezone={timezone}
            inputId={inputId}
            showCustom={showCustom}
            customValue={customValue}
            customMin={customMin}
            previewLabel={previewLabel}
            onBack={resetToList}
            onPreset={handlePreset}
            onShowCustom={() => {
              const dt = buildLocalDatetimeOneHourAhead()
              setCustomMin(dt)
              setCustomValue(dt)
              setShowCustom(true)
            }}
            onCustomChange={setCustomValue}
            onCustomSubmit={handleCustomSubmit}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

interface ListModeProps {
  workspaceId: string
  items: ScheduledMessageView[]
  count: number
  now: Date
  timezone: string
  canSchedule: boolean
  onClose: () => void
  onSchedulePress: () => void
  onCancel: (id: string) => void
}

function ListMode({
  workspaceId,
  items,
  count,
  now,
  timezone,
  canSchedule,
  onClose,
  onSchedulePress,
  onCancel,
}: ListModeProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
        <p className="text-sm font-medium">
          Scheduled
          {count > 0 && <span className="text-muted-foreground font-normal ml-1.5">({count})</span>}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-1 text-xs"
          onClick={onSchedulePress}
          disabled={!canSchedule}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          <span>Schedule send</span>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          {canSchedule
            ? "Nothing queued for this stream yet. Use Schedule send to queue this message for later."
            : "Nothing queued for this stream yet. Type a message and use Schedule send to queue one."}
        </div>
      ) : (
        <>
          <ul className="max-h-64 overflow-y-auto py-1" role="list">
            {items.map((scheduled) => (
              <ScheduledRow
                key={scheduled.id}
                scheduled={scheduled}
                workspaceId={workspaceId}
                now={now}
                timezone={timezone}
                onClose={onClose}
                onCancel={onCancel}
              />
            ))}
          </ul>
          <div className="border-t px-3 py-1.5 text-right">
            <Link
              to={`/w/${workspaceId}/scheduled`}
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              View all →
            </Link>
          </div>
        </>
      )}
    </>
  )
}

interface PickingModeProps {
  timezone: string
  inputId: string
  showCustom: boolean
  customValue: string
  customMin: string
  previewLabel: string | null
  onBack: () => void
  onPreset: (preset: ReminderPreset) => void
  onShowCustom: () => void
  onCustomChange: (value: string) => void
  onCustomSubmit: () => void
}

function PickingMode({
  timezone,
  inputId,
  showCustom,
  customValue,
  customMin,
  previewLabel,
  onBack,
  onPreset,
  onShowCustom,
  onCustomChange,
  onCustomSubmit,
}: PickingModeProps) {
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <p className="text-sm font-medium">Schedule send</p>
      </div>

      {!showCustom ? (
        <div className="flex flex-col py-1">
          {REMINDER_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onPreset(preset)}
              className="flex items-center justify-between rounded-md mx-1 px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span>{preset.label}</span>
              <span className="text-xs text-muted-foreground">
                {formatFutureTime(computeRemindAt(preset, new Date(), timezone), new Date(), { timezone })}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={onShowCustom}
            className="rounded-md mx-1 px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            Pick a time…
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-3">
          <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
            Pick a time
          </label>
          <Input
            id={inputId}
            type="datetime-local"
            value={customValue}
            onChange={(e) => onCustomChange(e.target.value)}
            min={customMin}
            autoFocus
          />
          {previewLabel && <div className="text-xs text-muted-foreground">Sends {previewLabel}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" onClick={onCustomSubmit} disabled={!customValue}>
              Schedule
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

interface ScheduledRowProps {
  scheduled: ScheduledMessageView
  workspaceId: string
  now: Date
  timezone: string
  onClose: () => void
  onCancel: (id: string) => void
}

function ScheduledRow({ scheduled, workspaceId, now, timezone, onClose, onCancel }: ScheduledRowProps) {
  const preview = useMemo(
    () => stripMarkdownToInline(scheduled.contentMarkdown).trim() || "(empty)",
    [scheduled.contentMarkdown]
  )
  const scheduledFor = useMemo(() => new Date(scheduled.scheduledFor), [scheduled.scheduledFor])
  const rawLabel = formatFutureTime(scheduledFor, now, { timezone })
  const label = /^\d+m$/.test(rawLabel) && Number(rawLabel.replace("m", "")) <= 1 ? "Sending soon" : rawLabel
  const attachmentCount = scheduled.attachmentIds.length

  return (
    <li className="group/row">
      <div className="flex items-start gap-2 px-3 py-2 hover:bg-muted/60 focus-within:bg-muted/60">
        <Link
          to={`/w/${workspaceId}/scheduled`}
          onClick={onClose}
          className="flex-1 min-w-0 text-left focus:outline-none"
        >
          <p className="text-sm line-clamp-2 break-words">{preview}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {label}
            {attachmentCount > 0 && <span className="ml-1.5">· {attachmentCount} 📎</span>}
          </p>
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Cancel scheduled message"
          className="h-7 w-7 shrink-0 opacity-0 group-hover/row:opacity-100 focus:opacity-100 max-sm:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onCancel(scheduled.id)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  )
}
