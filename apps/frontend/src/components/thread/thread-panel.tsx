import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { MessageSquare } from "lucide-react"
import {
  SidePanel,
  SidePanelHeader,
  SidePanelTitle,
  SidePanelClose,
  SidePanelContent,
} from "@/components/ui/side-panel"
import { useEvents, useStreamSocket, useStreamBootstrap, useScrollBehavior, streamKeys } from "@/hooks"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { EventList, MessageInput } from "@/components/timeline"
import { ThreadParentMessage } from "./thread-parent-message"
import type { StreamEvent } from "@threa/types"

interface ThreadPanelProps {
  workspaceId: string
  streamId: string
  onClose: () => void
}

interface ParentBootstrap {
  events: StreamEvent[]
}

export function ThreadPanel({ workspaceId, streamId, onClose }: ThreadPanelProps) {
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

  if (error) {
    return (
      <SidePanel>
        <SidePanelHeader>
          <SidePanelTitle>Thread</SidePanelTitle>
          <SidePanelClose onClose={onClose} />
        </SidePanelHeader>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-destructive">Failed to load thread</p>
        </div>
      </SidePanel>
    )
  }

  return (
    <SidePanel>
      <SidePanelHeader>
        <SidePanelTitle>{threadName}</SidePanelTitle>
        <SidePanelClose onClose={onClose} />
      </SidePanelHeader>
      <SidePanelContent>
        <div className="flex h-full flex-col">
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto mb-4" onScroll={handleScroll}>
            {isFetchingOlder && (
              <div className="flex justify-center py-2">
                <p className="text-sm text-muted-foreground">Loading older messages...</p>
              </div>
            )}
            {parentMessage && bootstrap?.stream?.parentStreamId && (
              <ThreadParentMessage
                event={parentMessage}
                workspaceId={workspaceId}
                streamId={bootstrap.stream.parentStreamId}
                replyCount={events.length}
              />
            )}
            {events.length === 0 && !isLoading ? (
              <Empty className="h-full border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessageSquare />
                  </EmptyMedia>
                  <EmptyTitle>Start this thread</EmptyTitle>
                  <EmptyDescription>Type a message below to start the conversation.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <EventList events={events} isLoading={isLoading} workspaceId={workspaceId} streamId={streamId} />
            )}
          </div>
          <MessageInput workspaceId={workspaceId} streamId={streamId} />
        </div>
      </SidePanelContent>
    </SidePanel>
  )
}
