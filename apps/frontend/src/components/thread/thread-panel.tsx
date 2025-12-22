import { useRef, useEffect, useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { X, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useEvents, useStreamSocket, useStreamBootstrap, streamKeys } from "@/hooks"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { EventList, EventItem, MessageInput } from "@/components/timeline"
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
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
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

  const threadName = bootstrap?.stream?.displayName || "Thread"

  if (error) {
    return (
      <div className="flex h-full flex-col border-l">
        <header className="flex h-14 items-center justify-between border-b px-4">
          <h2 className="font-semibold">Thread</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-destructive">Failed to load thread</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col border-l bg-background">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <h2 className="font-semibold truncate">{threadName}</h2>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>
      <main className="flex-1 overflow-hidden">
        <div className="flex h-full flex-col">
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto mb-4" onScroll={handleScroll}>
            {isFetchingOlder && (
              <div className="flex justify-center py-2">
                <p className="text-sm text-muted-foreground">Loading older messages...</p>
              </div>
            )}
            {/* Parent message at the top */}
            {parentMessage && bootstrap?.stream?.parentStreamId && (
              <div className="border-b">
                <div className="p-4">
                  <EventItem
                    event={parentMessage}
                    workspaceId={workspaceId}
                    streamId={bootstrap.stream.parentStreamId}
                    hideActions
                  />
                </div>
                <Separator />
                <div className="py-2 px-4 text-xs text-muted-foreground bg-muted/30">
                  {events.length} {events.length === 1 ? "reply" : "replies"}
                </div>
              </div>
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
      </main>
    </div>
  )
}
