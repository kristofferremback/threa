import { useCallback, useMemo } from "react"
import { toast } from "sonner"
import { useStreamWithQuery, useAgentSessions } from "../hooks"
import type { MaterializedStreamResult } from "../hooks"
import { ChatHeader, ThinkingSpaceHeader, ChatInput, EventList, ThreadContext, ConnectionError } from "./chat"
import type { AgentSession } from "./chat/AgentThinkingEvent"
import type { OpenMode, Mention, Stream } from "../types"
import { getOpenMode } from "../types"

interface StreamInterfaceProps {
  workspaceId: string
  streamId?: string
  streamName?: string
  highlightEventId?: string
  title?: string
  onOpenThread?: (eventId: string, parentStreamId: string, mode: OpenMode) => void
  onGoToStream?: (streamSlug: string, mode: OpenMode) => void
  onStreamMaterialized?: (draftId: string, realStream: Stream) => void
  onStreamUpdate?: (stream: Stream) => void
  users?: Array<{ id: string; name: string; email: string }>
  streams?: Array<{ id: string; name: string; slug: string | null; branchedFromEventId?: string | null }>
  agents?: Array<{
    id: string
    name: string
    slug: string
    description: string
    avatarEmoji: string | null
    isDefault?: boolean
  }>
  // Thinking space specific
  selectedPersonaId?: string | null
  onPersonaChange?: (personaId: string) => void
}

export function StreamInterface({
  workspaceId,
  streamId,
  streamName,
  highlightEventId,
  title,
  onOpenThread,
  onGoToStream,
  onStreamMaterialized,
  onStreamUpdate,
  users = [],
  streams = [],
  agents = [],
  selectedPersonaId,
  onPersonaChange,
}: StreamInterfaceProps) {
  const {
    stream,
    events,
    initialSessions,
    parentStream,
    rootEvent,
    ancestors,
    lastReadEventId,
    isLoading,
    isLoadingMore,
    hasMoreEvents,
    isConnected,
    connectionError,
    currentUserId,
    postMessage,
    editEvent,
    shareEvent,
    createThread,
    loadMoreEvents,
    updateLinkedStreams,
    retryMessage,
  } = useStreamWithQuery({
    workspaceId,
    streamId,
    enabled: true,
    onStreamUpdate,
    selectedPersonaId,
  })

  // Track agent sessions with real-time updates
  // initialSessions come from the events endpoint, then useAgentSessions adds real-time updates
  const initialSessionsAsAgentSession = useMemo(
    () =>
      initialSessions.map((s) => ({
        id: s.id,
        streamId: s.streamId,
        triggeringEventId: s.triggeringEventId,
        responseEventId: s.responseEventId,
        status: s.status,
        steps: s.steps,
        summary: s.summary,
        errorMessage: s.errorMessage,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      })) as AgentSession[],
    [initialSessions],
  )

  // Use actual stream ID from useStream (handles pending thread -> real thread transitions)
  // Falls back to prop streamId for initial load
  const actualStreamId = stream?.id || streamId

  const { sessions } = useAgentSessions({
    workspaceId,
    streamId: actualStreamId,
    initialSessions: initialSessionsAsAgentSession,
    enabled: Boolean(actualStreamId),
  })

  // Convert sessions Map to array for EventList
  const sessionsArray = useMemo(() => Array.from(sessions.values()), [sessions])

  const isThread = stream?.streamType === "thread"
  const isThinkingSpace = stream?.streamType === "thinking_space" || streamId?.startsWith("draft_thinking_space_")
  // For threads, prefer the actual stream name over the static "Thread" title
  const streamDisplayName = (stream?.name || "").replace("#", "")
  const displayTitle = isThread
    ? streamDisplayName || title || "Thread"
    : title || streamName || streamDisplayName || "General"

  // For thinking spaces, persona is locked once there are messages
  const hasMessages = events.length > 0

  // Handler for sending messages
  const handleSend = useCallback(
    async (content: string, mentions?: Mention[]) => {
      const result = await postMessage(content, mentions)

      // If a draft thinking space was materialized, notify parent
      if (result && onStreamMaterialized) {
        onStreamMaterialized(result.draftId, result.realStream)
      }
    },
    [postMessage, onStreamMaterialized],
  )

  // Handler for opening a thread - no longer creates the thread, just opens the view
  // Thread will be created when first message is posted
  const handleOpenThread = useCallback(
    (eventId: string, mode: OpenMode) => {
      if (!streamId) return

      // Check if thread already exists (by branchedFromEventId)
      const existingThread = streams.find((s) => s.branchedFromEventId === eventId || s.id === eventId)

      // Pass either the existing thread ID or the event ID (for pending thread)
      onOpenThread?.(existingThread?.id || eventId, streamId, mode)
    },
    [streamId, streams, onOpenThread],
  )

  // Handler for sharing an event to the parent stream
  const handleShareToStream = useCallback(
    async (eventId: string) => {
      if (!parentStream) {
        toast.error("Cannot share - no parent stream")
        return
      }

      try {
        await shareEvent(eventId)
        toast.success(`Shared to #${parentStream.name}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to share")
      }
    },
    [parentStream, shareEvent],
  )

  // Handler for cross-posting to another stream
  const handleCrosspostToStream = useCallback(async (_eventId: string, _targetStreamId: string) => {
    // In the new model, this creates a shared_ref event in the target stream
    // For now, just show a toast - full implementation would use the share endpoint
    toast.info("Cross-post feature coming soon")
  }, [])

  return (
    <div className="flex h-full w-full flex-col" style={{ background: "var(--bg-primary)", minHeight: "100%" }}>
      {isThinkingSpace ? (
        <ThinkingSpaceHeader
          title={displayTitle}
          isConnected={isConnected}
          personas={agents}
          selectedPersonaId={selectedPersonaId || null}
          onPersonaChange={onPersonaChange || (() => {})}
          isLocked={hasMessages}
        />
      ) : (
        <ChatHeader title={displayTitle} isThread={isThread} isConnected={isConnected} />
      )}

      {isThread && parentStream && (
        <ThreadContext
          ancestors={ancestors
            // Filter out the root event since it's already shown in the message list
            .filter((e) => e.id !== rootEvent?.id)
            .map((e) => ({
              id: e.id,
              email: e.actorEmail,
              message: e.content || "",
              timestamp: e.createdAt,
              channelId: e.streamId,
              replyCount: e.replyCount,
            }))}
          channelName={(parentStream.name || "").replace("#", "")}
          channelId={parentStream.id}
          onOpenThread={(msgId, _channelId, mode) => handleOpenThread(msgId, mode)}
          onGoToChannel={(slug, mode) => onGoToStream?.(slug, mode)}
          onChannelClick={(slug, e) => onGoToStream?.(slug, getOpenMode(e))}
        />
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {connectionError && events.length === 0 && !streamId?.startsWith("event_") ? (
          <ConnectionError message={connectionError} />
        ) : (
          <EventList
            events={events}
            sessions={sessionsArray}
            workspaceId={workspaceId}
            streamId={actualStreamId}
            lastReadEventId={lastReadEventId}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            hasMoreEvents={hasMoreEvents}
            isThread={isThread}
            rootEvent={rootEvent}
            currentUserId={currentUserId}
            highlightEventId={highlightEventId}
            onOpenThread={handleOpenThread}
            onEditEvent={editEvent}
            onLoadMore={loadMoreEvents}
            onShareToStream={handleShareToStream}
            onCrosspostToStream={handleCrosspostToStream}
            onRetryMessage={retryMessage}
            onStreamClick={(slug, e) => onGoToStream?.(slug, getOpenMode(e))}
            users={users}
            streams={streams}
          />
        )}
      </div>

      <ChatInput
        onSend={handleSend}
        placeholder={isThread ? "Reply to thread..." : `Message ${displayTitle}`}
        users={users}
        channels={streams}
        agents={agents}
        streamId={actualStreamId}
      />
    </div>
  )
}

export type { OpenMode }
