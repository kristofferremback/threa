import { cn } from "@/lib/utils"
import { RelativeTime } from "@/components/relative-time"
import { stripMarkdownToInline } from "@/lib/markdown"

const ACTIVITY_DISPLAY: Record<string, { verb: string }> = {
  mention: { verb: "mentioned you in" },
  message: { verb: "posted in" },
}

interface ActivityPreviewProps {
  contentPreview: string
  toEmoji?: (shortcode: string) => string | null
}

/**
 * Single-line preview of the message that triggered the activity.
 * Strips markdown, collapses newlines, optionally resolves emoji shortcodes,
 * and renders nothing when there's no displayable content.
 */
export function ActivityPreview({ contentPreview, toEmoji }: ActivityPreviewProps) {
  const previewText = stripMarkdownToInline(contentPreview, toEmoji)
  if (!previewText) return null
  return <p className="mt-0.5 text-xs text-muted-foreground truncate">{previewText}</p>
}

interface ActivityContentProps {
  actorName: string
  streamName: string
  activityType: string
  contentPreview: string
  toEmoji?: (shortcode: string) => string | null
  createdAt: string
  isUnread: boolean
}

export function ActivityContent({
  actorName,
  streamName,
  activityType,
  contentPreview,
  toEmoji,
  createdAt,
  isUnread,
}: ActivityContentProps) {
  const display = ACTIVITY_DISPLAY[activityType] ?? ACTIVITY_DISPLAY.message

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline gap-1.5 text-sm">
        <span className={cn("font-medium", isUnread && "font-semibold")}>{actorName}</span>
        <span className="text-muted-foreground">{display.verb}</span>
        <span className="font-medium truncate">{streamName}</span>
      </div>

      <ActivityPreview contentPreview={contentPreview} toEmoji={toEmoji} />

      <RelativeTime date={createdAt} className="text-xs text-muted-foreground/60 mt-1 block" />
    </div>
  )
}
