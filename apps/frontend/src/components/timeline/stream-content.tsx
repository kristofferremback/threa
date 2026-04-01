import { useMemo, useEffect, useCallback, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { MessageSquare, ArrowDown } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useEvents,
  useStreamSocket,
  useScrollBehavior,
  useStreamBootstrap,
  useWorkspaceUserId,
  useAutoMarkAsRead,
  useUnreadDivider,
  useNewMessageIndicator,
  useAgentActivity,
  useEditLastMessageTrigger,
  streamKeys,
  workspaceKeys,
} from "@/hooks"
import { useSocket } from "@/contexts"
import { useStreamEvents } from "@/stores/stream-store"
import { useWorkspaceStreams, useWorkspaceStreamMemberships } from "@/stores/workspace-store"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { ErrorView } from "@/components/error-view"
import {
  StreamTypes,
  Visibilities,
  type Stream,
  type StreamEvent,
  type StreamMember,
  type WorkspaceBootstrap,
  type StreamBootstrap,
} from "@threa/types"
import { EventList } from "./event-list"
import { MessageInput } from "./message-input"
import { JoinChannelBar } from "./join-channel-bar"
import { ThreadParentMessage } from "../thread/thread-parent-message"
import { EditLastMessageContext } from "./edit-last-message-context"
import { InlineEditProvider } from "./inline-edit-context"

interface StreamContentProps {
  workspaceId: string
  streamId: string
  highlightMessageId?: string | null
  isDraft?: boolean
  /** Pre-fetched stream data from parent - avoids duplicate bootstrap call */
  stream?: Stream
  /** Auto-focus the message input when mounted */
  autoFocus?: boolean
}

export function StreamContent({
  workspaceId,
  streamId,
  highlightMessageId,
  isDraft = false,
  stream: streamFromProps,
  autoFocus,
}: StreamContentProps) {
  const [, setSearchParams] = useSearchParams()
  const socket = useSocket()
  const jumpTriggeredRef = useRef<string | null>(null)

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

  const idbStreams = useWorkspaceStreams(workspaceId)
  const idbMemberships = useWorkspaceStreamMemberships(workspaceId)
  const idbStream = useMemo(() => idbStreams.find((candidate) => candidate.id === streamId), [idbStreams, streamId])

  // Resolve current workspace-scoped user ID. The hook deduplicates with SentMessageEvent instances.
  const currentWorkspaceUserId = useWorkspaceUserId(workspaceId)
  const idbMembership = useMemo(
    () =>
      currentWorkspaceUserId
        ? idbMemberships.find(
            (membership) => membership.streamId === streamId && membership.memberId === currentWorkspaceUserId
          )
        : undefined,
    [currentWorkspaceUserId, idbMemberships, streamId]
  )
  const { data: bootstrap } = useStreamBootstrap(workspaceId, streamId, {
    enabled: !isDraft && (!idbStream || !idbMembership),
  })
  const membership = idbMembership ?? bootstrap?.membership
  const lastReadEventId = idbStream?.lastReadEventId ?? membership?.lastReadEventId

  const stream = streamFromProps ?? idbStream ?? bootstrap?.stream
  const isThread = stream?.type === StreamTypes.THREAD
  const isArchived = stream?.archivedAt != null
  const isSystem = stream?.type === StreamTypes.SYSTEM
  const parentStreamId = stream?.parentStreamId
  const parentMessageId = stream?.parentMessageId
  const parentCachedEvents = useStreamEvents(parentStreamId ?? undefined)
  const cachedParentMessage = useMemo(() => {
    if (!isThread || !parentStreamId || !parentMessageId) return null
    return parentCachedEvents.find(
      (event) =>
        event.eventType === "message_created" &&
        (event.payload as { messageId?: string })?.messageId === parentMessageId
    )
  }, [isThread, parentStreamId, parentMessageId, parentCachedEvents])

  // Fetch parent stream bootstrap (for threads to get parent message)
  // Only fetch when we have a valid parentStreamId
  const { data: parentBootstrap } = useStreamBootstrap(workspaceId, parentStreamId!, {
    enabled: !isDraft && isThread && !!parentStreamId && !!parentMessageId && !cachedParentMessage,
  })

  // Find parent message from parent stream's events
  const parentMessage = useMemo(() => {
    if (!isThread || !parentStreamId || !parentMessageId) return null
    if (cachedParentMessage) return cachedParentMessage as unknown as StreamEvent
    if (!parentBootstrap?.events) return null

    return parentBootstrap.events.find(
      (e) => e.eventType === "message_created" && (e.payload as { messageId?: string })?.messageId === parentMessageId
    )
  }, [cachedParentMessage, isThread, parentStreamId, parentMessageId, parentBootstrap?.events])

  // Subscribe to stream room FIRST (subscribe-then-bootstrap pattern)
  useStreamSocket(workspaceId, streamId, { enabled: !isDraft })

  const {
    events,
    isLoading,
    error,
    fetchOlderEvents,
    hasOlderEvents,
    isFetchingOlder,
    fetchNewerEvents,
    hasNewerEvents,
    isFetchingNewer,
    jumpToEvent,
    exitJumpMode,
    isJumpMode,
  } = useEvents(workspaceId, streamId, { enabled: !isDraft, loadAll: isThread })

  // Jump to highlighted message if it's not in the current event window
  useEffect(() => {
    if (!highlightMessageId || isLoading || isDraft) return
    if (jumpTriggeredRef.current === highlightMessageId) return

    // Check if the message is already visible in current events
    const isVisible = events.some((e) => {
      const payload = e.payload as { messageId?: string }
      return payload?.messageId === highlightMessageId
    })

    if (!isVisible && events.length > 0) {
      jumpTriggeredRef.current = highlightMessageId
      // Use the messageId directly — the backend resolves it to the corresponding event
      jumpToEvent(highlightMessageId)
        .then((success) => {
          if (!success) jumpTriggeredRef.current = null
        })
        .catch(() => {
          // Reset so the user can retry (e.g. on reconnect)
          jumpTriggeredRef.current = null
        })
    }
  }, [highlightMessageId, isLoading, isDraft, events, jumpToEvent])

  // Reset jump trigger and exit jump mode when stream changes
  useEffect(() => {
    jumpTriggeredRef.current = null
    exitJumpMode()
  }, [streamId, exitJumpMode])

  const editLastMessageCtx = useEditLastMessageTrigger(events, currentWorkspaceUserId)

  // Track live agent session progress for all stream types (step/message counts on session cards).
  // In channels, session cards are hidden (responses go to threads) and inline activity shows on trigger messages instead.
  const isChannel = stream?.type === StreamTypes.CHANNEL
  const agentActivity = useAgentActivity(events, socket)

  const { scrollContainerRef, handleScroll, isScrolledFarFromBottom, scrollToBottom } = useScrollBehavior({
    isLoading,
    itemCount: events.length,
    onScrollNearTop: hasOlderEvents ? fetchOlderEvents : undefined,
    onScrollNearBottom: hasNewerEvents ? fetchNewerEvents : undefined,
    isFetchingOlder,
    isFetchingNewer,
  })

  // Auto-mark stream as read when viewing
  const lastEventId = events.length > 0 ? events[events.length - 1].id : undefined
  useAutoMarkAsRead(workspaceId, streamId, lastEventId, { enabled: !isDraft && !isLoading && !isJumpMode })

  // Track live-arriving messages from other users for brief "new" indicator
  const newMessageIds = useNewMessageIndicator(events, currentWorkspaceUserId ?? undefined, streamId)

  // Unread divider state management (also handles scroll-to-first-unread)
  const { dividerEventId, isFading: isDividerFading } = useUnreadDivider({
    events,
    lastReadEventId,
    currentUserId: currentWorkspaceUserId ?? undefined,
    streamId,
    isLoading,
    highlightMessageId,
  })

  const queryClient = useQueryClient()
  const isPublicChannel = stream?.type === StreamTypes.CHANNEL && stream?.visibility === Visibilities.PUBLIC
  const isMember = !!membership
  let disabledReason: string | undefined
  if (isSystem) {
    disabledReason = "System notifications are read-only."
  } else if (isArchived) {
    disabledReason = "This thread has been sealed in the labyrinth. It can be read but not extended."
  }

  const handleJoined = useCallback(
    (membership: StreamMember) => {
      // Update stream bootstrap cache — set membership so join bar disappears
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        return { ...(old as StreamBootstrap), membership }
      })

      // Update workspace bootstrap cache — append to streamMemberships so sidebar shows the channel
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const ws = old as WorkspaceBootstrap
        return {
          ...ws,
          streamMemberships: [...ws.streamMemberships, membership],
        }
      })
    },
    [queryClient, workspaceId, streamId]
  )

  const handleJumpToLatest = useCallback(() => {
    if (isJumpMode) {
      exitJumpMode()
      // Scroll to bottom after React re-renders with bootstrap events
      requestAnimationFrame(() => {
        scrollToBottom({ force: true })
      })
    } else {
      scrollToBottom({ force: true, behavior: "smooth" })
    }
  }, [isJumpMode, exitJumpMode, scrollToBottom])

  if (error && !isDraft && events.length === 0) {
    return (
      <ErrorView
        className="h-full border-0"
        title="Failed to Load Messages"
        description="We couldn't load the messages for this stream. Please refresh the page or try again later."
      />
    )
  }

  return (
    <EditLastMessageContext.Provider value={editLastMessageCtx}>
      <InlineEditProvider>
        <div className="flex h-full flex-col">
          <div className="relative flex-1 overflow-hidden mb-1 sm:mb-4">
            <div
              ref={scrollContainerRef}
              className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
              data-suppress-pull-refresh="true"
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
                  agentActivity={agentActivity}
                  hideSessionCards={isChannel}
                  newMessageIds={newMessageIds}
                />
              )}
              {!isDraft && isFetchingNewer && (
                <div className="flex justify-center py-2">
                  <p className="text-sm text-muted-foreground">Loading newer messages...</p>
                </div>
              )}
            </div>
            {/* Jump to latest button — shown when scrolled far from bottom or in jump mode */}
            {(isJumpMode || isScrolledFarFromBottom) && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
                <Button variant="secondary" size="sm" className="shadow-lg gap-1.5" onClick={handleJumpToLatest}>
                  <ArrowDown className="h-3.5 w-3.5" />
                  Jump to latest
                </Button>
              </div>
            )}
          </div>
          {!isMember && isPublicChannel && (
            <JoinChannelBar
              workspaceId={workspaceId}
              streamId={streamId}
              channelName={stream?.slug ?? stream?.displayName ?? ""}
              onJoined={handleJoined}
            />
          )}
          {(isMember || !isPublicChannel) && (
            <MessageInput
              workspaceId={workspaceId}
              streamId={streamId}
              disabled={isArchived || isSystem}
              disabledReason={disabledReason}
              autoFocus={autoFocus}
            />
          )}
        </div>
      </InlineEditProvider>
    </EditLastMessageContext.Provider>
  )
}
