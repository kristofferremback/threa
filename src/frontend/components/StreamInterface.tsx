import { useCallback } from "react"
import { toast } from "sonner"
import { useStream } from "../hooks"
import { ChatHeader, ChatInput, EventList, ThreadContext, ConnectionError } from "./chat"
import type { OpenMode, Mention } from "../types"
import { getOpenMode } from "../types"

interface StreamInterfaceProps {
  workspaceId: string
  streamId?: string
  streamName?: string
  highlightEventId?: string
  title?: string
  onOpenThread?: (eventId: string, parentStreamId: string, mode: OpenMode) => void
  onGoToStream?: (streamSlug: string, mode: OpenMode) => void
  users?: Array<{ id: string; name: string; email: string }>
  streams?: Array<{ id: string; name: string; slug: string; branchedFromEventId?: string | null }>
}

export function StreamInterface({
  workspaceId,
  streamId,
  streamName,
  highlightEventId,
  title,
  onOpenThread,
  onGoToStream,
  users = [],
  streams = [],
}: StreamInterfaceProps) {
  const {
    stream,
    events,
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
  } = useStream({
    workspaceId,
    streamId,
    enabled: true,
  })

  const isThread = stream?.streamType === "thread"
  const displayTitle = title || streamName || (stream?.name || "").replace("#", "") || "General"

  // Handler for sending messages
  const handleSend = useCallback(
    async (content: string, mentions?: Mention[]) => {
      await postMessage(content, mentions)
    },
    [postMessage],
  )

  // Handler for opening a thread - no longer creates the thread, just opens the view
  // Thread will be created when first message is posted
  const handleOpenThread = useCallback(
    (eventId: string, mode: OpenMode) => {
      if (!streamId) return

      // Check if thread already exists (by branchedFromEventId)
      const existingThread = streams.find(
        (s) => s.branchedFromEventId === eventId || s.id === eventId,
      )

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
  const handleCrosspostToStream = useCallback(
    async (_eventId: string, _targetStreamId: string) => {
      // In the new model, this creates a shared_ref event in the target stream
      // For now, just show a toast - full implementation would use the share endpoint
      toast.info("Cross-post feature coming soon")
    },
    [],
  )

  return (
    <div className="flex h-full w-full flex-col" style={{ background: "var(--bg-primary)", minHeight: "100%" }}>
      <ChatHeader title={displayTitle} isThread={isThread} isConnected={isConnected} />

      {isThread && parentStream && (
        <ThreadContext
          rootMessage={
            rootEvent
              ? {
                  id: rootEvent.id,
                  email: rootEvent.actorEmail,
                  message: rootEvent.content || "",
                  timestamp: rootEvent.createdAt,
                  channelId: rootEvent.streamId,
                  replyCount: rootEvent.replyCount,
                }
              : null
          }
          ancestors={ancestors.map((e) => ({
            id: e.id,
            email: e.actorEmail,
            message: e.content || "",
            timestamp: e.createdAt,
            channelId: e.streamId,
            replyCount: e.replyCount,
          }))}
          channelName={(parentStream.name || "").replace("#", "")}
          isLoading={isLoading && !rootEvent}
          onOpenThread={(msgId, _channelId, mode) => handleOpenThread(msgId, mode)}
          onGoToChannel={(slug, mode) => onGoToStream?.(slug, mode)}
          onChannelClick={(slug, e) => onGoToStream?.(slug, getOpenMode(e))}
        />
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {connectionError ? (
          <ConnectionError message={connectionError} />
        ) : (
          <EventList
            events={events}
            workspaceId={workspaceId}
            streamId={streamId}
            lastReadEventId={lastReadEventId}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            hasMoreEvents={hasMoreEvents}
            isThread={isThread}
            hasRootEvent={Boolean(rootEvent)}
            currentUserId={currentUserId}
            highlightEventId={highlightEventId}
            onOpenThread={handleOpenThread}
            onEditEvent={editEvent}
            onLoadMore={loadMoreEvents}
            onShareToStream={handleShareToStream}
            onCrosspostToStream={handleCrosspostToStream}
            onStreamClick={(slug) => onGoToStream?.(slug, "replace")}
            users={users}
            streams={streams}
          />
        )}
      </div>

      <ChatInput
        onSend={handleSend}
        placeholder={isThread ? "Reply to thread..." : `Message ${displayTitle}`}
        disabled={!isConnected}
        users={users}
        channels={streams}
      />
    </div>
  )
}

export type { OpenMode }

