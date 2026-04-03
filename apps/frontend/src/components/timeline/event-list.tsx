import { memo, useMemo } from "react"
import type { Virtualizer } from "@tanstack/react-virtual"
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
import { useCoordinatedLoading } from "@/contexts"
import { EventItem } from "./event-item"
import { AgentSessionEvent } from "./agent-session-event"
import { CommandEvent } from "./command-event"
import { UnreadDivider } from "./unread-divider"
import { Skeleton } from "@/components/ui/skeleton"

interface EventListProps {
  timelineItems: TimelineItem[]
  isLoading: boolean
  workspaceId: string
  streamId: string
  highlightMessageId?: string | null
  firstUnreadEventId?: string
  isDividerFading?: boolean
  agentActivity?: Map<string, MessageAgentActivity>
  /** Hide session group cards (used in channels where responses go to threads) */
  hideSessionCards?: boolean
  /** Event IDs that just arrived via socket and should flash briefly */
  newMessageIds?: Set<string>
  /** Virtualizer instance — when provided, renders only visible items */
  virtualizer?: Virtualizer<HTMLDivElement, Element>
  /** True during initial measurement settle — items render hidden so ResizeObserver can measure */
  isSettling?: boolean
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
export type TimelineItem =
  | { type: "event"; event: StreamEvent }
  | { type: "command_group"; commandId: string; events: StreamEvent[] }
  | { type: "session_group"; sessionId: string; sessionVersion: number; events: StreamEvent[] }

/**
 * Content-aware height estimate for a timeline item. Used by the virtualizer
 * for items that haven't been measured yet — closer estimates reduce layout
 * jumps, scroll drift after prepend, and visual gaps while scrolling.
 */
export function estimateTimelineItemHeight(item: TimelineItem): number {
  if (item.type === "command_group") return 56
  if (item.type === "session_group") return 72

  const event = item.event
  const { eventType } = event

  // Compact system/membership events
  if (
    eventType === "message_deleted" ||
    eventType === "member_joined" ||
    eventType === "member_left" ||
    eventType === "member_added" ||
    eventType === "thread_created" ||
    eventType === "stream_archived" ||
    eventType === "stream_unarchived"
  ) {
    return 36
  }

  if (eventType === "message_created" || eventType === "companion_response") {
    const payload = event.payload as Record<string, unknown>
    if (payload.deletedAt) return 36

    // Base: avatar row + name/timestamp + bottom margin (mb-5 = 20px)
    let height = 72

    // Text: ~20px per line, ~80 chars per line on mobile-ish widths
    const markdown = (payload.contentMarkdown as string) ?? ""
    height += Math.max(1, Math.ceil(markdown.length / 80)) * 20

    // Image attachments: h-32 (128px) + gap/margin
    const attachments = payload.attachments as Array<{ mimeType?: string }> | undefined
    if (attachments && attachments.length > 0) {
      if (attachments.some((a) => a.mimeType?.startsWith("image/"))) height += 150
      if (attachments.some((a) => !a.mimeType?.startsWith("image/"))) height += 40
    }

    // Link previews: ~90px per card (capped at DEFAULT_VISIBLE_COUNT=3)
    const linkPreviews = payload.linkPreviews as Array<unknown> | undefined
    if (linkPreviews && linkPreviews.length > 0) {
      height += Math.min(linkPreviews.length, 3) * 90
    }

    return height
  }

  return 100
}

/** Event types that render as null in EventItem (handled elsewhere or invisible) */
const ZERO_HEIGHT_EVENT_TYPES = new Set([
  "reaction_added",
  "reaction_removed",
  "command_dispatched",
  "command_completed",
  "command_failed",
  "agent_session:started",
  "agent_session:completed",
  "agent_session:failed",
  "agent_session:deleted",
])

/**
 * Filters out timeline items that would render as zero-height elements.
 * Must be applied before computing virtualizer count/keys to prevent overlap.
 */
export function filterVisibleItems(items: TimelineItem[], hideSessionCards?: boolean): TimelineItem[] {
  return items.filter((item) => {
    if (item.type === "session_group" && hideSessionCards) return false
    if (item.type === "event" && ZERO_HEIGHT_EVENT_TYPES.has(item.event.eventType)) return false
    return true
  })
}

/** Returns a stable key string for a timeline item */
export function getTimelineItemKey(item: TimelineItem): string {
  switch (item.type) {
    case "command_group":
      return item.commandId
    case "session_group":
      return item.sessionId
    default:
      return item.event.id
  }
}

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

export const EventList = memo(function EventList({
  timelineItems,
  isLoading,
  workspaceId,
  streamId,
  highlightMessageId,
  firstUnreadEventId,
  isDividerFading,
  agentActivity,
  hideSessionCards,
  newMessageIds,
  virtualizer,
}: EventListProps) {
  const { phase } = useCoordinatedLoading()

  const sessionLiveCounts = useMemo(() => {
    const counts = new Map<string, { stepCount: number; messageCount: number }>()
    if (agentActivity) {
      for (const activity of agentActivity.values()) {
        counts.set(activity.sessionId, {
          stepCount: activity.stepCount,
          messageCount: activity.messageCount,
        })
      }
    }
    return counts
  }, [agentActivity])

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </div>
    )
  }

  if (timelineItems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No messages yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Start the conversation by sending a message below</p>
        </div>
      </div>
    )
  }

  // Helper to check if an item is the first unread event
  const isFirstUnread = (item: TimelineItem): boolean => {
    if (!firstUnreadEventId) return false
    if (item.type === "command_group" || item.type === "session_group") {
      return item.events[0]?.id === firstUnreadEventId
    }
    return item.event.id === firstUnreadEventId
  }

  const renderItem = (item: TimelineItem) => {
    const showUnreadDivider = isFirstUnread(item)
    return (
      <>
        {showUnreadDivider && <UnreadDivider isFading={isDividerFading} />}
        {item.type === "command_group" && (
          <div className="px-3 sm:px-6">
            <CommandEvent events={item.events} />
          </div>
        )}
        {item.type === "session_group" && !hideSessionCards && (
          <div className="px-3 sm:px-6">
            <AgentSessionEvent
              events={item.events}
              sessionVersion={item.sessionVersion}
              liveCounts={sessionLiveCounts.get(item.sessionId)}
            />
          </div>
        )}
        {item.type === "event" && (
          <EventItem
            event={item.event}
            workspaceId={workspaceId}
            streamId={streamId}
            highlightMessageId={highlightMessageId}
            agentActivity={hideSessionCards ? agentActivity : undefined}
            isNew={newMessageIds?.has(item.event.id)}
            deferSecondaryHydration={phase !== "ready"}
          />
        )}
      </>
    )
  }

  // --- Virtualized rendering ---
  // Uses the TanStack Virtual "dynamic" example pattern: a single absolutely-
  // positioned wrapper translated to the first virtual item's offset, with
  // items in normal document flow inside. This prevents overlap and gaps
  // because the browser's layout engine spaces items naturally rather than
  // relying on the virtualizer's per-item position calculations.
  if (virtualizer) {
    const virtualItems = virtualizer.getVirtualItems()
    return (
      <div className="relative py-3 sm:py-6 mx-auto max-w-[800px] w-full min-w-0">
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
            }}
          >
            {virtualItems.map((virtualRow) => {
              const item = timelineItems[virtualRow.index]
              if (!item) return null
              return (
                <div key={virtualRow.key} data-index={virtualRow.index} ref={virtualizer.measureElement}>
                  {renderItem(item)}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // --- Non-virtualized fallback (for threads, etc.) ---
  return (
    <div className="flex flex-col py-3 sm:py-6 mx-auto max-w-[800px] w-full min-w-0">
      {timelineItems.map((item) => {
        const itemKey = getTimelineItemKey(item)
        return (
          <div key={itemKey} className={isFirstUnread(item) ? "relative" : undefined}>
            {renderItem(item)}
          </div>
        )
      })}
    </div>
  )
})
