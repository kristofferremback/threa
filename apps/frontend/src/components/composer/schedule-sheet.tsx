import { useMemo, useState } from "react"
import { ChevronLeft } from "lucide-react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePreferences } from "@/contexts"
import { toDateInput, toTimeInput, parseDateTimeInput } from "@/lib/schedule-presets"
import { SchedulePresetList } from "./schedule-ui"

interface ScheduleSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (date: Date) => void
}

export function ScheduleSheet({ open, onOpenChange, onSelect }: ScheduleSheetProps) {
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const isMobile = useIsMobile()
  const [mode, setMode] = useState<"presets" | "custom">("presets")
  const [customDate, setCustomDate] = useState("")
  const [customTime, setCustomTime] = useState("")
  const minDate = useMemo(() => toDateInput(new Date()), [open, mode])
  const now = useMemo(() => new Date(), [open])

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
    const parsed = parseDateTimeInput(customDate, customTime, timezone)
    if (!parsed) return
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

  const actionsVariant = isMobile ? "drawer" : "popover"

  const innerContent = (
    <div className={isMobile ? "flex flex-col px-5 pt-3 pb-6 pb-safe" : "flex flex-col gap-4"}>
      <div className="flex items-center mb-4">
        {mode === "custom" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 -ml-2 rounded-full mr-2"
            onClick={() => setMode("presets")}
            aria-label="Back to presets"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        {isMobile ? (
          <DrawerTitle className="text-lg font-semibold">
            {mode === "custom" ? "Pick a time" : "Schedule send"}
          </DrawerTitle>
        ) : (
          <DialogTitle className="text-lg font-semibold">
            {mode === "custom" ? "Pick a time" : "Schedule send"}
          </DialogTitle>
        )}
      </div>

      {mode === "presets" ? (
        <SchedulePresetList
          variant={actionsVariant}
          onSelect={handlePreset}
          onCustomClick={openCustom}
          now={now}
          timezone={timezone}
        />
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
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent className="max-h-[85vh]">{innerContent}</DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">{innerContent}</DialogContent>
    </Dialog>
  )
}
