import { useMemo, useEffect, useCallback, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { MessageSquare, ArrowDown } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useEvents,
  useStreamSocket,
  useVirtualizedScroll,
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
import { useUser } from "@/auth"
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
import { EventList, groupTimelineItems, getTimelineItemKey, filterVisibleItems } from "./event-list"
import { MessageInput } from "./message-input"
import { JoinChannelBar } from "./join-channel-bar"
import { ThreadParentMessage } from "../thread/thread-parent-message"
import { EditLastMessageContext } from "./edit-last-message-context"
import { InlineEditProvider } from "./inline-edit-context"
import { StreamSearchBar } from "./stream-search-bar"
import { useStreamSearch } from "@/hooks/use-stream-search"

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
  const user = useUser()
  const [isSearchOpen, setIsSearchOpen] = useState(false)

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
    if (!isThread || !parentStreamId || !parentMessageId || !parentCachedEvents) return null
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

  const editLastMessageCtx = useEditLastMessageTrigger(events, currentWorkspaceUserId)

  // Track live agent session progress for all stream types (step/message counts on session cards).
  // In channels, session cards are hidden (responses go to threads) and inline activity shows on trigger messages instead.
  const isChannel = stream?.type === StreamTypes.CHANNEL
  const agentActivity = useAgentActivity(events, socket)

  // --- In-stream search ---
  const streamSearch = useStreamSearch({ workspaceId, streamId })
  const clearSearch = streamSearch.clear

  // Cmd+F / Ctrl+F opens in-stream search (intercepts browser find).
  // Skip in thread views to avoid double search bar when a thread panel
  // and main stream are mounted simultaneously.
  useEffect(() => {
    if (isThread) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault()
        setIsSearchOpen(true)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isThread])

  const handleSearchClose = useCallback(() => {
    setIsSearchOpen(false)
    clearSearch()
  }, [clearSearch])

  // Compute timeline items in StreamContent so the virtualizer can use count + keys
  const timelineItems = useMemo(() => groupTimelineItems(events, user?.id), [events, user?.id])

  // Use virtualized scroll for non-thread views, plain scroll for threads
  const useVirtualized = !isThread

  // Filter out zero-height items (reactions, hidden session cards) for the virtualizer.
  // Without this, items that render as empty wrappers get measured as 0px, causing
  // subsequent items to overlap at the same Y position.
  const visibleItems = useMemo(
    () => (useVirtualized ? filterVisibleItems(timelineItems, isChannel) : timelineItems),
    [timelineItems, useVirtualized, isChannel]
  )

  const getItemKey = useCallback(
    (index: number) => {
      const item = visibleItems[index]
      return item ? getTimelineItemKey(item) : String(index)
    },
    [visibleItems]
  )

  // --- Virtualized scroll (main streams, channels, scratchpads) ---
  const {
    scrollContainerRef: virtualScrollRef,
    virtualizer,
    isScrolledFarFromBottom: virtualIsScrolledFar,
    scrollToBottom: virtualScrollToBottom,
    disableAutoScroll: virtualDisableAutoScroll,
    isSettling,
  } = useVirtualizedScroll({
    isLoading,
    itemCount: useVirtualized ? visibleItems.length : 0,
    getItemKey: useVirtualized ? getItemKey : () => "0",
    onScrollNearTop: useVirtualized && hasOlderEvents ? fetchOlderEvents : undefined,
    onScrollNearBottom: useVirtualized && hasNewerEvents ? fetchNewerEvents : undefined,
    isFetchingOlder,
    isFetchingNewer,
    resetKey: streamId,
  })

  // --- Plain scroll for threads (they load all events) ---
  const {
    scrollContainerRef: plainScrollRef,
    handleScroll: plainHandleScroll,
    isScrolledFarFromBottom: plainIsScrolledFar,
    scrollToBottom: plainScrollToBottom,
    disableAutoScroll: plainDisableAutoScroll,
  } = useScrollBehavior({
    isLoading,
    itemCount: !useVirtualized ? events.length : 0,
    onScrollNearTop: !useVirtualized && hasOlderEvents ? fetchOlderEvents : undefined,
    onScrollNearBottom: !useVirtualized && hasNewerEvents ? fetchNewerEvents : undefined,
    isFetchingOlder,
    isFetchingNewer,
    resetKey: streamId,
  })

  // Unified API regardless of scroll mode
  const scrollContainerRef = useVirtualized ? virtualScrollRef : plainScrollRef
  const isScrolledFarFromBottom = useVirtualized ? virtualIsScrolledFar : plainIsScrolledFar
  const scrollToBottom = useVirtualized ? virtualScrollToBottom : plainScrollToBottom
  const disableAutoScroll = useVirtualized ? virtualDisableAutoScroll : plainDisableAutoScroll

  // When a search result is selected, jump to that message
  const handleSearchNavigate = useCallback(
    (messageId: string) => {
      disableAutoScroll()
      jumpToEvent(messageId)
    },
    [jumpToEvent, disableAutoScroll]
  )

  // Jump to highlighted message if it's not in the current event window
  useEffect(() => {
    if (!highlightMessageId || isLoading || isDraft) return
    if (jumpTriggeredRef.current === highlightMessageId) return

    // Disable auto-scroll so highlight scroll-into-view isn't overridden
    disableAutoScroll()

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
  }, [highlightMessageId, isLoading, isDraft, events, jumpToEvent, disableAutoScroll])

  // Reset jump and search state when switching streams (component stays mounted)
  useEffect(() => {
    jumpTriggeredRef.current = null
    exitJumpMode()
    setIsSearchOpen(false)
    clearSearch()
  }, [streamId, exitJumpMode, clearSearch])

  // Auto-mark stream as read when viewing
  const lastEventId = events.length > 0 ? events[events.length - 1].id : undefined
  useAutoMarkAsRead(workspaceId, streamId, lastEventId, { enabled: !isDraft && !isLoading && !isJumpMode })

  // Track live-arriving messages from other users for brief "new" indicator.
  const newMessageIds = useNewMessageIndicator(events, currentWorkspaceUserId ?? undefined, streamId, lastReadEventId)

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
  const membershipResolved = currentWorkspaceUserId !== null || bootstrap !== undefined
  let disabledReason: string | undefined
  if (isSystem) {
    disabledReason = "System notifications are read-only."
  } else if (isArchived) {
    disabledReason = "This thread has been sealed in the labyrinth. It can be read but not extended."
  }

  const handleJoined = useCallback(
    (membership: StreamMember) => {
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        return { ...(old as StreamBootstrap), membership }
      })
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
      requestAnimationFrame(() => {
        scrollToBottom({ force: true })
      })
    } else {
      scrollToBottom({ force: true, behavior: "smooth" })
    }
  }, [isJumpMode, exitJumpMode, scrollToBottom])

  if (error && !isDraft && events.length === 0 && !idbStream) {
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
      <InlineEditProvider resetKey={streamId}>
        <div className="flex h-full flex-col">
          <div className="relative flex-1 overflow-hidden mb-1 sm:mb-4">
            {isSearchOpen && (
              <StreamSearchBar search={streamSearch} onClose={handleSearchClose} onNavigate={handleSearchNavigate} />
            )}
            <div
              ref={scrollContainerRef}
              className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
              data-suppress-pull-refresh="true"
              onScroll={useVirtualized ? undefined : plainHandleScroll}
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
                  timelineItems={useVirtualized ? visibleItems : timelineItems}
                  isLoading={isLoading}
                  isSettling={isSettling}
                  workspaceId={workspaceId}
                  streamId={streamId}
                  highlightMessageId={streamSearch.activeResult?.id ?? highlightMessageId}
                  firstUnreadEventId={dividerEventId}
                  isDividerFading={isDividerFading}
                  agentActivity={agentActivity}
                  hideSessionCards={isChannel}
                  newMessageIds={newMessageIds}
                  virtualizer={useVirtualized ? virtualizer : undefined}
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
          {membershipResolved && !isMember && isPublicChannel && (
            <JoinChannelBar
              workspaceId={workspaceId}
              streamId={streamId}
              channelName={stream?.slug ?? stream?.displayName ?? ""}
              onJoined={handleJoined}
            />
          )}
          {(isMember || !isPublicChannel || !membershipResolved) && (
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
