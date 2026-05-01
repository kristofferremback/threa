import { useMemo, useState, type ReactNode } from "react"
import { Clock, Calendar as CalendarIcon, ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/contexts"
import { SCHEDULE_PRESETS, computeScheduledAt, buildZonedDate } from "@/lib/schedule-presets"

interface SchedulePopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (date: Date) => void
  disabled?: boolean
}

export function SchedulePopover({ open, onOpenChange, onSelect, disabled }: SchedulePopoverProps) {
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const [customOpen, setCustomOpen] = useState(false)
  const [customDateTime, setCustomDateTime] = useState("")
  const minDateTime = useMemo(() => (customOpen ? toDateTimeLocal(new Date()) : ""), [customOpen])

  const openCustom = () => {
    if (customOpen) {
      setCustomOpen(false)
      return
    }
    const baseline = new Date(Date.now() + 15 * 60_000)
    setCustomDateTime(toDateTimeLocal(baseline))
    setCustomOpen(true)
  }

  const handlePreset = (date: Date) => {
    setCustomOpen(false)
    setCustomDateTime("")
    onOpenChange(false)
    onSelect(date)
  }

  const handleCustom = () => {
    if (!customDateTime) return
    const [datePart, timePart] = customDateTime.split("T")
    if (!datePart || !timePart) return
    const [y, m, d] = datePart.split("-").map(Number)
    const [h, min] = timePart.split(":").map(Number)
    if (isNaN(y) || isNaN(m) || isNaN(d) || isNaN(h) || isNaN(min)) return
    const parsed = buildZonedDate(timezone, y, m - 1, d, h, min)
    handlePreset(parsed)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="h-[30px] w-[14px] shrink-0 p-0 rounded-l-none rounded-r-md border-l-0"
          aria-label="Schedule message"
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-52 p-1">
        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Schedule send
        </div>
        {SCHEDULE_PRESETS.map((preset) => (
          <PopoverMenuButton
            key={preset.label}
            onClick={() => handlePreset(computeScheduledAt(preset, new Date(), timezone))}
          >
            <Clock className="h-3.5 w-3.5" />
            {preset.label}
          </PopoverMenuButton>
        ))}
        <PopoverMenuButton onClick={openCustom}>
          <CalendarIcon className="h-3.5 w-3.5" />
          Pick a time…
        </PopoverMenuButton>
        {customOpen && (
          <div className="flex items-center gap-1.5 px-2 py-1.5">
            <input
              type="datetime-local"
              value={customDateTime}
              min={minDateTime}
              onChange={(e) => setCustomDateTime(e.target.value)}
              className="flex-1 text-xs rounded border bg-background px-1.5 py-1"
            />
            <Button size="sm" className="h-7 text-xs" onClick={handleCustom} disabled={!customDateTime}>
              Set
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function PopoverMenuButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick: () => void
  className?: string
}) {
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

function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
