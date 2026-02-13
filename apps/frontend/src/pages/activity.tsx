import { useState, useMemo } from "react"
import { useParams, Link } from "react-router-dom"
import { Bell, ArrowLeft, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useActivityFeed, useMarkActivityRead, useMarkAllActivityRead, useActors, useWorkspaceBootstrap } from "@/hooks"
import { useMentionCounts } from "@/hooks/use-mention-counts"
import { ActivityItem } from "@/components/activity/activity-item"
import { ActivityEmpty } from "@/components/activity/activity-empty"
import type { StreamWithPreview } from "@threa/types"

function getStreamDisplayName(stream: StreamWithPreview): string {
  if (stream.slug) return `#${stream.slug}`
  return stream.displayName || "Untitled"
}

export function ActivityPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const { data: activities, isLoading } = useActivityFeed(workspaceId ?? "", { unreadOnly })
  const markRead = useMarkActivityRead(workspaceId ?? "")
  const markAllRead = useMarkAllActivityRead(workspaceId ?? "")
  const { getActorName } = useActors(workspaceId ?? "")
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId ?? "")
  const { unreadActivityCount } = useMentionCounts(workspaceId ?? "")

  const streamNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const stream of bootstrap?.streams ?? []) {
      map.set(stream.id, getStreamDisplayName(stream))
    }
    return map
  }, [bootstrap?.streams])

  if (!workspaceId) return null

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <Link to={`/w/${workspaceId}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <h1 className="font-semibold">Activity</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter tabs */}
          <div className="flex gap-1 bg-muted rounded-md p-0.5">
            <button
              onClick={() => setUnreadOnly(false)}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium transition-all",
                !unreadOnly ? "bg-card text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              All
            </button>
            <button
              onClick={() => setUnreadOnly(true)}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium transition-all",
                unreadOnly ? "bg-card text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Unread
            </button>
          </div>

          {/* Mark all as read */}
          {unreadActivityCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="text-xs gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>
      </header>

      <ScrollArea className="flex-1">
        <main className="py-2">
          {isLoading ? (
            <ActivitySkeleton />
          ) : !activities?.length ? (
            <ActivityEmpty isFiltered={unreadOnly} />
          ) : (
            <div className="flex flex-col gap-0.5">
              {activities.map((activity) => (
                <ActivityItem
                  key={activity.id}
                  activity={activity}
                  actorName={getActorName(activity.actorId, "member")}
                  streamName={streamNameMap.get(activity.streamId) ?? "Unknown stream"}
                  workspaceId={workspaceId}
                  onMarkAsRead={(id) => markRead.mutate(id)}
                />
              ))}
            </div>
          )}
        </main>
      </ScrollArea>
    </div>
  )
}

function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-2 px-4 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-3">
          <Skeleton className="h-2 w-2 rounded-full mt-2" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
