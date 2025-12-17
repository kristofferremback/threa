import type { StreamEvent } from "@/types/domain"
import { MessageEvent } from "./message-event"
import { MembershipEvent } from "./membership-event"
import { SystemEvent } from "./system-event"

interface EventItemProps {
  event: StreamEvent
  workspaceId: string
  streamId: string
}

export function EventItem({ event, workspaceId, streamId }: EventItemProps) {
  switch (event.eventType) {
    case "message_created":
    case "message_edited":
    case "companion_response":
      return (
        <MessageEvent
          event={event}
          workspaceId={workspaceId}
          streamId={streamId}
        />
      )

    case "message_deleted":
      return <DeletedMessageEvent event={event} />

    case "member_joined":
    case "member_left":
      return <MembershipEvent event={event} />

    case "thread_created":
      return <SystemEvent event={event} />

    case "reaction_added":
    case "reaction_removed":
      // Reactions update the parent message in place, not rendered as separate items
      return null

    default:
      // Unknown event type - render as system event
      return <SystemEvent event={event} />
  }
}

function DeletedMessageEvent(_props: { event: StreamEvent }) {
  return (
    <div className="py-2 text-center">
      <p className="text-sm italic text-muted-foreground">This message was deleted</p>
    </div>
  )
}
