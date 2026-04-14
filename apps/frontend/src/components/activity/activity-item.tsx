import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import { UnreadDot } from "./unread-dot"
import { ActivityContent } from "./activity-content"
import type { Activity } from "@threa/types"

interface ActivityItemProps {
  activity: Activity
  actorName: string
  streamName: string
  workspaceId: string
  toEmoji?: (shortcode: string) => string | null
  onMarkAsRead: (activityId: string) => void
}

export function ActivityItem({
  activity,
  actorName,
  streamName,
  workspaceId,
  toEmoji,
  onMarkAsRead,
}: ActivityItemProps) {
  // Self rows are inserted already read by the backend, so the unread dot is
  // never shown for them regardless of the `readAt` value. Give them a muted
  // background so they're visually distinct from things others did.
  const isSelf = activity.isSelf
  const isUnread = !isSelf && !activity.readAt
  const contentPreview = (activity.context.contentPreview as string) ?? ""

  return (
    <Link
      to={`/w/${workspaceId}/s/${activity.streamId}?m=${activity.messageId}`}
      onClick={() => {
        if (isUnread) onMarkAsRead(activity.id)
      }}
      className={cn(
        "group flex items-start gap-3 rounded-lg px-4 py-3 transition-colors",
        isUnread && "bg-primary/5 hover:bg-primary/10",
        !isUnread && !isSelf && "hover:bg-muted/50",
        isSelf && "opacity-75 hover:bg-muted/40 hover:opacity-100"
      )}
    >
      <UnreadDot isUnread={isUnread} />
      <ActivityContent
        actorName={actorName}
        streamName={streamName}
        activityType={activity.activityType}
        contentPreview={contentPreview}
        emoji={activity.emoji}
        toEmoji={toEmoji}
        createdAt={activity.createdAt}
        isUnread={isUnread}
        isSelf={isSelf}
      />
    </Link>
  )
}
