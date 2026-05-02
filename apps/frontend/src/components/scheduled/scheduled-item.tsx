import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { stripMarkdownToInline } from "@/lib/markdown/strip"
import { RelativeTime } from "@/components/relative-time"
import { Send, X, Pause, Play } from "lucide-react"
import type { CachedScheduledMessage } from "@/lib/scheduled-messages/types"

interface ScheduledItemProps {
  scheduled: CachedScheduledMessage
  onCancel: () => void
  onSendNow: () => void
  onPause?: () => void
  onResume?: () => void
}

function getStatusBadge(scheduled: CachedScheduledMessage) {
  if (scheduled.cancelledAt) {
    return <Badge variant="secondary">Cancelled</Badge>
  }
  if (scheduled.sentAt) {
    return <Badge variant="secondary">Sent</Badge>
  }
  if (scheduled.pausedAt) {
    return <Badge variant="outline">Paused</Badge>
  }
  return <Badge variant="default">Pending</Badge>
}

export function ScheduledItem({ scheduled, onCancel, onSendNow, onPause, onResume }: ScheduledItemProps) {
  const preview = stripMarkdownToInline(scheduled.contentMarkdown)
  const isSent = !!scheduled.sentAt
  const isPaused = !!scheduled.pausedAt
  const isCancelled = !!scheduled.cancelledAt
  const isPending = !isSent && !isCancelled

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {scheduled.streamDisplayName && (
            <span className="text-xs text-muted-foreground truncate">{scheduled.streamDisplayName}</span>
          )}
          {getStatusBadge(scheduled)}
        </div>
        <p className="text-sm line-clamp-2 mt-0.5">{preview}</p>
        <p className="text-xs text-muted-foreground mt-1">
          <RelativeTime date={scheduled.scheduledAt} />
        </p>
      </div>
      {isPending && (
        <>
          {isPaused ? (
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onResume} aria-label="Resume">
              <Play className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onPause} aria-label="Pause">
              <Pause className="h-3.5 w-3.5" />
            </Button>
          )}
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
        </>
      )}
    </div>
  )
}
