import { useMemo, useState } from "react"
import { Bell, BellOff, Calendar as CalendarIcon, ChevronLeft } from "lucide-react"
import { toast } from "sonner"
import type { SavedMessageView } from "@threa/types"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/contexts"
import { useSaveMessage, useUpdateSaved } from "@/hooks/use-saved"
import { ReminderBadge } from "@/components/saved/reminder-badge"
import { REMINDER_PRESETS, computeRemindAt } from "@/lib/reminder-presets"

interface ReminderPickerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  messageId: string
  /** Current saved state (null if not yet saved). Controls save-vs-update behaviour. */
  saved: SavedMessageView | null
}

/**
 * Mobile bottom-sheet for picking a reminder time. "Pick a time…" swaps the
 * preset list for an inline datetime picker so the action row stays near the
 * bottom of the screen — no thumb-jump to a centered dialog.
 */
export function ReminderPickerSheet({ open, onOpenChange, workspaceId, messageId, saved }: ReminderPickerSheetProps) {
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const saveMutation = useSaveMessage(workspaceId)
  const updateMutation = useUpdateSaved(workspaceId)
  const [mode, setMode] = useState<"presets" | "custom">("presets")
  const [customDateTime, setCustomDateTime] = useState("")

  // `datetime-local` wants `YYYY-MM-DDTHH:mm` in *local* time. Build it from
  // the current instant rounded up to the next minute so the min matches the
  // clamp the server applies.
  const minLocal = useMemo(() => toLocalInput(new Date(Date.now() + 60_000)), [open, mode])

  const openCustom = () => {
    // Pre-populate with "now + 15 minutes" so the picker opens on a sensible
    // default; the user only needs to nudge it from there.
    if (!customDateTime) setCustomDateTime(toLocalInput(new Date(Date.now() + 15 * 60_000)))
    setMode("custom")
  }

  const resetAndClose = () => {
    setMode("presets")
    setCustomDateTime("")
    onOpenChange(false)
  }

  const setReminder = (date: Date | null) => {
    if (!saved) {
      saveMutation.mutate(
        { messageId, remindAt: date?.toISOString() ?? null },
        {
          onSuccess: () => {
            toast.success(date ? "Reminder set" : "Saved")
            resetAndClose()
          },
          onError: () => toast.error("Could not save"),
        }
      )
      return
    }
    updateMutation.mutate(
      { savedId: saved.id, input: { remindAt: date?.toISOString() ?? null } },
      {
        onSuccess: () => {
          toast.success(date ? "Reminder set" : "Reminder cleared")
          resetAndClose()
        },
        onError: () => toast.error("Could not update reminder"),
      }
    )
  }

  const handleCustom = () => {
    if (!customDateTime) return
    const parsed = new Date(customDateTime)
    if (isNaN(parsed.getTime())) {
      toast.error("Invalid date")
      return
    }
    setReminder(parsed)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      // Reset mode when drawer closes so the next open starts on the preset list.
      setMode("presets")
      setCustomDateTime("")
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
              <DrawerTitle className="text-lg font-semibold">{resolveTitle(mode, saved)}</DrawerTitle>
            </div>
            {saved && mode === "presets" && (
              <ReminderBadge remindAt={saved.remindAt} reminderSentAt={saved.reminderSentAt} className="text-xs" />
            )}
          </div>

          {mode === "presets" ? (
            <div className="flex flex-col gap-1">
              {REMINDER_PRESETS.map((preset) => (
                <SheetMenuButton
                  key={preset.label}
                  onClick={() => setReminder(computeRemindAt(preset, new Date(), timezone))}
                >
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  {preset.label}
                </SheetMenuButton>
              ))}
              <SheetMenuButton onClick={openCustom}>
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                Pick a time…
              </SheetMenuButton>
              {saved?.remindAt && (
                <SheetMenuButton onClick={() => setReminder(null)}>
                  <BellOff className="h-4 w-4 text-muted-foreground" />
                  Clear reminder
                </SheetMenuButton>
              )}
            </div>
          ) : (
            // Keep the input + Set button grouped at the bottom of the sheet so
            // the tap target is close to the thumb that just opened the drawer.
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Date &amp; time
                </span>
                <input
                  type="datetime-local"
                  value={customDateTime}
                  min={minLocal}
                  onChange={(e) => setCustomDateTime(e.target.value)}
                  className="w-full rounded-lg border border-input bg-muted/30 px-4 py-4 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                  autoFocus
                />
              </label>
              <Button
                className="w-full h-12 text-base"
                onClick={handleCustom}
                disabled={!customDateTime || saveMutation.isPending || updateMutation.isPending}
              >
                Set reminder
              </Button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function resolveTitle(mode: "presets" | "custom", saved: SavedMessageView | null): string {
  if (mode === "custom") return "Pick a reminder time"
  return saved ? "Reminder" : "Save & remind"
}

/**
 * Format a Date as `YYYY-MM-DDTHH:mm` in local time — the shape
 * `<input type="datetime-local">` expects for its `min`/`value`.
 */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface SheetMenuButtonProps {
  children: React.ReactNode
  onClick: () => void
  className?: string
}

function SheetMenuButton({ children, onClick, className }: SheetMenuButtonProps) {
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
