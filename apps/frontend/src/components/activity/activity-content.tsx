import { cn } from "@/lib/utils"
import { RelativeTime } from "@/components/relative-time"
import { MarkdownContent } from "@/components/ui/markdown-content"

const ACTIVITY_DISPLAY: Record<string, { verb: string }> = {
  mention: { verb: "mentioned you in" },
  message: { verb: "posted in" },
}

interface ActivityContentProps {
  actorName: string
  streamName: string
  activityType: string
  contentPreview: string
  createdAt: string
  isUnread: boolean
}

export function ActivityContent({
  actorName,
  streamName,
  activityType,
  contentPreview,
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

      {contentPreview && (
        <div className="mt-0.5 text-xs text-muted-foreground truncate">
          <MarkdownContent content={contentPreview} className="text-xs text-muted-foreground [&>*]:inline" />
        </div>
      )}

      <RelativeTime date={createdAt} className="text-xs text-muted-foreground/60 mt-1 block" />
    </div>
  )
}
