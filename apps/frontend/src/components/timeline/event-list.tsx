import {
  COMMAND_EVENT_TYPES,
  AGENT_SESSION_EVENT_TYPES,
  type CommandEventType,
  type AgentSessionEventType,
  type AgentSessionStartedPayload,
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

function getTriggerMessageId(event: StreamEvent): string | null {
  if (event.eventType !== "agent_session:started") return null
  return (event.payload as AgentSessionStartedPayload).triggerMessageId ?? null
}

function getSessionSlotKey(sessionId: string, triggerMessageId: string | null): string {
  return triggerMessageId ? `trigger:${triggerMessageId}` : `session:${sessionId}`
}

/** Represents either a regular event, a group of command events, or a group of agent session events */
type TimelineItem =
  | { type: "event"; event: StreamEvent }
  | { type: "command_group"; commandId: string; events: StreamEvent[] }
  | { type: "session_group"; sessionId: string; sessionVersion: number; events: StreamEvent[] }

/**
 * Groups command events by commandId and agent session events by trigger-message slot.
 * For superseding sessions, the newer session replaces the old slot in place.
 */
export function groupTimelineItems(events: StreamEvent[], currentUserId: string | undefined): TimelineItem[] {
  const result: TimelineItem[] = []
  const commandGroups = new Map<string, StreamEvent[]>()
  const commandPositions = new Map<string, number>()
  const sessionSlots = new Map<string, { sessionId: string; sessionVersion: number; events: StreamEvent[] }>()
  const sessionSlotPositions = new Map<string, number>()
  const triggerBySessionId = new Map<string, string>()
  const sessionVersionById = new Map<string, number>()
  const nextVersionBySlot = new Map<string, number>()

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
      const triggerMessageId = getTriggerMessageId(event)
      if (triggerMessageId) {
        triggerBySessionId.set(agentSessionId, triggerMessageId)
      }

      const knownTriggerMessageId = triggerBySessionId.get(agentSessionId) ?? null
      const sessionSlotKey = getSessionSlotKey(agentSessionId, knownTriggerMessageId)
      if (event.eventType === "agent_session:started") {
        const nextVersion = (nextVersionBySlot.get(sessionSlotKey) ?? 0) + 1
        nextVersionBySlot.set(sessionSlotKey, nextVersion)
        sessionVersionById.set(agentSessionId, nextVersion)
      }
      const sessionVersion = sessionVersionById.get(agentSessionId) ?? 1

      if (!sessionSlots.has(sessionSlotKey)) {
        sessionSlots.set(sessionSlotKey, { sessionId: agentSessionId, sessionVersion, events: [] })
        sessionSlotPositions.set(sessionSlotKey, result.length)
        result.push({ type: "session_group", sessionId: agentSessionId, sessionVersion, events: [] })
      }

      const slot = sessionSlots.get(sessionSlotKey)!

      if (event.eventType === "agent_session:started" && slot.sessionId !== agentSessionId) {
        slot.sessionId = agentSessionId
        slot.sessionVersion = sessionVersion
        slot.events = [event]
        continue
      }

      if (slot.sessionId !== agentSessionId) {
        continue
      }

      slot.events.push(event)
    } else {
      result.push({ type: "event", event })
    }
  }

  // Fill in command groups with their events
  for (const [commandId, events] of commandGroups) {
    const position = commandPositions.get(commandId)!
    result[position] = { type: "command_group", commandId, events }
  }

  // Fill in session slots with their active session events
  for (const [sessionSlotKey, slot] of sessionSlots) {
    const position = sessionSlotPositions.get(sessionSlotKey)!
    result[position] = {
      type: "session_group",
      sessionId: slot.sessionId,
      sessionVersion: slot.sessionVersion,
      events: slot.events,
    }
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
                <AgentSessionEvent
                  events={item.events}
                  sessionVersion={item.sessionVersion}
                  liveCounts={sessionLiveCounts.get(item.sessionId)}
                />
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
