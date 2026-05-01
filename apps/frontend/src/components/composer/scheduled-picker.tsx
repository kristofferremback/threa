import { useCallback, useMemo, useState } from "react"
import { Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useLongPress } from "@/hooks/use-long-press"
import { useIsMobile } from "@/hooks/use-mobile"
import { stripMarkdownToInline } from "@/lib/markdown"
import { formatRelativeTime } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { SchedulePresetList, ScheduledActionsList } from "./schedule-ui"

export interface ScheduledPickerItem {
  id: string
  contentMarkdown: string | unknown
  attachmentIds?: string[]
  scheduledAt: string
  streamDisplayName: string | null
}

interface ScheduledPickerProps {
  scheduled: ScheduledPickerItem[]
  onScheduleOpen: () => void
  /** Called when the user triggers an action on a row (long-press on mobile, click on desktop). */
  onItemAction: (item: ScheduledPickerItem) => void
  onSendNow: (id: string) => void
  onDelete: (id: string) => void
  /** Desktop-only: called with the selected date when user picks a preset from the schedule popover. */
  onScheduleSelect?: (date: Date) => void
  /** Timezone for computing presets (required when onScheduleSelect is provided). */
  timezone?: string
  controlsDisabled?: boolean
  scheduleDisabled?: boolean
  size?: "compact" | "fab"
}

function getPreview(scheduled: ScheduledPickerItem): string {
  const contentMarkdown = typeof scheduled.contentMarkdown === "string" ? scheduled.contentMarkdown : ""
  const stripped = stripMarkdownToInline(contentMarkdown).trim()
  if (stripped.length > 0) return stripped
  const attachmentCount = scheduled.attachmentIds?.length ?? 0
  if (attachmentCount > 0) {
    return `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`
  }
  return "Empty message"
}

function ScheduledPickerRow({
  item,
  now,
  onAction,
}: {
  item: ScheduledPickerItem
  now: Date
  onAction: (item: ScheduledPickerItem) => void
}) {
  const isMobile = useIsMobile()
  const { handlers } = useLongPress({
    enabled: isMobile,
    onLongPress: () => onAction(item),
  })
  const preview = getPreview(item)

  return (
    <li>
      <div
        className="flex items-start gap-2 px-3 py-2 hover:bg-muted/60 cursor-pointer"
        {...(isMobile ? handlers : {})}
        onContextMenu={handlers.onContextMenu}
        onClick={isMobile ? undefined : () => onAction(item)}
      >
        <div className="flex-1 min-w-0">
          {item.streamDisplayName && (
            <p className="text-[11px] text-muted-foreground truncate mb-0.5">{item.streamDisplayName}</p>
          )}
          <p className="text-sm line-clamp-2 break-words">{preview}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {formatRelativeTime(new Date(item.scheduledAt), now, undefined, { terse: true })}
          </p>
        </div>
      </div>
    </li>
  )
}

export function ScheduledPicker({
  scheduled,
  onScheduleOpen,
  onItemAction,
  onSendNow,
  onDelete,
  onScheduleSelect,
  timezone,
  controlsDisabled = false,
  scheduleDisabled = false,
  size = "compact",
}: ScheduledPickerProps) {
  const [open, setOpen] = useState(false)
  const [actionItem, setActionItem] = useState<ScheduledPickerItem | null>(null)
  const [actionOpen, setActionOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const isMobile = useIsMobile()
  const count = scheduled.length
  const now = useMemo(() => new Date(), [open])

  const handleSchedule = useCallback(() => {
    if (isMobile || !onScheduleSelect) {
      setOpen(false)
      onScheduleOpen()
      return
    }
    setScheduleOpen(true)
  }, [isMobile, onScheduleSelect, onScheduleOpen])

  const handlePresetSelect = useCallback(
    (date: Date) => {
      setScheduleOpen(false)
      setOpen(false)
      onScheduleSelect?.(date)
    },
    [onScheduleSelect]
  )

  const handleRowAction = useCallback(
    (item: ScheduledPickerItem) => {
      setOpen(false)
      if (isMobile) {
        onItemAction(item)
      } else {
        setActionItem(item)
        setActionOpen(true)
      }
    },
    [isMobile, onItemAction]
  )

  const handleSendNow = useCallback(() => {
    if (actionItem) {
      setActionOpen(false)
      onSendNow(actionItem.id)
    }
  }, [actionItem, onSendNow])

  const handleDelete = useCallback(() => {
    if (actionItem) {
      setActionOpen(false)
      onDelete(actionItem.id)
    }
  }, [actionItem, onDelete])

  const handleEditRequest = useCallback(() => {
    if (actionItem) {
      setActionOpen(false)
      onItemAction(actionItem)
    }
  }, [actionItem, onItemAction])

  const triggerSizeClass = size === "fab" ? "h-[30px] w-[30px] rounded-md bg-background shadow-md" : "h-7 w-7"
  const triggerIconClass = size === "fab" ? "h-4 w-4" : "h-3.5 w-3.5"

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant={size === "fab" ? "outline" : "ghost"}
                size="icon"
                aria-label={count > 0 ? `Scheduled (${count})` : "Scheduled"}
                className={cn("relative shrink-0 p-0", triggerSizeClass)}
                disabled={controlsDisabled}
                onPointerDown={size === "fab" ? (e) => e.preventDefault() : undefined}
              >
                <Clock className={triggerIconClass} />
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
              onClick={handleSchedule}
              disabled={scheduleDisabled}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Schedule</span>
            </Button>
          </div>

          {scheduled.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No scheduled messages. Long-press the send button to schedule one.
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1" role="list">
              {scheduled.map((item) => (
                <ScheduledPickerRow key={item.id} item={item} now={now} onAction={handleRowAction} />
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      {/* Desktop action popover — opens when clicking a row on desktop */}
      {!isMobile && (
        <Popover open={actionOpen} onOpenChange={setActionOpen}>
          <PopoverTrigger asChild>
            <span className="hidden" />
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-56 p-1">
            <div className="flex flex-col gap-0">
              <ScheduledActionsList
                variant="popover"
                onSendNow={handleSendNow}
                onEdit={handleEditRequest}
                onChangeTime={handleEditRequest}
                onDelete={handleDelete}
              />
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Desktop schedule presets popover — opens when clicking "Schedule" on desktop */}
      {!isMobile && onScheduleSelect && timezone !== undefined && (
        <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <PopoverTrigger asChild>
            <span className="hidden" />
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-64 p-1">
            <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Schedule send
            </div>
            <SchedulePresetList
              variant="popover"
              onSelect={handlePresetSelect}
              onCustomClick={() => {
                setScheduleOpen(false)
                onScheduleOpen()
              }}
              now={now}
              timezone={timezone}
            />
          </PopoverContent>
        </Popover>
      )}
    </>
  )
}
