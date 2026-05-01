import { type ReactNode } from "react"
import { Clock, Calendar as CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { SCHEDULE_PRESETS, computeScheduledAt } from "@/lib/schedule-presets"

interface PresetMenuButtonProps {
  children: ReactNode
  onClick: () => void
  className?: string
  /** "drawer" for the taller full-width buttons, "popover" for the compact inline buttons. */
  variant?: "drawer" | "popover"
}

export function PresetMenuButton({ children, onClick, className, variant = "drawer" }: PresetMenuButtonProps) {
  const isPopover = variant === "popover"
  return (
    <Button
      variant="ghost"
      size={isPopover ? "sm" : "default"}
      onClick={onClick}
      className={cn(
        "w-full justify-start text-sm font-normal",
        isPopover ? "gap-2 h-auto px-2 py-1.5" : "gap-3 h-11 px-3",
        className
      )}
    >
      {children}
    </Button>
  )
}

interface SchedulePresetListProps {
  /** Which button style to use. */
  variant: "drawer" | "popover"
  /** Called with the resolved Date when a preset is picked. */
  onSelect: (date: Date) => void
  /** Called when "Pick a time…" is clicked. */
  onCustomClick: () => void
  /** Current time for computing presets. */
  now: Date
  /** User timezone. */
  timezone: string
}

export function SchedulePresetList({ variant, onSelect, now, timezone, onCustomClick }: SchedulePresetListProps) {
  const iconClass = variant === "popover" ? "h-3.5 w-3.5" : "h-4 w-4"

  return (
    <div className="flex flex-col gap-1">
      {SCHEDULE_PRESETS.map((preset) => (
        <PresetMenuButton
          key={preset.label}
          variant={variant}
          onClick={() => onSelect(computeScheduledAt(preset, now, timezone))}
        >
          <Clock className={cn(iconClass, "text-muted-foreground")} />
          {preset.label}
        </PresetMenuButton>
      ))}
      <PresetMenuButton variant={variant} onClick={onCustomClick}>
        <CalendarIcon className={cn(iconClass, "text-muted-foreground")} />
        Pick a time…
      </PresetMenuButton>
    </div>
  )
}
