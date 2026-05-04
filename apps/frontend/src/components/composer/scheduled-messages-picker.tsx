import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CalendarClock, Trash2 } from "lucide-react"
import type { ScheduledMessageView } from "@threa/types"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { stripMarkdownToInline } from "@/lib/markdown"
import { formatFutureTime } from "@/lib/dates"
import { usePreferences } from "@/contexts"
import { useScheduledList, useCancelScheduled } from "@/hooks"

interface ScheduledMessagesPickerProps {
  workspaceId: string
  /** Scope the popover to a single stream (the composer's current stream). */
  streamId: string
  /** When `controlsDisabled`, the trigger button is disabled (e.g. composer is sending). */
  controlsDisabled?: boolean
  /**
   * Visual size of the trigger button. `compact` matches the 7x7 toolbar row on
   * desktop inline; `fab` matches the 30x30 floating drawer in expanded mode.
   */
  size?: "compact" | "fab"
}

/**
 * In-composer popover that lists pending scheduled messages for the current
 * stream so users can glance at what's queued without leaving the composer
 * (Journey 2 in the plan). Each row links to the stream's full scheduled
 * page; cancel from the row is the quick action because reschedule/edit
 * needs the full edit modal which only the page hosts in v1.
 */
export function ScheduledMessagesPicker({
  workspaceId,
  streamId,
  controlsDisabled = false,
  size = "compact",
}: ScheduledMessagesPickerProps) {
  const [open, setOpen] = useState(false)
  const { items } = useScheduledList(workspaceId, "pending", streamId)
  const cancelMutation = useCancelScheduled(workspaceId)
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  const count = items.length
  // Re-anchor the relative-time labels to "now" each time the popover opens.
  // The list isn't re-rendered minute-by-minute (that would noise the UI for
  // dozens of rows); a fresh anchor per open is plenty.
  const now = useMemo(() => new Date(), [open])

  const triggerSizeClass = size === "fab" ? "h-[30px] w-[30px] rounded-md bg-background shadow-md" : "h-7 w-7"
  const triggerIconClass = size === "fab" ? "h-4 w-4" : "h-3.5 w-3.5"

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
                // Subtle presence dot — same convention as StashedDraftsPicker.
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
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
          <p className="text-sm font-medium">
            Scheduled
            {count > 0 && <span className="text-muted-foreground font-normal ml-1.5">({count})</span>}
          </p>
          <Link
            to={`/w/${workspaceId}/scheduled`}
            onClick={() => setOpen(false)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all →
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing queued for this stream yet. Type a message and use the schedule button to queue one.
          </div>
        ) : (
          <ul className="max-h-64 overflow-y-auto py-1" role="list">
            {items.map((scheduled) => (
              <ScheduledRow
                key={scheduled.id}
                scheduled={scheduled}
                workspaceId={workspaceId}
                now={now}
                timezone={timezone}
                onClose={() => setOpen(false)}
                onCancel={(id) => cancelMutation.mutate(id)}
              />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
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
  // Sub-1m falls through to "Sending soon" rather than counting down (matches
  // the page convention so the user isn't stressed by 30, 29, 28…).
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
