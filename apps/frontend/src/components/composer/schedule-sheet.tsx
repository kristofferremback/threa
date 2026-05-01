import { useMemo, useState } from "react"
import { Clock, Calendar as CalendarIcon, ChevronLeft } from "lucide-react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/contexts"
import { SCHEDULE_PRESETS, computeScheduledAt, buildZonedDate } from "@/lib/schedule-presets"

interface ScheduleSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (date: Date) => void
}

export function ScheduleSheet({ open, onOpenChange, onSelect }: ScheduleSheetProps) {
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const [mode, setMode] = useState<"presets" | "custom">("presets")
  const [customDate, setCustomDate] = useState("")
  const [customTime, setCustomTime] = useState("")
  const minDate = useMemo(() => toDateInput(new Date()), [open, mode])

  const openCustom = () => {
    const baseline = new Date(Date.now() + 15 * 60_000)
    setCustomDate(toDateInput(baseline))
    setCustomTime(toTimeInput(baseline))
    setMode("custom")
  }

  const resetAndClose = () => {
    setMode("presets")
    setCustomDate("")
    setCustomTime("")
    onOpenChange(false)
  }

  const handlePreset = (date: Date) => {
    resetAndClose()
    onSelect(date)
  }

  const handleCustom = () => {
    if (!customDate || !customTime) return
    const [y, m, d] = customDate.split("-").map(Number)
    const [h, min] = customTime.split(":").map(Number)
    if (isNaN(y) || isNaN(m) || isNaN(d) || isNaN(h) || isNaN(min)) return
    const parsed = buildZonedDate(timezone, y, m - 1, d, h, min)
    if (parsed.getTime() <= Date.now()) return
    handlePreset(parsed)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setMode("presets")
      setCustomDate("")
      setCustomTime("")
    }
    onOpenChange(nextOpen)
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <div className="flex flex-col px-5 pt-3 pb-6 pb-safe">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {mode === "custom" && (
                <Button
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
                {mode === "custom" ? "Pick a time" : "Schedule send"}
              </DrawerTitle>
            </div>
          </div>

          {mode === "presets" ? (
            <div className="flex flex-col gap-1">
              {SCHEDULE_PRESETS.map((preset) => (
                <SheetMenuButton
                  key={preset.label}
                  onClick={() => handlePreset(computeScheduledAt(preset, new Date(), timezone))}
                >
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  {preset.label}
                </SheetMenuButton>
              ))}
              <SheetMenuButton onClick={openCustom}>
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                Pick a time…
              </SheetMenuButton>
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
                    onChange={(e) => setCustomDate(e.target.value)}
                    className="w-full rounded-lg border border-input bg-muted/30 px-3 py-4 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Time</span>
                  <input
                    type="time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="w-full rounded-lg border border-input bg-muted/30 px-3 py-4 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                  />
                </label>
              </div>
              <Button className="w-full h-12 text-base" onClick={handleCustom} disabled={!customDate || !customTime}>
                Schedule
              </Button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function SheetMenuButton({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode
  onClick: () => void
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={cn("w-full justify-start gap-3 h-11 text-sm font-normal px-3", className)}
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
