import { useMemo, useState } from "react"
import { Calendar as CalendarIcon, CalendarClock, ChevronLeft, Clock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePreferences } from "@/contexts"
import { REMINDER_PRESETS, computeRemindAt } from "@/lib/reminder-presets"
import { cn } from "@/lib/utils"

interface ScheduleMessagePickerProps {
  canSchedule: boolean
  disabled?: boolean
  onSchedule: (date: Date) => void
  size?: "compact" | "fab"
}

export function ScheduleMessagePicker({
  canSchedule,
  disabled = false,
  onSchedule,
  size = "compact",
}: ScheduleMessagePickerProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const controlsDisabled = disabled || !canSchedule
  const triggerSizeClass = size === "fab" ? "h-[30px] w-[30px] rounded-md bg-background shadow-md" : "h-7 w-7"
  const triggerIconClass = size === "fab" ? "h-4 w-4" : "h-3.5 w-3.5"

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
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Schedule message
          </TooltipContent>
        </Tooltip>
        <ScheduleDrawer open={open} onOpenChange={setOpen} onSchedule={onSchedule} />
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
            />
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Schedule message
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" side="top" className="w-72 p-0">
        <ScheduleOptions
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
}: {
  size: "compact" | "fab"
  triggerSizeClass: string
  triggerIconClass: string
  disabled: boolean
  onClick?: () => void
}) {
  return (
    <Button
      type="button"
      variant={size === "fab" ? "outline" : "ghost"}
      size="icon"
      aria-label="Schedule message"
      className={cn("shrink-0 p-0", triggerSizeClass)}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={size === "fab" ? (e) => e.preventDefault() : undefined}
    >
      <Clock className={triggerIconClass} />
    </Button>
  )
}

function ScheduleDrawer({
  open,
  onOpenChange,
  onSchedule,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSchedule: (date: Date) => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <div className="flex flex-col px-5 pt-3 pb-6 pb-safe">
          <ScheduleSheetOptions
            onSchedule={(date) => {
              onSchedule(date)
              onOpenChange(false)
            }}
          />
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function ScheduleOptions({ onSchedule }: { onSchedule: (date: Date) => void }) {
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
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
    const parsed = new Date(`${customDate}T${customTime}`)
    if (isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      toast.error("Choose a future time")
      return
    }
    onSchedule(parsed)
  }

  return (
    <div className="flex flex-col divide-y">
      <div className="p-1">
        <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <CalendarClock className="h-3 w-3" />
          Send later
        </div>
        {REMINDER_PRESETS.map((preset) => (
          <ScheduleMenuButton
            key={preset.label}
            onClick={() => onSchedule(computeRemindAt(preset, new Date(), timezone))}
          >
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
            value={customDate}
            min={minDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="rounded border bg-background px-2 py-1.5 text-sm"
          />
          <input
            type="time"
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

function ScheduleSheetOptions({ onSchedule }: { onSchedule: (date: Date) => void }) {
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
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
    const parsed = new Date(`${customDate}T${customTime}`)
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
        <DrawerTitle className="text-lg font-semibold">
          {mode === "custom" ? "Pick a send time" : "Schedule message"}
        </DrawerTitle>
      </div>

      {mode === "presets" ? (
        <div className="flex flex-col gap-1">
          {REMINDER_PRESETS.map((preset) => (
            <ScheduleMenuButton
              key={preset.label}
              mobile
              onClick={() => onSchedule(computeRemindAt(preset, new Date(), timezone))}
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

function ScheduleMenuButton({
  children,
  onClick,
  mobile = false,
}: {
  children: React.ReactNode
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
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
