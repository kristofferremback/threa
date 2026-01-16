import { useMemo, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { MessageSquare } from "lucide-react"
import {
  useEvents,
  useStreamSocket,
  useScrollBehavior,
  useStreamBootstrap,
  useAutoMarkAsRead,
  useUnreadDivider,
  useMentionables,
} from "@/hooks"
import { useUser } from "@/auth"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { ErrorView } from "@/components/error-view"
import { MentionableMarkdownWrapper } from "@/components/ui/markdown-content"
import { WorkspaceEmojiProvider } from "@/components/workspace-emoji"
import { StreamTypes, type Stream } from "@threa/types"
import { EventList } from "./event-list"
import { MessageInput } from "./message-input"
import { ThreadParentMessage } from "../thread/thread-parent-message"

interface StreamContentProps {
  workspaceId: string
  streamId: string
  highlightMessageId?: string | null
  isDraft?: boolean
  /** Pre-fetched stream data from parent - avoids duplicate bootstrap call */
  stream?: Stream
}

export function StreamContent({
  workspaceId,
  streamId,
  highlightMessageId,
  isDraft = false,
  stream: streamFromProps,
}: StreamContentProps) {
  const [, setSearchParams] = useSearchParams()
  const user = useUser()
  const { mentionables } = useMentionables()

  // Clear highlight param after delay (works for both main view and panels)
  useEffect(() => {
    if (highlightMessageId) {
      const timer = setTimeout(() => {
        setSearchParams(
          (prev) => {
            prev.delete("m")
            return prev
          },
          { replace: true }
        )
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [highlightMessageId, setSearchParams])

  // Get stream info - skip fetch if parent already provided it
  const { data: bootstrap } = useStreamBootstrap(workspaceId, streamId, {
    enabled: !isDraft && !streamFromProps,
  })
  const stream = streamFromProps ?? bootstrap?.stream
  const isThread = stream?.type === StreamTypes.THREAD
  const isArchived = stream?.archivedAt != null
  const parentStreamId = stream?.parentStreamId
  const parentMessageId = stream?.parentMessageId

  // Fetch parent stream bootstrap (for threads to get parent message)
  // Only fetch when we have a valid parentStreamId
  const { data: parentBootstrap } = useStreamBootstrap(workspaceId, parentStreamId!, {
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

  // Auto-mark stream as read when viewing
  const lastEventId = events.length > 0 ? events[events.length - 1].id : undefined
  useAutoMarkAsRead(workspaceId, streamId, lastEventId, { enabled: !isDraft && !isLoading })

  // Unread divider state management (also handles scroll-to-first-unread)
  const { dividerEventId, isFading: isDividerFading } = useUnreadDivider({
    events,
    lastReadEventId: bootstrap?.membership?.lastReadEventId,
    currentUserId: user?.id,
    streamId,
    isLoading,
    highlightMessageId,
  })

  if (error && !isDraft) {
    return (
      <ErrorView
        className="h-full border-0"
        title="Failed to Load Messages"
        description="We couldn't load the messages for this stream. Please refresh the page or try again later."
      />
    )
  }

  return (
    <MentionableMarkdownWrapper mentionables={mentionables}>
      <WorkspaceEmojiProvider workspaceId={workspaceId}>
        <div className="flex h-full flex-col">
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto overflow-x-hidden mb-4"
            onScroll={handleScroll}
          >
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
                firstUnreadEventId={dividerEventId}
                isDividerFading={isDividerFading}
              />
            )}
          </div>
          <MessageInput
            workspaceId={workspaceId}
            streamId={streamId}
            streamName={stream?.displayName ?? undefined}
            disabled={isArchived}
            disabledReason={
              isArchived ? "This thread has been sealed in the labyrinth. It can be read but not extended." : undefined
            }
          />
        </div>
      </WorkspaceEmojiProvider>
    </MentionableMarkdownWrapper>
  )
}
