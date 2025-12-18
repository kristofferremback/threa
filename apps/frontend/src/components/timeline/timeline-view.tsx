import { useRef, useEffect, useCallback } from "react"
import { useParams } from "react-router-dom"
import { useEvents } from "@/hooks"
import { EventList } from "./event-list"
import { MessageInput } from "./message-input"

interface TimelineViewProps {
  isDraft?: boolean
}

export function TimelineView({ isDraft = false }: TimelineViewProps) {
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId: string }>()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  const { events, isLoading, error, fetchOlderEvents, hasOlderEvents, isFetchingOlder } = useEvents(
    workspaceId!,
    streamId!,
    { enabled: !isDraft }
  )

  // Auto-scroll to bottom when new events arrive
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current && shouldAutoScroll.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [])

  // Initial scroll to bottom
  useEffect(() => {
    if (!isLoading && events.length > 0) {
      scrollToBottom()
    }
  }, [isLoading, events.length, scrollToBottom])

  // Track if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100

    shouldAutoScroll.current = isNearBottom

    // Load older events when scrolling near top
    if (scrollTop < 100 && hasOlderEvents && !isFetchingOlder) {
      fetchOlderEvents()
    }
  }, [hasOlderEvents, isFetchingOlder, fetchOlderEvents])

  if (!workspaceId || !streamId) {
    return null
  }

  if (error && !isDraft) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-destructive">Failed to load timeline</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        {!isDraft && isFetchingOlder && (
          <div className="flex justify-center py-2">
            <p className="text-sm text-muted-foreground">Loading older messages...</p>
          </div>
        )}
        {isDraft ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Start typing to begin this conversation...
            </p>
          </div>
        ) : (
          <EventList
            events={events}
            isLoading={isLoading}
            workspaceId={workspaceId}
            streamId={streamId}
          />
        )}
      </div>
      <MessageInput workspaceId={workspaceId} streamId={streamId} isDraft={isDraft} />
    </div>
  )
}
