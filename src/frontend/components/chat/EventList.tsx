import { useMemo } from "react"
import { MessageList } from "./MessageList"
import type { StreamEvent, OpenMode, Message } from "../../types"
import type { AgentSession } from "./AgentThinkingEvent"

interface EventListProps {
  events: StreamEvent[]
  sessions?: AgentSession[]
  workspaceId: string
  streamId?: string
  lastReadEventId: string | null
  isLoading: boolean
  isLoadingMore: boolean
  hasMoreEvents: boolean
  isThread: boolean
  rootEvent?: StreamEvent | null
  currentUserId: string | null
  highlightEventId?: string
  onOpenThread: (eventId: string, mode: OpenMode) => void
  onEditEvent: (eventId: string, newContent: string) => Promise<void>
  onLoadMore: () => Promise<void>
  onShareToStream: (eventId: string) => Promise<void>
  onCrosspostToStream: (eventId: string, targetStreamId: string) => Promise<void>
  onRetryMessage?: (eventId: string) => void
  onStreamClick: (slug: string, e: React.MouseEvent) => void
  users: Array<{ id: string; name: string; email: string }>
  streams: Array<{ id: string; name: string; slug: string | null }>
}

// System event types that should be displayed
// Note: thread_started is excluded - it's stored in the parent channel but only
// useful as metadata (threads are shown via reply counts on messages instead)
const SYSTEM_EVENT_TYPES = ["member_joined", "member_left", "stream_created"]

// Event types to render
const RENDERABLE_EVENT_TYPES = ["message", "shared", "agent_thinking", ...SYSTEM_EVENT_TYPES]

// Convert StreamEvent to Message format for MessageList compatibility
function eventToMessage(event: StreamEvent, streamId?: string): Message {
  const isSystemEvent = SYSTEM_EVENT_TYPES.includes(event.eventType)
  const isSharedEvent = event.eventType === "shared"
  const isAgentThinking = event.eventType === "agent_thinking"

  // For shared events, use the original event's content
  const originalEvent = event.originalEvent
  const content = isSharedEvent && originalEvent ? originalEvent.content : event.content
  const mentions = isSharedEvent && originalEvent ? originalEvent.mentions : event.mentions

  // Determine message type
  let messageType: Message["messageType"] = "message"
  if (isSystemEvent) messageType = "system"
  else if (isSharedEvent) messageType = "shared"
  else if (isAgentThinking) messageType = "agent_thinking"

  return {
    id: event.id,
    userId: event.actorId,
    email: event.actorEmail,
    name: event.actorName,
    message: content || "",
    timestamp: event.createdAt,
    channelId: streamId || event.streamId,
    replyCount: event.replyCount,
    isEdited: event.isEdited,
    updatedAt: event.editedAt,
    messageType,
    mentions: mentions,
    // Optimistic update state
    pending: event.pending,
    sendFailed: event.sendFailed,
    // For shared events, include info about the original
    sharedFrom:
      isSharedEvent && originalEvent
        ? {
            eventId: event.originalEventId!,
            streamId: originalEvent.streamId,
            actorName: originalEvent.actorName,
            actorEmail: originalEvent.actorEmail,
            createdAt: originalEvent.createdAt,
          }
        : undefined,
    // Map system event payload to metadata for SystemMessage component
    // Also pass agent_thinking payload for session linking
    metadata: isSystemEvent
      ? {
          event: event.eventType as "member_joined" | "member_added" | "member_removed",
          userId: event.actorId,
          userName: event.actorName,
          userEmail: event.actorEmail,
          ...(event.payload || {}),
        }
      : isAgentThinking
        ? event.payload
        : undefined,
  }
}

export function EventList({
  events,
  sessions = [],
  workspaceId,
  streamId,
  lastReadEventId,
  isLoading,
  isLoadingMore,
  hasMoreEvents,
  isThread,
  rootEvent,
  currentUserId,
  highlightEventId,
  onOpenThread,
  onEditEvent,
  onLoadMore,
  onShareToStream,
  onCrosspostToStream,
  onRetryMessage,
  onStreamClick,
  users,
  streams,
}: EventListProps) {
  // Convert root event to message for threads
  const rootMessage = useMemo(() => (rootEvent ? eventToMessage(rootEvent, rootEvent.streamId) : null), [rootEvent])

  // Convert events to messages for MessageList (include system events and agent_thinking)
  const messages = useMemo(
    () => events.filter((e) => RENDERABLE_EVENT_TYPES.includes(e.eventType)).map((e) => eventToMessage(e, streamId)),
    [events, streamId],
  )

  // Build map for session lookup by triggering event ID (for badge display on channel messages)
  const sessionsByTrigger = useMemo(() => {
    const byTrigger = new Map<string, AgentSession>()
    for (const session of sessions) {
      byTrigger.set(session.triggeringEventId, session)
    }
    return byTrigger
  }, [sessions])

  return (
    <MessageList
      messages={messages}
      sessions={sessions}
      sessionsByTrigger={sessionsByTrigger}
      workspaceId={workspaceId}
      channelId={streamId}
      lastReadMessageId={lastReadEventId}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMoreMessages={hasMoreEvents}
      isThread={isThread}
      rootMessage={rootMessage}
      currentUserId={currentUserId}
      highlightMessageId={highlightEventId}
      onOpenThread={(msgId, _channelId, mode) => onOpenThread(msgId, mode)}
      onEditMessage={onEditEvent}
      onLoadMore={onLoadMore}
      onShareToChannel={onShareToStream}
      onCrosspostToChannel={onCrosspostToStream}
      onRetryMessage={onRetryMessage}
      onChannelClick={onStreamClick}
      users={users}
      channels={streams}
    />
  )
}
