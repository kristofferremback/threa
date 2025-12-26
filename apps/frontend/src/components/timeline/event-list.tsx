import {
  COMMAND_EVENT_TYPES,
  type CommandEventType,
  type StreamEvent,
  type CommandDispatchedPayload,
  type CommandCompletedPayload,
  type CommandFailedPayload,
} from "@threa/types"
import { EventItem } from "./event-item"
import { CommandEvent } from "./command-event"
import { useUser } from "@/auth"

interface EventListProps {
  events: StreamEvent[]
  isLoading: boolean
  workspaceId: string
  streamId: string
  highlightMessageId?: string | null
}

function isCommandEvent(event: StreamEvent): boolean {
  return COMMAND_EVENT_TYPES.includes(event.eventType as CommandEventType)
}

function getCommandId(event: StreamEvent): string | null {
  if (!isCommandEvent(event)) return null
  const payload = event.payload as CommandDispatchedPayload | CommandCompletedPayload | CommandFailedPayload
  return payload.commandId
}

/** Represents either a regular event or a group of command events */
type TimelineItem =
  | { type: "event"; event: StreamEvent }
  | { type: "command_group"; commandId: string; events: StreamEvent[] }

/**
 * Groups command events by commandId while preserving order.
 * Command groups appear at the position of their first (dispatched) event.
 */
function groupTimelineItems(events: StreamEvent[], currentUserId: string | undefined): TimelineItem[] {
  const result: TimelineItem[] = []
  const commandGroups = new Map<string, StreamEvent[]>()
  const commandPositions = new Map<string, number>() // commandId → position in result

  for (const event of events) {
    const commandId = getCommandId(event)

    if (commandId) {
      // Skip command events that aren't from the current user
      if (event.actorId !== currentUserId) continue

      if (!commandGroups.has(commandId)) {
        // First event for this command - record position
        commandGroups.set(commandId, [])
        commandPositions.set(commandId, result.length)
        result.push({ type: "command_group", commandId, events: [] })
      }
      commandGroups.get(commandId)!.push(event)
    } else {
      result.push({ type: "event", event })
    }
  }

  // Fill in command groups with their events
  for (const [commandId, events] of commandGroups) {
    const position = commandPositions.get(commandId)!
    result[position] = { type: "command_group", commandId, events }
  }

  return result
}

export function EventList({ events, isLoading, workspaceId, streamId, highlightMessageId }: EventListProps) {
  const user = useUser()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No messages yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Start the conversation by sending a message below</p>
        </div>
      </div>
    )
  }

  const timelineItems = groupTimelineItems(events, user?.id)

  return (
    <div className="flex flex-col gap-1 p-4">
      {timelineItems.map((item) => {
        if (item.type === "command_group") {
          return <CommandEvent key={`cmd-${item.commandId}`} events={item.events} />
        }
        return (
          <EventItem
            key={item.event.id}
            event={item.event}
            workspaceId={workspaceId}
            streamId={streamId}
            highlightMessageId={highlightMessageId}
          />
        )
      })}
    </div>
  )
}
