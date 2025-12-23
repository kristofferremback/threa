import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useEvents, useStreamSocket, useStreamBootstrap, useScrollBehavior, streamKeys } from "@/hooks"
import { MessageInput } from "@/components/timeline"
import { ThreadPanelView } from "./thread-panel-view"
import type { StreamEvent } from "@threa/types"

interface StreamThreadPanelProps {
  workspaceId: string
  streamId: string
  onClose: () => void
}

interface ParentBootstrap {
  events: StreamEvent[]
}

export function StreamThreadPanel({ workspaceId, streamId, onClose }: StreamThreadPanelProps) {
  const queryClient = useQueryClient()

  // Get stream info for the header
  const { data: bootstrap } = useStreamBootstrap(workspaceId, streamId)

  // Get parent message from parent stream's cached bootstrap
  const parentMessage = useMemo(() => {
    const parentStreamId = bootstrap?.stream?.parentStreamId
    const parentMessageId = bootstrap?.stream?.parentMessageId
    if (!parentStreamId || !parentMessageId) return null

    // Try to get parent stream's bootstrap from cache
    const parentBootstrap = queryClient.getQueryData<ParentBootstrap>(streamKeys.bootstrap(workspaceId, parentStreamId))
    if (!parentBootstrap?.events) return null

    // Find the message event for the parent message
    return parentBootstrap.events.find(
      (e) => e.eventType === "message_created" && (e.payload as { messageId?: string })?.messageId === parentMessageId
    )
  }, [bootstrap?.stream?.parentStreamId, bootstrap?.stream?.parentMessageId, workspaceId, queryClient])

  // Subscribe to thread room for real-time updates
  useStreamSocket(workspaceId, streamId, { enabled: true })

  const { events, isLoading, error, fetchOlderEvents, hasOlderEvents, isFetchingOlder } = useEvents(
    workspaceId,
    streamId,
    { enabled: true }
  )

  const { scrollContainerRef, handleScroll } = useScrollBehavior({
    isLoading,
    itemCount: events.length,
    onScrollNearTop: hasOlderEvents ? fetchOlderEvents : undefined,
    isFetchingMore: isFetchingOlder,
  })

  const threadName = bootstrap?.stream?.displayName || "Thread"

  return (
    <ThreadPanelView
      workspaceId={workspaceId}
      streamId={streamId}
      title={threadName}
      onClose={onClose}
      parentMessage={parentMessage ?? undefined}
      parentStreamId={bootstrap?.stream?.parentStreamId ?? undefined}
      events={events}
      replyCount={events.length}
      isLoading={isLoading}
      isFetchingOlder={isFetchingOlder}
      scrollContainerRef={scrollContainerRef}
      onScroll={handleScroll}
      emptyState={{
        title: "Start this thread",
        description: "Type a message below to start the conversation.",
      }}
      inputSlot={<MessageInput workspaceId={workspaceId} streamId={streamId} />}
      error={error}
    />
  )
}
