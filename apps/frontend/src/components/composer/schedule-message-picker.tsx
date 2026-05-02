import { useMemo, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import {
  Calendar as CalendarIcon,
  CalendarClock,
  ChevronLeft,
  Clock,
  Pause,
  Pencil,
  Play,
  Send,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { ScheduledMessageStatuses, type ScheduledMessageView } from "@threa/types"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePreferencesOptional } from "@/contexts/preferences-context"
import { REMINDER_PRESETS } from "@/lib/reminder-presets"
import type { ReminderPreset } from "@/lib/reminder-presets"
import { formatRelativeTime } from "@/lib/dates"
import { stripMarkdownToInline } from "@/lib/markdown"
import { cn } from "@/lib/utils"

interface ScheduleMessagePickerProps {
  canSchedule: boolean
  disabled?: boolean
  onSchedule: (date: Date) => void
  scheduledMessages?: ScheduledMessageView[]
  inFlightId?: string | null
  onEdit?: (item: ScheduledMessageView) => void
  onPause?: (item: ScheduledMessageView) => void
  onResume?: (item: ScheduledMessageView) => void
  onSendNow?: (item: ScheduledMessageView) => void
  onDelete?: (item: ScheduledMessageView) => void
  size?: "compact" | "fab"
}

export function ScheduleMessagePicker({
  canSchedule,
  disabled = false,
  onSchedule,
  scheduledMessages = [],
  inFlightId = null,
  onEdit,
  onPause,
  onResume,
  onSendNow,
  onDelete,
  size = "compact",
}: ScheduleMessagePickerProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const controlsDisabled = disabled
  const triggerSizeClass = size === "fab" ? "h-[30px] w-[30px] rounded-md bg-background shadow-md" : "h-7 w-7"
  const triggerIconClass = size === "fab" ? "h-4 w-4" : "h-3.5 w-3.5"
  const count = scheduledMessages.length

  if (isMobile) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <ScheduleTriggerButton
              size={size}
              triggerSizeClass={triggerSizeClass}
              triggerIconClass={triggerIconClass}
              disabled={controlsDisabled}
              onClick={() => setOpen(true)}
              count={count}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Scheduled messages
          </TooltipContent>
        </Tooltip>
        <ScheduleDrawer
          open={open}
          onOpenChange={setOpen}
          canSchedule={canSchedule}
          scheduledMessages={scheduledMessages}
          inFlightId={inFlightId}
          onSchedule={onSchedule}
          onEdit={onEdit}
          onPause={onPause}
          onResume={onResume}
          onSendNow={onSendNow}
          onDelete={onDelete}
        />
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <ScheduleTriggerButton
              size={size}
              triggerSizeClass={triggerSizeClass}
              triggerIconClass={triggerIconClass}
              disabled={controlsDisabled}
              count={count}
            />
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Scheduled messages
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" side="top" className="w-80 p-0">
        <SchedulePopoverContent
          canSchedule={canSchedule}
          scheduledMessages={scheduledMessages}
          inFlightId={inFlightId}
          onEdit={onEdit}
          onPause={onPause}
          onResume={onResume}
          onSendNow={onSendNow}
          onDelete={onDelete}
          onSchedule={(date) => {
            onSchedule(date)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function ScheduleTriggerButton({
  size,
  triggerSizeClass,
  triggerIconClass,
  disabled,
  onClick,
  count = 0,
}: {
  size: "compact" | "fab"
  triggerSizeClass: string
  triggerIconClass: string
  disabled: boolean
  onClick?: () => void
  count?: number
}) {
  return (
    <Button
      type="button"
      variant={size === "fab" ? "outline" : "ghost"}
      size="icon"
      aria-label="Schedule message"
      className={cn("relative shrink-0 p-0", triggerSizeClass)}
      disabled={disabled}
      onClick={onClick}
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
  )
}

function ScheduleDrawer({
  open,
  onOpenChange,
  canSchedule,
  scheduledMessages,
  inFlightId,
  onSchedule,
  onEdit,
  onPause,
  onResume,
  onSendNow,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  canSchedule: boolean
  scheduledMessages: ScheduledMessageView[]
  inFlightId: string | null
  onSchedule: (date: Date) => void
  onEdit?: (item: ScheduledMessageView) => void
  onPause?: (item: ScheduledMessageView) => void
  onResume?: (item: ScheduledMessageView) => void
  onSendNow?: (item: ScheduledMessageView) => void
  onDelete?: (item: ScheduledMessageView) => void
}) {
  const [mode, setMode] = useState<"overview" | "schedule">("overview")
  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) setMode("overview")
      }}
    >
      <DrawerContent className="max-h-[85vh]">
        <div className="flex flex-col px-5 pt-3 pb-6 pb-safe">
          {mode === "schedule" ? (
            <ScheduleSheetOptions
              onBack={() => setMode("overview")}
              onSchedule={(date) => {
                onSchedule(date)
                onOpenChange(false)
                setMode("overview")
              }}
            />
          ) : (
            <ScheduleOverview
              mobile
              canSchedule={canSchedule}
              scheduledMessages={scheduledMessages}
              inFlightId={inFlightId}
              onStartSchedule={() => setMode("schedule")}
              onEdit={onEdit}
              onPause={onPause}
              onResume={onResume}
              onSendNow={onSendNow}
              onDelete={onDelete}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function SchedulePopoverContent({
  canSchedule,
  scheduledMessages,
  inFlightId,
  onSchedule,
  onEdit,
  onPause,
  onResume,
  onSendNow,
  onDelete,
}: {
  canSchedule: boolean
  scheduledMessages: ScheduledMessageView[]
  inFlightId: string | null
  onSchedule: (date: Date) => void
  onEdit?: (item: ScheduledMessageView) => void
  onPause?: (item: ScheduledMessageView) => void
  onResume?: (item: ScheduledMessageView) => void
  onSendNow?: (item: ScheduledMessageView) => void
  onDelete?: (item: ScheduledMessageView) => void
}) {
  const [mode, setMode] = useState<"overview" | "schedule">("overview")
  if (mode === "schedule") {
    return (
      <ScheduleOptions
        onBack={() => setMode("overview")}
        onSchedule={(date) => {
          onSchedule(date)
          setMode("overview")
        }}
      />
    )
  }

  return (
    <ScheduleOverview
      canSchedule={canSchedule}
      scheduledMessages={scheduledMessages}
      inFlightId={inFlightId}
      onStartSchedule={() => setMode("schedule")}
      onEdit={onEdit}
      onPause={onPause}
      onResume={onResume}
      onSendNow={onSendNow}
      onDelete={onDelete}
    />
  )
}

function ScheduleOverview({
  canSchedule,
  scheduledMessages,
  inFlightId,
  onStartSchedule,
  onEdit,
  onPause,
  onResume,
  onSendNow,
  onDelete,
  mobile = false,
}: {
  canSchedule: boolean
  scheduledMessages: ScheduledMessageView[]
  inFlightId: string | null
  onStartSchedule: () => void
  onEdit?: (item: ScheduledMessageView) => void
  onPause?: (item: ScheduledMessageView) => void
  onResume?: (item: ScheduledMessageView) => void
  onSendNow?: (item: ScheduledMessageView) => void
  onDelete?: (item: ScheduledMessageView) => void
  mobile?: boolean
}) {
  return (
    <div className={cn("flex flex-col", mobile ? "gap-3" : "divide-y")}>
      <div className={cn("flex items-center justify-between gap-2", mobile ? "mb-1" : "px-3 py-2 border-b")}>
        <p className={cn(mobile ? "text-lg font-semibold" : "text-sm font-medium")}>
          Scheduled
          {scheduledMessages.length > 0 && (
            <span className="text-muted-foreground font-normal ml-1.5">({scheduledMessages.length})</span>
          )}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-1 text-xs"
          onClick={onStartSchedule}
          disabled={!canSchedule}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          <span>Schedule current</span>
        </Button>
      </div>

      {scheduledMessages.length === 0 ? (
        <div className={cn("text-center text-xs text-muted-foreground", mobile ? "py-8" : "px-3 py-6")}>
          No scheduled messages in this stream.
        </div>
      ) : (
        <ul className={cn("overflow-y-auto py-1", mobile ? "max-h-[55vh]" : "max-h-72")} role="list">
          {scheduledMessages.map((item) => (
            <ScheduledMessageRow
              key={item.id}
              item={item}
              disabled={inFlightId === item.id}
              onEdit={onEdit}
              onPause={onPause}
              onResume={onResume}
              onSendNow={onSendNow}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ScheduledMessageRow({
  item,
  disabled,
  onEdit,
  onPause,
  onResume,
  onSendNow,
  onDelete,
}: {
  item: ScheduledMessageView
  disabled: boolean
  onEdit?: (item: ScheduledMessageView) => void
  onPause?: (item: ScheduledMessageView) => void
  onResume?: (item: ScheduledMessageView) => void
  onSendNow?: (item: ScheduledMessageView) => void
  onDelete?: (item: ScheduledMessageView) => void
}) {
  const sent = item.status === ScheduledMessageStatuses.SENT
  return (
    <li className="group/row">
      <div className="flex items-start gap-2 px-3 py-2 hover:bg-muted/60 focus-within:bg-muted/60">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit?.(item)}>
          <p className="text-sm line-clamp-2 break-words">{previewScheduled(item)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="capitalize">{item.status}</span>
            <span className="mx-1">·</span>
            {sent && item.sentAt
              ? `Sent ${formatRelativeTime(new Date(item.sentAt), new Date(), undefined, { terse: true })}`
              : formatScheduledAt(item.scheduledAt)}
          </p>
        </button>
        {!sent && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
            <MiniAction label="Edit" icon={Pencil} disabled={disabled} onClick={() => onEdit?.(item)} />
            {item.status === ScheduledMessageStatuses.PAUSED ? (
              <MiniAction label="Resume" icon={Play} disabled={disabled} onClick={() => onResume?.(item)} />
            ) : (
              <MiniAction label="Pause" icon={Pause} disabled={disabled} onClick={() => onPause?.(item)} />
            )}
            <MiniAction label="Send now" icon={Send} disabled={disabled} onClick={() => onSendNow?.(item)} />
            <MiniAction destructive label="Delete" icon={Trash2} disabled={disabled} onClick={() => onDelete?.(item)} />
          </div>
        )}
      </div>
    </li>
  )
}

function MiniAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  destructive = false,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn("h-7 w-7", destructive && "text-destructive hover:text-destructive hover:bg-destructive/10")}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  )
}

function ScheduleOptions({ onSchedule, onBack }: { onSchedule: (date: Date) => void; onBack: () => void }) {
  const preferencesContext = usePreferencesOptional()
  const showDeviceTimeNote = hasDifferentCurrentOffset(preferencesContext?.preferences?.timezone)
  const [customOpen, setCustomOpen] = useState(false)
  const [customDate, setCustomDate] = useState("")
  const [customTime, setCustomTime] = useState("")
  const minDate = useMemo(() => toDateInput(new Date()), [customOpen])

  const openCustom = () => {
    const baseline = new Date(Date.now() + 15 * 60_000)
    setCustomDate(toDateInput(baseline))
    setCustomTime(toTimeInput(baseline))
    setCustomOpen(true)
  }

  const handleCustom = () => {
    if (!customDate || !customTime) return
    const parsed = buildLocalDateTime(customDate, customTime)
    if (isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      toast.error("Choose a future time")
      return
    }
    onSchedule(parsed)
  }

  return (
    <div className="flex flex-col divide-y">
      <div className="p-1">
        <div className="flex items-center gap-1 px-1 py-1">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onBack} aria-label="Back">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <CalendarClock className="h-3 w-3" />
            Send later
          </div>
        </div>
        {showDeviceTimeNote && (
          <p className="px-2 pb-1 text-[11px] leading-4 text-muted-foreground">Calendar times use this device.</p>
        )}
        {REMINDER_PRESETS.map((preset) => (
          <ScheduleMenuButton key={preset.label} onClick={() => onSchedule(computeScheduleAt(preset, new Date()))}>
            <Clock className="h-3.5 w-3.5" />
            {preset.label}
          </ScheduleMenuButton>
        ))}
        <ScheduleMenuButton onClick={openCustom}>
          <CalendarIcon className="h-3.5 w-3.5" />
          Pick a time...
        </ScheduleMenuButton>
      </div>
      {customOpen && (
        <div className="grid grid-cols-[1fr_92px_auto] gap-2 p-2">
          <input
            type="date"
            aria-label="Custom date"
            value={customDate}
            min={minDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="rounded border bg-background px-2 py-1.5 text-sm"
          />
          <input
            type="time"
            aria-label="Custom time"
            value={customTime}
            onChange={(e) => setCustomTime(e.target.value)}
            className="rounded border bg-background px-2 py-1.5 text-sm"
          />
          <Button type="button" size="sm" onClick={handleCustom} disabled={!customDate || !customTime}>
            Set
          </Button>
        </div>
      )}
    </div>
  )
}

function ScheduleSheetOptions({ onSchedule, onBack }: { onSchedule: (date: Date) => void; onBack: () => void }) {
  const preferencesContext = usePreferencesOptional()
  const showDeviceTimeNote = hasDifferentCurrentOffset(preferencesContext?.preferences?.timezone)
  const [mode, setMode] = useState<"presets" | "custom">("presets")
  const [customDate, setCustomDate] = useState("")
  const [customTime, setCustomTime] = useState("")
  const minDate = useMemo(() => toDateInput(new Date()), [mode])

  const openCustom = () => {
    const baseline = new Date(Date.now() + 15 * 60_000)
    setCustomDate(toDateInput(baseline))
    setCustomTime(toTimeInput(baseline))
    setMode("custom")
  }

  const handleCustom = () => {
    if (!customDate || !customTime) return
    const parsed = buildLocalDateTime(customDate, customTime)
    if (isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      toast.error("Choose a future time")
      return
    }
    onSchedule(parsed)
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        {mode === "custom" && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 -ml-2 rounded-full"
            onClick={() => setMode("presets")}
            aria-label="Back to presets"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        {mode === "presets" && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 -ml-2 rounded-full"
            onClick={onBack}
            aria-label="Back to scheduled messages"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        <DrawerTitle className="text-lg font-semibold">
          {mode === "custom" ? "Pick a send time" : "Schedule message"}
        </DrawerTitle>
      </div>

      {mode === "presets" ? (
        <div className="flex flex-col gap-1">
          {showDeviceTimeNote && (
            <p className="px-3 pb-1 text-xs leading-5 text-muted-foreground">Calendar times use this device.</p>
          )}
          {REMINDER_PRESETS.map((preset) => (
            <ScheduleMenuButton
              key={preset.label}
              mobile
              onClick={() => onSchedule(computeScheduleAt(preset, new Date()))}
            >
              <Clock className="h-4 w-4 text-muted-foreground" />
              {preset.label}
            </ScheduleMenuButton>
          ))}
          <ScheduleMenuButton mobile onClick={openCustom}>
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
            Pick a time...
          </ScheduleMenuButton>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</span>
              <input
                type="date"
                value={customDate}
                min={minDate}
                onChange={(event) => setCustomDate(event.target.value)}
                className="w-full rounded-lg border border-input bg-muted/30 px-3 py-4 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Time</span>
              <input
                type="time"
                value={customTime}
                onChange={(event) => setCustomTime(event.target.value)}
                className="w-full rounded-lg border border-input bg-muted/30 px-3 py-4 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              />
            </label>
          </div>
          <Button
            type="button"
            className="h-12 w-full text-base"
            onClick={handleCustom}
            disabled={!customDate || !customTime}
          >
            Schedule message
          </Button>
        </div>
      )}
    </>
  )
}

function previewScheduled(item: ScheduledMessageView): string {
  const text = stripMarkdownToInline(item.contentMarkdown).trim()
  if (text) return text
  if (item.attachmentIds.length > 0)
    return `${item.attachmentIds.length} attachment${item.attachmentIds.length === 1 ? "" : "s"}`
  return "Empty message"
}

function formatScheduledAt(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function computeScheduleAt(preset: ReminderPreset, now: Date): Date {
  switch (preset.kind) {
    case "duration":
      return new Date(now.getTime() + preset.minutes * 60_000)
    case "calendar":
      return preset.calendar === "tomorrow-9am" ? tomorrowAt9(now) : nextMondayAt9(now)
  }
}

function tomorrowAt9(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0)
}

function nextMondayAt9(now: Date): Date {
  const daysUntilMonday = now.getDay() === 1 ? 7 : (1 - now.getDay() + 7) % 7 || 7
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday, 9, 0, 0, 0)
}

function ScheduleMenuButton({
  children,
  onClick,
  mobile = false,
}: {
  children: ReactNode
  onClick: () => void
  mobile?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        "w-full justify-start gap-2 font-normal",
        mobile ? "h-11 px-3 text-sm" : "h-auto px-2 py-1.5 text-sm"
      )}
    >
      {children}
    </Button>
  )
}

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function buildLocalDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number)
  const [hour, minute] = time.split(":").map(Number)
  if (!year || !month || !day || hour === undefined || minute === undefined) return new Date(Number.NaN)
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function hasDifferentCurrentOffset(timezone: string | undefined): boolean {
  if (!timezone) return false
  const now = new Date()
  try {
    return timezoneOffsetMinutes(now, timezone) !== -now.getTimezoneOffset()
  } catch {
    return false
  }
}

function timezoneOffsetMinutes(date: Date, timezone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => Number(formatted.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"))
  return Math.round((asUtc - date.getTime()) / 60_000)
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}
