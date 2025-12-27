import { useMemo, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { MessageSquare } from "lucide-react"
import { useEvents, useStreamSocket, useScrollBehavior, useStreamBootstrap, useAutoMarkAsRead } from "@/hooks"
import { useUser } from "@/auth"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
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

  // Calculate first unread event from another user for the "New" divider
  const lastReadEventId = bootstrap?.membership?.lastReadEventId
  const firstUnreadEventId = useMemo(() => {
    if (events.length === 0) return undefined

    // Find events after lastReadEventId that are from other users
    const startIndex = lastReadEventId ? events.findIndex((e) => e.id === lastReadEventId) + 1 : 0

    if (startIndex <= 0 && lastReadEventId) {
      // lastReadEventId not found in events - can't determine first unread
      return undefined
    }

    // Find first event from another user after the last read position
    for (let i = startIndex; i < events.length; i++) {
      if (events[i].actorId !== user?.id) {
        return events[i].id
      }
    }

    return undefined
  }, [events, lastReadEventId, user?.id])

  // Track displayed divider separately - shows for 3 seconds then fades out
  const [displayedUnreadId, setDisplayedUnreadId] = useState<string | undefined>(undefined)
  const [isDividerFading, setIsDividerFading] = useState(false)
  const hasShownDivider = useRef(false)

  useEffect(() => {
    // Show divider when we have a firstUnreadEventId and haven't shown one yet
    if (firstUnreadEventId && !hasShownDivider.current) {
      setDisplayedUnreadId(firstUnreadEventId)
      setIsDividerFading(false)
      hasShownDivider.current = true

      // Start fade after 3 seconds
      const fadeTimer = setTimeout(() => {
        setIsDividerFading(true)
      }, 3000)

      // Remove after fade completes (500ms transition)
      const removeTimer = setTimeout(() => {
        setDisplayedUnreadId(undefined)
        setIsDividerFading(false)
      }, 3500)

      return () => {
        clearTimeout(fadeTimer)
        clearTimeout(removeTimer)
      }
    }
  }, [firstUnreadEventId])

  // Reset when stream changes
  useEffect(() => {
    hasShownDivider.current = false
    setDisplayedUnreadId(undefined)
    setIsDividerFading(false)
  }, [streamId])

  // Scroll to first unread on initial load
  const hasScrolledToUnread = useRef(false)
  useEffect(() => {
    if (!isLoading && firstUnreadEventId && !highlightMessageId && !hasScrolledToUnread.current) {
      // Find the element and scroll to it
      const element = document.querySelector(`[data-event-id="${firstUnreadEventId}"]`)
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" })
        hasScrolledToUnread.current = true
      }
    }
  }, [isLoading, firstUnreadEventId, highlightMessageId])

  // Reset scroll flag when stream changes
  useEffect(() => {
    hasScrolledToUnread.current = false
  }, [streamId])

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
            firstUnreadEventId={displayedUnreadId}
            isDividerFading={isDividerFading}
          />
        )}
      </div>
      <MessageInput workspaceId={workspaceId} streamId={streamId} />
    </div>
  )
}
