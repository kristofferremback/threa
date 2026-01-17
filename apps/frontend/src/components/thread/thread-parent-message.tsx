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
      <div className="pt-4 pb-2">
        <div className="px-6 mx-auto max-w-[800px] w-full min-w-0">
          <EventItem event={event} workspaceId={workspaceId} streamId={streamId} hideActions />
        </div>
      </div>
      <Separator />
      <div className="py-2 bg-muted/30 text-xs text-muted-foreground">
        <div className="px-6 mx-auto max-w-[800px] w-full min-w-0">
          {replyCount} {replyCount === 1 ? "reply" : "replies"}
        </div>
      </div>
    </div>
  )
}
