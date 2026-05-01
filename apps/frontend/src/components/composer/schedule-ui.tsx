import { type ReactNode } from "react"
import { Clock, Calendar as CalendarIcon, Edit2, CircleSlash, ArrowUp, Pause, Play } from "lucide-react"
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
  variant: "drawer" | "popover"
  onSelect: (date: Date) => void
  onCustomClick: () => void
  now: Date
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

interface ScheduledActionsListProps {
  variant?: "drawer" | "popover"
  onSendNow: () => void
  onEdit: () => void
  onChangeTime: () => void
  onDelete: () => void
  onPause?: () => void
  onResume?: () => void
  isPaused?: boolean
}

export function ScheduledActionsList({
  variant = "drawer",
  onSendNow,
  onEdit,
  onChangeTime,
  onDelete,
  onPause,
  onResume,
  isPaused = false,
}: ScheduledActionsListProps) {
  const iconClass = variant === "popover" ? "h-3.5 w-3.5" : "h-4 w-4"

  return (
    <>
      <PresetMenuButton variant={variant} onClick={onSendNow}>
        <ArrowUp className={cn(iconClass, "text-muted-foreground")} />
        <span className="flex-1 text-left">Send now</span>
      </PresetMenuButton>
      <PresetMenuButton variant={variant} onClick={onEdit}>
        <Edit2 className={cn(iconClass, "text-muted-foreground")} />
        <span className="flex-1 text-left">Edit message</span>
      </PresetMenuButton>
      <PresetMenuButton variant={variant} onClick={onChangeTime}>
        <Clock className={cn(iconClass, "text-muted-foreground")} />
        <span className="flex-1 text-left">Change time</span>
      </PresetMenuButton>
      {isPaused ? (
        <PresetMenuButton variant={variant} onClick={onResume}>
          <Play className={cn(iconClass, "text-muted-foreground")} />
          <span className="flex-1 text-left">Resume</span>
        </PresetMenuButton>
      ) : (
        <PresetMenuButton variant={variant} onClick={onPause}>
          <Pause className={cn(iconClass, "text-muted-foreground")} />
          <span className="flex-1 text-left">Pause</span>
        </PresetMenuButton>
      )}
      <PresetMenuButton variant={variant} onClick={onDelete} className="text-destructive">
        <CircleSlash className={iconClass} />
        <span className="flex-1 text-left">Delete</span>
      </PresetMenuButton>
    </>
  )
}
