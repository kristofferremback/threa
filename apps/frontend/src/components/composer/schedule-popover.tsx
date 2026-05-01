import { useMemo, useState } from "react"
import { Clock, ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { usePreferences } from "@/contexts"
import { toDateTimeLocal, parseDateTimeInput } from "@/lib/schedule-presets"
import { SchedulePresetList } from "./schedule-ui"

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
  const now = useMemo(() => new Date(), [open])

  const openCustom = () => {
    if (customOpen) {
      setCustomOpen(false)
      return
    }
    setCustomDateTime(toDateTimeLocal(new Date(Date.now() + 15 * 60_000)))
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
    const parsed = parseDateTimeInput(datePart, timePart, timezone)
    if (!parsed) return
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
        <SchedulePresetList
          variant="popover"
          onSelect={handlePreset}
          onCustomClick={openCustom}
          now={now}
          timezone={timezone}
        />
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
