import { Bookmark } from "lucide-react"
import type { SavedMessageView } from "@threa/types"
import { cn } from "@/lib/utils"
import { ReminderBadge } from "./reminder-badge"

interface SavedIndicatorProps {
  saved: SavedMessageView | null
  className?: string
}

/**
 * Compact inline chip rendered next to a message's timestamp when the viewer
 * has saved it. Hides for done/archived — those statuses live in their own
 * tabs and shouldn't clutter the timeline. If a reminder is set or has fired,
 * `ReminderBadge` renders beside the chip using its existing future/reminded
 * logic so the visual language matches the Saved view.
 */
export function SavedIndicator({ saved, className }: SavedIndicatorProps) {
  if (!saved || saved.status !== "saved") return null

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="You've saved this message">
        <Bookmark className="h-3 w-3" />
        Saved
      </span>
      <ReminderBadge remindAt={saved.remindAt} reminderSentAt={saved.reminderSentAt} />
    </span>
  )
}
