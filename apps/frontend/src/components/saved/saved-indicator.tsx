import { Archive, Bookmark, Check } from "lucide-react"
import type { SavedMessageView } from "@threa/types"
import { cn } from "@/lib/utils"
import { ReminderBadge } from "./reminder-badge"

interface SavedIndicatorProps {
  saved: SavedMessageView | null
  className?: string
}

/**
 * Compact inline chip rendered next to a message's timestamp when the viewer
 * has saved it. Renders a different variant per status so users don't
 * accidentally "re-save" a message that's already in their done/archived
 * lists. For status=saved, `ReminderBadge` renders beside the chip using its
 * existing future/reminded logic so the visual language matches the Saved view.
 */
export function SavedIndicator({ saved, className }: SavedIndicatorProps) {
  if (!saved) return null

  if (saved.status === "done") {
    return (
      <span
        className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground/80", className)}
        title="You marked this message done — it's in your Done tab"
      >
        <Check className="h-3 w-3" />
        Done
      </span>
    )
  }

  if (saved.status === "archived") {
    return (
      <span
        className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground/80", className)}
        title="You archived this message — it's in your Archived tab"
      >
        <Archive className="h-3 w-3" />
        Archived
      </span>
    )
  }

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
