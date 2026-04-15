import { cn } from "@/lib/utils"
import { RelativeTime } from "@/components/relative-time"
import { stripMarkdownToInline } from "@/lib/markdown"

const ACTIVITY_DISPLAY: Record<string, { verb: string }> = {
  mention: { verb: "mentioned you in" },
  message: { verb: "posted in" },
  reaction: { verb: "reacted to a message in" },
}

const SELF_ACTIVITY_DISPLAY: Record<string, { verb: string }> = {
  // Self-rows use first-person verbs so the Me feed reads naturally.
  mention: { verb: "You mentioned someone in" },
  message: { verb: "You posted in" },
  reaction: { verb: "You reacted to a message in" },
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
  /** Emoji character for reaction activities; null for other types. */
  emoji?: string | null
  /** Resolver for :shortcode: emoji inside the content preview. */
  toEmoji?: (shortcode: string) => string | null
  createdAt: string
  isUnread: boolean
  isSelf: boolean
}

export function ActivityContent({
  actorName,
  streamName,
  activityType,
  contentPreview,
  emoji,
  toEmoji,
  createdAt,
  isUnread,
  isSelf,
}: ActivityContentProps) {
  const display = isSelf
    ? (SELF_ACTIVITY_DISPLAY[activityType] ?? SELF_ACTIVITY_DISPLAY.message)
    : (ACTIVITY_DISPLAY[activityType] ?? ACTIVITY_DISPLAY.message)

  const showEmoji = activityType === "reaction" && emoji

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline gap-1.5 text-sm">
        {!isSelf && <span className={cn("font-medium", isUnread && "font-semibold")}>{actorName}</span>}
        <span className="text-muted-foreground">{display.verb}</span>
        <span className="font-medium truncate">{streamName}</span>
        {showEmoji && <span className="shrink-0">{emoji}</span>}
      </div>

      <ActivityPreview contentPreview={contentPreview} toEmoji={toEmoji} />

      <RelativeTime date={createdAt} className="text-xs text-muted-foreground/60 mt-1 block" />
    </div>
  )
}
