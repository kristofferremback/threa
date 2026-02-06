import {
  COMMAND_EVENT_TYPES,
  AGENT_SESSION_EVENT_TYPES,
  type CommandEventType,
  type AgentSessionEventType,
  type StreamEvent,
  type CommandDispatchedPayload,
  type CommandCompletedPayload,
  type CommandFailedPayload,
} from "@threa/types"
import type { MessageAgentActivity } from "@/hooks"
import { EventItem } from "./event-item"
import { AgentSessionEvent } from "./agent-session-event"
import { CommandEvent } from "./command-event"
import { UnreadDivider } from "./unread-divider"
import { useUser } from "@/auth"

interface EventListProps {
  events: StreamEvent[]
  isLoading: boolean
  workspaceId: string
  streamId: string
  highlightMessageId?: string | null
  firstUnreadEventId?: string
  isDividerFading?: boolean
  agentActivity?: Map<string, MessageAgentActivity>
  /** Hide session group cards (used in channels where responses go to threads) */
  hideSessionCards?: boolean
}

function isCommandEvent(event: StreamEvent): boolean {
  return COMMAND_EVENT_TYPES.includes(event.eventType as CommandEventType)
}

function getCommandId(event: StreamEvent): string | null {
  if (!isCommandEvent(event)) return null
  const payload = event.payload as CommandDispatchedPayload | CommandCompletedPayload | CommandFailedPayload
  return payload.commandId
}

function isAgentSessionEvent(event: StreamEvent): boolean {
  return AGENT_SESSION_EVENT_TYPES.includes(event.eventType as AgentSessionEventType)
}

function getSessionId(event: StreamEvent): string | null {
  if (!isAgentSessionEvent(event)) return null
  return (event.payload as { sessionId?: string })?.sessionId ?? null
}

/** Represents either a regular event, a group of command events, or a group of agent session events */
type TimelineItem =
  | { type: "event"; event: StreamEvent }
  | { type: "command_group"; commandId: string; events: StreamEvent[] }
  | { type: "session_group"; sessionId: string; events: StreamEvent[] }

/**
 * Groups command events by commandId and agent session events by sessionId
 * while preserving order. Groups appear at the position of their first event.
 */
function groupTimelineItems(events: StreamEvent[], currentUserId: string | undefined): TimelineItem[] {
  const result: TimelineItem[] = []
  const commandGroups = new Map<string, StreamEvent[]>()
  const commandPositions = new Map<string, number>()
  const sessionGroups = new Map<string, StreamEvent[]>()
  const sessionPositions = new Map<string, number>()

  for (const event of events) {
    const commandId = getCommandId(event)
    const agentSessionId = getSessionId(event)

    if (commandId) {
      // Skip command events that aren't from the current user
      if (event.actorId !== currentUserId) continue

      if (!commandGroups.has(commandId)) {
        commandGroups.set(commandId, [])
        commandPositions.set(commandId, result.length)
        result.push({ type: "command_group", commandId, events: [] })
      }
      commandGroups.get(commandId)!.push(event)
    } else if (agentSessionId) {
      if (!sessionGroups.has(agentSessionId)) {
        sessionGroups.set(agentSessionId, [])
        sessionPositions.set(agentSessionId, result.length)
        result.push({ type: "session_group", sessionId: agentSessionId, events: [] })
      }
      sessionGroups.get(agentSessionId)!.push(event)
    } else {
      result.push({ type: "event", event })
    }
  }

  // Fill in command groups with their events
  for (const [commandId, events] of commandGroups) {
    const position = commandPositions.get(commandId)!
    result[position] = { type: "command_group", commandId, events }
  }

  // Fill in session groups with their events
  for (const [sessionId, events] of sessionGroups) {
    const position = sessionPositions.get(sessionId)!
    result[position] = { type: "session_group", sessionId, events }
  }

  return result
}

export function EventList({
  events,
  isLoading,
  workspaceId,
  streamId,
  highlightMessageId,
  firstUnreadEventId,
  isDividerFading,
  agentActivity,
  hideSessionCards,
}: EventListProps) {
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

  // Helper to check if an item is the first unread event
  const isFirstUnread = (item: TimelineItem): boolean => {
    if (!firstUnreadEventId) return false
    if (item.type === "command_group" || item.type === "session_group") {
      return item.events[0]?.id === firstUnreadEventId
    }
    return item.event.id === firstUnreadEventId
  }

  // Build sessionId → live counts lookup from agentActivity (keyed by triggerMessageId)
  const sessionLiveCounts = new Map<string, { stepCount: number; messageCount: number }>()
  if (agentActivity) {
    for (const activity of agentActivity.values()) {
      sessionLiveCounts.set(activity.sessionId, {
        stepCount: activity.stepCount,
        messageCount: activity.messageCount,
      })
    }
  }

  return (
    <div className="flex flex-col p-6 mx-auto max-w-[800px] w-full min-w-0">
      {timelineItems.map((item) => {
        const showUnreadDivider = isFirstUnread(item)
        let eventId: string
        switch (item.type) {
          case "command_group":
            eventId = item.commandId
            break
          case "session_group":
            eventId = item.sessionId
            break
          default:
            eventId = item.event.id
        }

        return (
          <div key={eventId} className={showUnreadDivider ? "relative" : undefined}>
            {showUnreadDivider && <UnreadDivider isFading={isDividerFading} />}
            {item.type === "command_group" ? (
              <CommandEvent events={item.events} />
            ) : item.type === "session_group" ? (
              hideSessionCards ? null : (
                <AgentSessionEvent events={item.events} liveCounts={sessionLiveCounts.get(item.sessionId)} />
              )
            ) : (
              <EventItem
                event={item.event}
                workspaceId={workspaceId}
                streamId={streamId}
                highlightMessageId={highlightMessageId}
                agentActivity={hideSessionCards ? agentActivity : undefined}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
