import { useState } from "react"
import { Bell, BellOff, Calendar as CalendarIcon } from "lucide-react"
import { toast } from "sonner"
import type { SavedMessageView } from "@threa/types"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
 * Mobile bottom-sheet for picking a reminder time. Presets apply immediately
 * and close the sheet; "Pick a time…" opens a secondary dialog with a native
 * datetime picker so iOS/Android can show their platform controls.
 */
export function ReminderPickerSheet({ open, onOpenChange, workspaceId, messageId, saved }: ReminderPickerSheetProps) {
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const saveMutation = useSaveMessage(workspaceId)
  const updateMutation = useUpdateSaved(workspaceId)
  const [customOpen, setCustomOpen] = useState(false)
  const [customDateTime, setCustomDateTime] = useState("")

  const setReminder = (date: Date | null, dismissAfter = true) => {
    if (!saved) {
      saveMutation.mutate(
        { messageId, remindAt: date?.toISOString() ?? null },
        {
          onSuccess: () => {
            toast.success(date ? "Reminder set" : "Saved")
            if (dismissAfter) onOpenChange(false)
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
          if (dismissAfter) onOpenChange(false)
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
    setCustomOpen(false)
    setCustomDateTime("")
  }

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">
          <div className="flex flex-col px-4 pt-4 pb-safe">
            <div className="flex items-center justify-between mb-3">
              <DrawerTitle className="text-base">{saved ? "Reminder" : "Save & remind"}</DrawerTitle>
              {saved && (
                <ReminderBadge remindAt={saved.remindAt} reminderSentAt={saved.reminderSentAt} className="text-xs" />
              )}
            </div>

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
              <SheetMenuButton onClick={() => setCustomOpen(true)}>
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
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Pick a reminder time</DialogTitle>
          </DialogHeader>
          <input
            type="datetime-local"
            value={customDateTime}
            onChange={(e) => setCustomDateTime(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCustomOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCustom} disabled={!customDateTime}>
              Set reminder
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
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
