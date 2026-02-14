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
  onMarkAsRead: (activityId: string) => void
}

export function ActivityItem({ activity, actorName, streamName, workspaceId, onMarkAsRead }: ActivityItemProps) {
  const isUnread = !activity.readAt
  const contentPreview = (activity.context.contentPreview as string) ?? ""

  return (
    <Link
      to={`/w/${workspaceId}/s/${activity.streamId}`}
      onClick={() => {
        if (isUnread) onMarkAsRead(activity.id)
      }}
      className={cn(
        "group flex items-start gap-3 rounded-lg px-4 py-3 transition-colors",
        isUnread ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"
      )}
    >
      <UnreadDot isUnread={isUnread} />
      <ActivityContent
        actorName={actorName}
        streamName={streamName}
        activityType={activity.activityType}
        contentPreview={contentPreview}
        createdAt={activity.createdAt}
        isUnread={isUnread}
      />
    </Link>
  )
}
