import { useState, useMemo } from "react"
import { useParams, Link } from "react-router-dom"
import { Bell, ArrowLeft, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useActivityFeed, useMarkActivityRead, useMarkAllActivityRead, useActors, useWorkspaceBootstrap } from "@/hooks"
import { useActivityCounts } from "@/hooks/use-activity-counts"
import { getStreamName, streamFallbackLabel } from "@/lib/streams"
import { ActivityItem } from "@/components/activity/activity-item"
import { ActivityEmpty } from "@/components/activity/activity-empty"
import { ActivitySkeleton } from "@/components/activity/activity-skeleton"
import type { AuthorType, Activity } from "@threa/types"

export function ActivityPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const { data: activities, isLoading } = useActivityFeed(workspaceId ?? "", { unreadOnly })
  const markRead = useMarkActivityRead(workspaceId ?? "")
  const markAllRead = useMarkAllActivityRead(workspaceId ?? "")
  const { getActorName } = useActors(workspaceId ?? "")
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId ?? "")
  const { unreadActivityCount } = useActivityCounts(workspaceId ?? "")

  const streamById = useMemo(() => {
    const streams = bootstrap?.streams ?? []
    return new Map(streams.map((s) => [s.id, s]))
  }, [bootstrap?.streams])

  function resolveActivityStreamName(activity: Activity): string {
    const stream = streamById.get(activity.streamId)

    if (stream) {
      const name = getStreamName(stream)
      if (name) return name

      // Unnamed thread → show parent context
      if (stream.type === "thread" && stream.rootStreamId) {
        const root = streamById.get(stream.rootStreamId)
        const rootName = root ? getStreamName(root) : null
        if (rootName) return `a thread in ${rootName}`
      }

      return streamFallbackLabel(stream.type, "activity")
    }

    // Stream not in bootstrap — fall back to activity context snapshot
    const ctx = activity.context as {
      parentStreamName?: string
      streamName?: string
      rootStreamId?: string
    }

    if (ctx.parentStreamName) return `a thread in ${ctx.parentStreamName}`
    if (ctx.rootStreamId) {
      const root = streamById.get(ctx.rootStreamId)
      const rootName = root ? getStreamName(root) : null
      if (rootName) return `a thread in ${rootName}`
    }

    if (ctx.streamName && ctx.streamName !== "Untitled") return ctx.streamName
    return streamFallbackLabel("thread", "activity")
  }

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
          <Tabs value={unreadOnly ? "unread" : "all"} onValueChange={(v) => setUnreadOnly(v === "unread")}>
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-2.5 py-1">
                All
              </TabsTrigger>
              <TabsTrigger value="unread" className="text-xs px-2.5 py-1">
                Unread
              </TabsTrigger>
            </TabsList>
          </Tabs>

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
                  actorName={getActorName(activity.actorId, activity.actorType as AuthorType)}
                  streamName={resolveActivityStreamName(activity)}
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
