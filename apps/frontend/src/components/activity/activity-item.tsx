import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import { RelativeTime } from "@/components/relative-time"
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
      {/* Unread indicator */}
      <div className="mt-2 flex-shrink-0">
        <div className={cn("h-2 w-2 rounded-full transition-colors", isUnread ? "bg-blue-500" : "bg-transparent")} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 text-sm">
          <span className={cn("font-medium", isUnread && "font-semibold")}>{actorName}</span>
          <span className="text-muted-foreground">mentioned you in</span>
          <span className="font-medium truncate">{streamName}</span>
        </div>

        {contentPreview && (
          <p className="mt-0.5 text-xs text-muted-foreground truncate">&ldquo;{contentPreview}&rdquo;</p>
        )}

        <RelativeTime date={activity.createdAt} className="text-xs text-muted-foreground/60 mt-1 block" />
      </div>
    </Link>
  )
}
