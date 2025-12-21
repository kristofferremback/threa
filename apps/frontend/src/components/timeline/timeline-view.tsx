import { useRef, useEffect, useCallback } from "react"
import { useParams } from "react-router-dom"
import { MessageSquare } from "lucide-react"
import { useEvents, useStreamSocket } from "@/hooks"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { EventList } from "./event-list"
import { MessageInput } from "./message-input"

interface TimelineViewProps {
  isDraft?: boolean
}

export function TimelineView({ isDraft = false }: TimelineViewProps) {
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId: string }>()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  // Subscribe to stream room FIRST (subscribe-then-bootstrap pattern)
  useStreamSocket(workspaceId!, streamId!, { enabled: !isDraft })

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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto mb-4" onScroll={handleScroll}>
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
          <EventList events={events} isLoading={isLoading} workspaceId={workspaceId} streamId={streamId} />
        )}
      </div>
      <MessageInput workspaceId={workspaceId} streamId={streamId} />
    </div>
  )
}
