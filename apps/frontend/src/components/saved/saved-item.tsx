import { Link } from "react-router-dom"
import { Archive, Check, CircleAlert, Trash2, Undo2 } from "lucide-react"
import type { SavedMessageView, SavedStatus } from "@threa/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { stripMarkdownToInline } from "@/lib/markdown"
import { RelativeTime } from "@/components/relative-time"
import { ReminderBadge } from "./reminder-badge"

interface SavedItemProps {
  saved: SavedMessageView
  workspaceId: string
  onMarkDone?: () => void
  onArchive?: () => void
  onRestore?: () => void
  onDelete?: () => void
  /** Render actions menu? Disabled for compact list placement. */
  compact?: boolean
}

export function SavedItem({
  saved,
  workspaceId,
  onMarkDone,
  onArchive,
  onRestore,
  onDelete,
  compact = false,
}: SavedItemProps) {
  const isUnavailable = saved.unavailableReason !== null
  const linkable = !isUnavailable && saved.message !== null
  const href = `/w/${workspaceId}/s/${saved.streamId}?m=${saved.messageId}`

  const previewText = resolvePreview(saved)

  const streamLabel = saved.message?.streamName ?? "Unknown"

  return (
    <div
      className={cn(
        "group flex items-start gap-3 px-4 py-3 hover:bg-muted/40 border-b border-border/50",
        isUnavailable && "opacity-75"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 text-sm">
          <span className="text-muted-foreground">Saved from</span>
          <span className="font-medium truncate">{streamLabel}</span>
          {isUnavailable && (
            <span
              className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide bg-muted text-muted-foreground"
              title={saved.unavailableReason === "deleted" ? "Original message was deleted" : "Access lost"}
            >
              <CircleAlert className="h-3 w-3" />
              {saved.unavailableReason === "deleted" ? "deleted" : "no access"}
            </span>
          )}
        </div>

        <p className={cn("mt-0.5 text-xs text-muted-foreground truncate", isUnavailable && "italic")}>{previewText}</p>

        <div className="mt-1 flex items-center gap-3">
          <RelativeTime
            date={saved.status === "saved" ? saved.savedAt : saved.statusChangedAt}
            className="text-xs text-muted-foreground/60"
          />
          <ReminderBadge remindAt={saved.remindAt} reminderSentAt={saved.reminderSentAt} />
        </div>
      </div>

      {!compact && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
          {linkable && (
            <Link to={href}>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                Open
              </Button>
            </Link>
          )}
          {renderStatusActions({ status: saved.status as SavedStatus, onMarkDone, onArchive, onRestore })}
          {onDelete && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              title="Remove saved item"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function resolvePreview(saved: SavedMessageView): string {
  if (saved.message) return stripMarkdownToInline(saved.message.contentMarkdown)
  if (saved.unavailableReason === "deleted") return "Original message was deleted"
  return "You no longer have access to this message"
}

function renderStatusActions(params: {
  status: SavedStatus
  onMarkDone?: () => void
  onArchive?: () => void
  onRestore?: () => void
}) {
  const { status, onMarkDone, onArchive, onRestore } = params
  if (status === "saved") {
    return (
      <>
        {onMarkDone && (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onMarkDone} title="Mark done">
            <Check className="h-3.5 w-3.5" />
          </Button>
        )}
        {onArchive && (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onArchive} title="Archive">
            <Archive className="h-3.5 w-3.5" />
          </Button>
        )}
      </>
    )
  }
  if (onRestore) {
    return (
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onRestore} title="Restore to saved">
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
    )
  }
  return null
}
