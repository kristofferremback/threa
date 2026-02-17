import type { StreamEvent } from "@threa/types"
import type { MessageAgentActivity } from "@/hooks"
import { MessageEvent } from "./message-event"
import { MembershipEvent } from "./membership-event"
import { SystemEvent } from "./system-event"

interface EventItemProps {
  event: StreamEvent
  workspaceId: string
  streamId: string
  /** Hide action buttons (e.g., reply) - used when showing parent message in thread view */
  hideActions?: boolean
  /** ID of message to highlight and scroll to */
  highlightMessageId?: string | null
  /** Active agent sessions mapped by trigger message ID */
  agentActivity?: Map<string, MessageAgentActivity>
}

export function EventItem({
  event,
  workspaceId,
  streamId,
  hideActions,
  highlightMessageId,
  agentActivity,
}: EventItemProps) {
  // Check if this event's message should be highlighted
  const messageId = (event.payload as { messageId?: string })?.messageId
  const isHighlighted = highlightMessageId != null && messageId === highlightMessageId

  switch (event.eventType) {
    case "message_created":
    case "companion_response": {
      const payload = event.payload as { deletedAt?: string }
      if (payload.deletedAt) {
        return (
          <div data-event-id={event.id}>
            <DeletedMessageEvent event={event} />
          </div>
        )
      }
      return (
        <div data-event-id={event.id}>
          <MessageEvent
            event={event}
            workspaceId={workspaceId}
            streamId={streamId}
            hideActions={hideActions}
            isHighlighted={isHighlighted}
            activity={messageId ? agentActivity?.get(messageId) : undefined}
          />
        </div>
      )
    }

    case "message_deleted":
      return (
        <div data-event-id={event.id}>
          <DeletedMessageEvent event={event} />
        </div>
      )

    case "member_joined":
    case "member_left":
      return (
        <div data-event-id={event.id}>
          <MembershipEvent event={event} workspaceId={workspaceId} />
        </div>
      )

    case "thread_created":
      return (
        <div data-event-id={event.id}>
          <SystemEvent event={event} />
        </div>
      )

    case "reaction_added":
    case "reaction_removed":
      // Reactions update the parent message in place, not rendered as separate items
      return null

    case "command_dispatched":
    case "command_completed":
    case "command_failed":
      // Command events are grouped and rendered in EventList, not here
      return null

    case "agent_session:started":
    case "agent_session:completed":
    case "agent_session:failed":
      // Agent session events are grouped and rendered in EventList, not here
      return null

    default:
      // Unknown event type - render as system event
      return (
        <div data-event-id={event.id}>
          <SystemEvent event={event} />
        </div>
      )
  }
}

function DeletedMessageEvent(_props: { event: StreamEvent }) {
  return (
    <div className="py-2 text-center">
      <p className="text-sm italic text-muted-foreground">This message was deleted</p>
    </div>
  )
}
