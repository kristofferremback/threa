import { useId, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, CalendarClock, ChevronRight } from "lucide-react"
import type { ScheduledMessageView } from "@threa/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { stripMarkdownToInline } from "@/lib/markdown"
import { formatFutureTime, formatSendCountdown, toDateTimeLocalValue } from "@/lib/dates"
import { useScheduledList, useCancelScheduled, useSendScheduledNow } from "@/hooks"
import { useIsMobile } from "@/hooks/use-mobile"
import { useLongPress } from "@/hooks/use-long-press"
import { REMINDER_PRESETS, computeRemindAt, type ReminderPreset } from "@/lib/reminder-presets"
import { ScheduledEditDialog } from "@/components/scheduled/scheduled-edit-dialog"
import { ScheduledActionDrawer } from "@/components/scheduled/scheduled-action-drawer"
import { ScheduledActions } from "@/components/scheduled/scheduled-actions"

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
  const [editing, setEditing] = useState<ScheduledMessageView | null>(null)
  // Lifted out of the row so the drawer stacks above the popover. Local
  // state inside `ScheduledRow` only worked when the popover stayed open,
  // which produced an obvious z-index fight (popover painting over the
  // bottom sheet). We instead close the popover when long-press fires and
  // render the drawer at the picker's top level, outside the popover tree.
  const [actionTarget, setActionTarget] = useState<ScheduledMessageView | null>(null)
  const inputId = useId()

  const { items } = useScheduledList(workspaceId, "pending", streamId)
  const cancelMutation = useCancelScheduled(workspaceId)
  const sendNowMutation = useSendScheduledNow(workspaceId)
  // Browser-local timezone everywhere in the UI — never use
  // `preferences.timezone` here, native pickers always operate in
  // device-local and any drift between the two silently shifts saved
  // times.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

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

  const handleEdit = (scheduled: ScheduledMessageView) => {
    // Close the popover first, then defer mounting the dialog to the next
    // tick. Same pointerdown that triggered the row click would otherwise
    // bubble to vaul's outside-click detection on the brand-new drawer
    // overlay and dismiss it immediately. Same defer pattern is used by
    // the action drawer below.
    setOpen(false)
    setTimeout(() => setEditing(scheduled), 0)
  }

  const handleRequestActions = (scheduled: ScheduledMessageView) => {
    // Long-press on a row routes here. Close the popover first so its
    // backdrop doesn't paint over the bottom sheet, then surface the drawer
    // (rendered at the top level below, outside the popover tree).
    setOpen(false)
    setTimeout(() => setActionTarget(scheduled), 0)
  }

  return (
    <>
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
              onEdit={handleEdit}
              onSendNow={(id) => sendNowMutation.mutate(id)}
              onCancel={(id) => cancelMutation.mutate(id)}
              onRequestActions={handleRequestActions}
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
                // Built fresh each time — the composer is mounted for the
                // lifetime of a session, so a memoized seed would go stale.
                const dt = toDateTimeLocalValue(new Date(Date.now() + 60 * 60_000))
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
      <ScheduledEditDialog workspaceId={workspaceId} scheduled={editing} onClose={() => setEditing(null)} />
      {actionTarget && (
        <ScheduledActionDrawer
          open
          onOpenChange={(next) => {
            if (!next) setActionTarget(null)
          }}
          scheduled={actionTarget}
          onEdit={() => {
            // Close the action drawer first, defer the edit-dialog mount to
            // the next tick — same reason as `handleEdit` above (vaul outside-
            // click detection vs. the click that triggered this transition).
            setActionTarget(null)
            setTimeout(() => setEditing(actionTarget), 0)
          }}
          onSendNow={(id) => sendNowMutation.mutate(id)}
          onCancel={(id) => cancelMutation.mutate(id)}
        />
      )}
    </>
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
  onEdit: (scheduled: ScheduledMessageView) => void
  onSendNow: (id: string) => void
  onCancel: (id: string) => void
  onRequestActions: (scheduled: ScheduledMessageView) => void
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
  onEdit,
  onSendNow,
  onCancel,
  onRequestActions,
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
                now={now}
                timezone={timezone}
                onEdit={onEdit}
                onSendNow={onSendNow}
                onCancel={onCancel}
                onRequestActions={onRequestActions}
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
  now: Date
  timezone: string
  onEdit: (scheduled: ScheduledMessageView) => void
  onSendNow: (id: string) => void
  onCancel: (id: string) => void
  /**
   * Mobile long-press handler — the picker hosts the action drawer at its
   * top level (above the popover) so we just bubble the request up; the
   * picker closes the popover and opens the drawer in one shot. Keeping
   * the drawer state out of the row is what fixes the popover-paints-over-
   * drawer z-index fight.
   */
  onRequestActions: (scheduled: ScheduledMessageView) => void
}

/**
 * Row inside the composer popover. Mirrors the `/scheduled` list-row:
 *   - Body click opens the edit dialog (same affordance as before).
 *   - Desktop hover reveals the Send-now / Edit / Cancel triplet via the
 *     shared `ScheduledActions` cluster — the popover used to expose those
 *     only behind a keyboard-unreachable click=edit, which felt
 *     inconsistent with the full list view.
 *   - Mobile keeps long-press → bottom-sheet drawer (no tiny tap targets).
 */
function ScheduledRow({ scheduled, now, timezone, onEdit, onSendNow, onCancel, onRequestActions }: ScheduledRowProps) {
  const isMobile = useIsMobile()
  const longPress = useLongPress({
    enabled: isMobile,
    onLongPress: () => onRequestActions(scheduled),
  })

  const preview = useMemo(
    () => stripMarkdownToInline(scheduled.contentMarkdown).trim() || "(empty)",
    [scheduled.contentMarkdown]
  )
  const scheduledFor = useMemo(() => new Date(scheduled.scheduledFor), [scheduled.scheduledFor])
  const label = formatSendCountdown(scheduledFor, now, { timezone })
  const attachmentCount = scheduled.attachmentIds.length

  return (
    <li>
      <div
        className={cn("group flex items-start gap-2 px-3 py-2 hover:bg-muted/60", longPress.isPressed && "bg-muted/60")}
        onTouchStart={longPress.handlers.onTouchStart}
        onTouchEnd={longPress.handlers.onTouchEnd}
        onTouchMove={longPress.handlers.onTouchMove}
        onContextMenu={longPress.handlers.onContextMenu}
      >
        <button
          type="button"
          onClick={() => onEdit(scheduled)}
          className="min-w-0 flex-1 text-left focus:outline-none focus-visible:bg-muted/60"
          title="Edit scheduled message"
        >
          <p className="text-sm line-clamp-2 break-words">{preview}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {label}
            {attachmentCount > 0 && <span className="ml-1.5">· {attachmentCount} 📎</span>}
          </p>
        </button>
        {!isMobile && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <ScheduledActions
              scheduled={scheduled}
              variant="hover-cluster"
              onEdit={() => onEdit(scheduled)}
              onSendNow={onSendNow}
              onCancel={onCancel}
            />
          </div>
        )}
      </div>
    </li>
  )
}
