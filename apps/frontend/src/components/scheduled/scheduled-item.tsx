import { Button } from "@/components/ui/button"
import { stripMarkdownToInline } from "@/lib/markdown/strip"
import { RelativeTime } from "@/components/relative-time"
import { Send, X } from "lucide-react"

interface ScheduledItemData {
  id: string
  contentMarkdown: string
  scheduledAt: string
  streamDisplayName: string | null
}

interface ScheduledItemProps {
  scheduled: ScheduledItemData
  onCancel: () => void
  onSendNow: () => void
}

export function ScheduledItem({ scheduled, onCancel, onSendNow }: ScheduledItemProps) {
  const preview = stripMarkdownToInline(scheduled.contentMarkdown)

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {scheduled.streamDisplayName && (
            <span className="text-xs text-muted-foreground truncate">{scheduled.streamDisplayName}</span>
          )}
        </div>
        <p className="text-sm line-clamp-2 mt-0.5">{preview}</p>
        <p className="text-xs text-muted-foreground mt-1">
          <RelativeTime date={scheduled.scheduledAt} />
        </p>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onSendNow} aria-label="Send now">
        <Send className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onCancel}
        aria-label="Cancel scheduled message"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
