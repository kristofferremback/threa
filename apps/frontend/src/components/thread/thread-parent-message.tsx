import { Separator } from "@/components/ui/separator"
import { EventItem } from "@/components/timeline"
import type { StreamEvent } from "@threa/types"

interface ThreadParentMessageProps {
  event: StreamEvent
  workspaceId: string
  streamId: string
  replyCount: number
}

export function ThreadParentMessage({ event, workspaceId, streamId, replyCount }: ThreadParentMessageProps) {
  return (
    <div className="border-b">
      <div className="p-4">
        <EventItem event={event} workspaceId={workspaceId} streamId={streamId} hideActions />
      </div>
      <Separator />
      <div className="py-2 px-4 text-xs text-muted-foreground bg-muted/30">
        {replyCount} {replyCount === 1 ? "reply" : "replies"}
      </div>
    </div>
  )
}
