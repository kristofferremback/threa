import { useState, useMemo } from "react"
import { useParams, Link } from "react-router-dom"
import { Bell, ArrowLeft, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useActivityFeed, useMarkActivityRead, useMarkAllActivityRead, useActors } from "@/hooks"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { useWorkspaceStreams } from "@/stores/workspace-store"
import { useActivityCounts } from "@/hooks/use-activity-counts"
import { getStreamName, streamFallbackLabel } from "@/lib/streams"
import { ActivityItem } from "@/components/activity/activity-item"
import { ActivityEmpty } from "@/components/activity/activity-empty"
import { ActivitySkeleton } from "@/components/activity/activity-skeleton"
import type { AuthorType, Activity } from "@threa/types"

type ActivityFilter = "all" | "unread" | "me"

export function ActivityPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [filter, setFilter] = useState<ActivityFilter>("all")
  const { data: activities, isLoading } = useActivityFeed(workspaceId ?? "", {
    unreadOnly: filter === "unread",
    mineOnly: filter === "me",
  })
  const markRead = useMarkActivityRead(workspaceId ?? "")
  const markAllRead = useMarkAllActivityRead(workspaceId ?? "")
  const { getActorName, getActorAvatar } = useActors(workspaceId ?? "")
  const { toEmoji } = useWorkspaceEmoji(workspaceId ?? "")
  const idbStreams = useWorkspaceStreams(workspaceId ?? "")
  const { unreadActivityCount } = useActivityCounts(workspaceId ?? "")

  const streamById = useMemo(() => {
    return new Map(idbStreams.map((s) => [s.id, s]))
  }, [idbStreams])

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

  let content = <ActivitySkeleton />
  if (!isLoading) {
    if (!activities?.length) {
      content = <ActivityEmpty isFiltered={filter !== "all"} />
    } else {
      content = (
        <div className="flex flex-col gap-0.5">
          {activities.map((activity) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              actorName={getActorName(activity.actorId, activity.actorType as AuthorType)}
              actorAvatar={getActorAvatar(activity.actorId, activity.actorType as AuthorType)}
              streamName={resolveActivityStreamName(activity)}
              workspaceId={workspaceId}
              toEmoji={toEmoji}
              onMarkAsRead={(id) => markRead.mutate(id)}
            />
          ))}
        </div>
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 items-center justify-between border-b px-4 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Link to={`/w/${workspaceId}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <Bell className="h-5 w-5 text-muted-foreground shrink-0" />
            <h1 className="font-semibold truncate">Activity</h1>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as ActivityFilter)}>
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-2.5 py-1">
                All
              </TabsTrigger>
              <TabsTrigger value="unread" className="text-xs px-2.5 py-1">
                Unread
              </TabsTrigger>
              <TabsTrigger value="me" className="text-xs px-2.5 py-1">
                Me
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {unreadActivityCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="text-xs gap-1.5 max-sm:h-8 max-sm:w-8 max-sm:p-0"
              title="Mark all read"
            >
              <Check className="h-3.5 w-3.5" />
              <span className="max-sm:hidden">Mark all read</span>
            </Button>
          )}
        </div>
      </header>

      <ScrollArea className="flex-1 [&>div>div]:!block [&>div>div]:!w-full">
        <main className="py-2">{content}</main>
      </ScrollArea>
    </div>
  )
}
