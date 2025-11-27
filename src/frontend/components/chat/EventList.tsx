import { useMemo } from "react"
import { MessageList } from "./MessageList"
import type { StreamEvent, OpenMode, Message } from "../../types"

interface EventListProps {
  events: StreamEvent[]
  workspaceId: string
  streamId?: string
  lastReadEventId: string | null
  isLoading: boolean
  isLoadingMore: boolean
  hasMoreEvents: boolean
  isThread: boolean
  hasRootEvent: boolean
  currentUserId: string | null
  highlightEventId?: string
  onOpenThread: (eventId: string, mode: OpenMode) => void
  onEditEvent: (eventId: string, newContent: string) => Promise<void>
  onLoadMore: () => Promise<void>
  onShareToStream: (eventId: string) => Promise<void>
  onCrosspostToStream: (eventId: string, targetStreamId: string) => Promise<void>
  onStreamClick: (slug: string, e: React.MouseEvent) => void
  users: Array<{ id: string; name: string; email: string }>
  streams: Array<{ id: string; name: string; slug: string }>
}

// System event types that should be displayed
const SYSTEM_EVENT_TYPES = ["member_joined", "member_left", "stream_created", "thread_started"]

// Convert StreamEvent to Message format for MessageList compatibility
function eventToMessage(event: StreamEvent, streamId?: string): Message {
  const isSystemEvent = SYSTEM_EVENT_TYPES.includes(event.eventType)

  return {
    id: event.id,
    userId: event.actorId,
    email: event.actorEmail,
    message: event.content || "",
    timestamp: event.createdAt,
    channelId: streamId || event.streamId,
    replyCount: event.replyCount,
    isEdited: event.isEdited,
    updatedAt: event.editedAt,
    messageType: isSystemEvent ? "system" : "message",
    mentions: event.mentions,
    // Map system event payload to metadata for SystemMessage component
    metadata: isSystemEvent
      ? {
          event: event.eventType as "member_joined" | "member_added" | "member_removed",
          userId: event.actorId,
          userName: event.actorName,
          userEmail: event.actorEmail,
          ...(event.payload || {}),
        }
      : undefined,
  }
}

export function EventList({
  events,
  workspaceId,
  streamId,
  lastReadEventId,
  isLoading,
  isLoadingMore,
  hasMoreEvents,
  isThread,
  hasRootEvent,
  currentUserId,
  highlightEventId,
  onOpenThread,
  onEditEvent,
  onLoadMore,
  onShareToStream,
  onCrosspostToStream,
  onStreamClick,
  users,
  streams,
}: EventListProps) {
  // Convert events to messages for MessageList (include system events)
  const messages = useMemo(
    () =>
      events
        .filter((e) => e.eventType === "message" || e.eventType === "shared" || SYSTEM_EVENT_TYPES.includes(e.eventType))
        .map((e) => eventToMessage(e, streamId)),
    [events, streamId],
  )

  return (
    <MessageList
      messages={messages}
      workspaceId={workspaceId}
      channelId={streamId}
      lastReadMessageId={lastReadEventId}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMoreMessages={hasMoreEvents}
      isThread={isThread}
      hasRootMessage={hasRootEvent}
      currentUserId={currentUserId}
      highlightMessageId={highlightEventId}
      onOpenThread={(msgId, _channelId, mode) => onOpenThread(msgId, mode)}
      onEditMessage={onEditEvent}
      onLoadMore={onLoadMore}
      onShareToChannel={onShareToStream}
      onCrosspostToChannel={onCrosspostToStream}
      onChannelClick={onStreamClick}
      users={users}
      channels={streams}
    />
  )
}

