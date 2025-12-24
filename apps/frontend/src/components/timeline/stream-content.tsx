import { useMemo } from "react"
import { MessageSquare } from "lucide-react"
import { useEvents, useStreamSocket, useScrollBehavior, useStreamBootstrap } from "@/hooks"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { StreamTypes } from "@threa/types"
import { EventList } from "./event-list"
import { MessageInput } from "./message-input"
import { ThreadParentMessage } from "../thread/thread-parent-message"

interface StreamContentProps {
  workspaceId: string
  streamId: string
  highlightMessageId?: string | null
  isDraft?: boolean
}

export function StreamContent({ workspaceId, streamId, highlightMessageId, isDraft = false }: StreamContentProps) {
  // Get current stream info (for thread detection)
  const { data: bootstrap } = useStreamBootstrap(workspaceId, streamId, { enabled: !isDraft })
  const isThread = bootstrap?.stream?.type === StreamTypes.THREAD
  const parentStreamId = bootstrap?.stream?.parentStreamId
  const parentMessageId = bootstrap?.stream?.parentMessageId

  // Fetch parent stream bootstrap (for threads to get parent message)
  const { data: parentBootstrap } = useStreamBootstrap(workspaceId, parentStreamId ?? "", {
    enabled: !isDraft && isThread && !!parentStreamId,
  })

  // Find parent message from parent stream's events
  const parentMessage = useMemo(() => {
    if (!isThread || !parentStreamId || !parentMessageId) return null
    if (!parentBootstrap?.events) return null

    return parentBootstrap.events.find(
      (e) => e.eventType === "message_created" && (e.payload as { messageId?: string })?.messageId === parentMessageId
    )
  }, [isThread, parentStreamId, parentMessageId, parentBootstrap?.events])

  // Subscribe to stream room FIRST (subscribe-then-bootstrap pattern)
  useStreamSocket(workspaceId, streamId, { enabled: !isDraft })

  const { events, isLoading, error, fetchOlderEvents, hasOlderEvents, isFetchingOlder } = useEvents(
    workspaceId,
    streamId,
    { enabled: !isDraft }
  )

  const { scrollContainerRef, handleScroll } = useScrollBehavior({
    isLoading,
    itemCount: events.length,
    onScrollNearTop: hasOlderEvents ? fetchOlderEvents : undefined,
    isFetchingMore: isFetchingOlder,
  })

  if (error && !isDraft) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-destructive">Failed to load timeline</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto mb-4" onScroll={handleScroll}>
        {/* Show parent message for threads */}
        {isThread && parentMessage && parentStreamId && (
          <ThreadParentMessage
            event={parentMessage}
            workspaceId={workspaceId}
            streamId={parentStreamId}
            replyCount={events.length}
          />
        )}
        {!isDraft && isFetchingOlder && (
          <div className="flex justify-center py-2">
            <p className="text-sm text-muted-foreground">Loading older messages...</p>
          </div>
        )}
        {isDraft ? (
          <Empty className="h-full border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquare />
              </EmptyMedia>
              <EmptyTitle>Start a conversation</EmptyTitle>
              <EmptyDescription>Type a message below to begin this scratchpad.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <EventList
            events={events}
            isLoading={isLoading}
            workspaceId={workspaceId}
            streamId={streamId}
            highlightMessageId={highlightMessageId}
          />
        )}
      </div>
      <MessageInput workspaceId={workspaceId} streamId={streamId} />
    </div>
  )
}
