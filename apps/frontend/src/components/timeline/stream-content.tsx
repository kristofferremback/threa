import { useMemo, useEffect, useCallback, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Virtuoso } from "react-virtuoso"
import { MessageSquare, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import {
  useEvents,
  useStreamSocket,
  useVirtuosoScroll,
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
import { useSocket, useCoordinatedLoading } from "@/contexts"
import { useStreamEvents } from "@/stores/stream-store"
import { useWorkspaceStreams, useWorkspaceStreamMemberships } from "@/stores/workspace-store"
import { useUser } from "@/auth"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
import {
  EventList,
  TimelineItemContent,
  groupTimelineItems,
  getTimelineItemKey,
  filterVisibleItems,
  type TimelineItem,
  type TimelineItemRenderContext,
} from "./event-list"
import { MessageInput } from "./message-input"
import { JoinChannelBar } from "./join-channel-bar"
import { ThreadParentMessage } from "../thread/thread-parent-message"
import { EditLastMessageContext } from "./edit-last-message-context"
import { InlineEditProvider } from "./inline-edit-context"
import { StreamSearchBar } from "./stream-search-bar"
import { useStreamSearch } from "@/hooks/use-stream-search"
import { useSearchHighlight } from "@/hooks/use-search-highlight"

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

  // Cmd+F / Ctrl+F opens in-stream search or re-focuses if already open.
  // Also listens for the custom event from the header search button.
  // Escape closes search when focus is outside the input.
  // Skip in thread views to avoid double search bar.
  useEffect(() => {
    if (isThread) return
    const openOrFocus = () => {
      if (isSearchOpen) {
        streamSearch.focus()
      } else {
        setIsSearchOpen(true)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault()
        openOrFocus()
      }
      if (e.key === "Escape" && isSearchOpen) {
        setIsSearchOpen(false)
        clearSearch()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("threa:open-stream-search", openOrFocus)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("threa:open-stream-search", openOrFocus)
    }
  }, [isThread, isSearchOpen, streamSearch, clearSearch])

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

  // --- Virtuoso scroll (main streams, channels, scratchpads) ---
  const {
    virtuosoRef,
    firstItemIndex,
    initialTopMostItemIndex,
    isScrolledFarFromBottom: virtualIsScrolledFar,
    shouldFollowOutput,
    scrollToBottom: virtualScrollToBottom,
    disableAutoScroll: virtualDisableAutoScroll,
    handleAtBottomChange,
    handleRangeChanged,
    handleScrollerRef,
    resetPrependState,
  } = useVirtuosoScroll({
    itemCount: useVirtualized ? visibleItems.length : 0,
    getItemKey: useVirtualized ? getItemKey : () => "0",
    resetKey: streamId,
    skipInitialScroll: !!highlightMessageId,
  })

  // Virtuoso ref for scroll container access (search highlight, etc.)
  const virtuosoScrollerRef = useRef<HTMLDivElement | null>(null)

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
  const scrollContainerRef = useVirtualized ? virtuosoScrollerRef : plainScrollRef
  const isScrolledFarFromBottom = useVirtualized ? virtualIsScrolledFar : plainIsScrolledFar
  const scrollToBottom = useVirtualized ? virtualScrollToBottom : plainScrollToBottom
  const disableAutoScroll = useVirtualized ? virtualDisableAutoScroll : plainDisableAutoScroll

  // Scroll to a specific message and keep re-scrolling until the target
  // element is actually visible in the scroller viewport. Items rendered
  // with estimated heights cause the target to drift after the first scroll
  // as surrounding items are measured; this loop keeps correcting until
  // stable (or a short timeout). User input (wheel / touch / key) aborts
  // the loop immediately so manual scrolling always wins.
  //
  // Implementation notes: Virtuoso's scrollToIndex expects the 0-based
  // index within the current data array (NOT firstItemIndex + idx). Once
  // the item is rendered in the DOM we use native scrollTo on the scroller
  // to position it precisely — this sidesteps Virtuoso's internal offset
  // estimation which tends to overshoot with unmeasured items.
  const scrollRetryTimerRef = useRef<number | null>(null)
  const scrollAbortRef = useRef<(() => void) | null>(null)
  const scrollToMessage = useCallback(
    (messageId: string) => {
      if (!useVirtualized) return false
      const idx = visibleItems.findIndex((item) => {
        if (item.type !== "event") return false
        return (item.event.payload as { messageId?: string })?.messageId === messageId
      })
      if (idx < 0) return false

      // Cancel any previous retry loop
      if (scrollRetryTimerRef.current !== null) {
        window.clearTimeout(scrollRetryTimerRef.current)
        scrollRetryTimerRef.current = null
      }
      scrollAbortRef.current?.()
      scrollAbortRef.current = null

      // Disable auto-scroll so followOutput doesn't snap back to bottom
      // while we're trying to scroll the target into view.
      disableAutoScroll()

      const scroller = virtuosoScrollerRef.current
      if (!scroller) return false

      // Abort the retry loop the moment the user takes over
      let aborted = false
      const abort = () => {
        aborted = true
        if (scrollRetryTimerRef.current !== null) {
          window.clearTimeout(scrollRetryTimerRef.current)
          scrollRetryTimerRef.current = null
        }
        scroller.removeEventListener("wheel", abort)
        scroller.removeEventListener("touchmove", abort)
        scroller.removeEventListener("keydown", abort)
        scrollAbortRef.current = null
      }
      scrollAbortRef.current = abort
      scroller.addEventListener("wheel", abort, { passive: true })
      scroller.addEventListener("touchmove", abort, { passive: true })
      scroller.addEventListener("keydown", abort)

      const started = performance.now()
      const MAX_MS = 1200
      let stableFrames = 0

      const attempt = () => {
        if (aborted) return

        const el = scroller.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)

        if (el) {
          // Target is rendered — scroll via DOM so we get pixel-precise positioning
          const sr = scroller.getBoundingClientRect()
          const er = el.getBoundingClientRect()
          const elCenter = (er.top + er.bottom) / 2
          const scCenter = (sr.top + sr.bottom) / 2
          const delta = elCenter - scCenter
          if (Math.abs(delta) > 2) {
            scroller.scrollTop += delta
          }

          // Re-measure after the scroll
          const er2 = el.getBoundingClientRect()
          const fullyVisible = er2.top >= sr.top - 1 && er2.bottom <= sr.bottom + 1
          const hasScrollRoom = scroller.scrollHeight > scroller.clientHeight + 8
          const centered = !hasScrollRoom || Math.abs((er2.top + er2.bottom) / 2 - scCenter) < 40
          if (fullyVisible && centered) {
            stableFrames += 1
            if (stableFrames >= 2) {
              abort()
              return
            }
          } else {
            stableFrames = 0
          }
        } else {
          // Target is virtualized out — ask Virtuoso to render it (0-based index)
          virtuosoRef.current?.scrollToIndex({ index: idx, align: "center", behavior: "auto" })
          stableFrames = 0
        }

        const elapsed = performance.now() - started
        if (elapsed < MAX_MS) {
          scrollRetryTimerRef.current = window.setTimeout(attempt, 60)
        } else {
          abort()
        }
      }
      attempt()
      return true
    },
    [useVirtualized, visibleItems, virtuosoRef, disableAutoScroll]
  )

  useEffect(() => {
    return () => {
      scrollAbortRef.current?.()
    }
  }, [])

  // After jumpToEvent loads events around a target, scroll to it once the
  // events array updates and the target is present.
  const pendingScrollTarget = useRef<string | null>(null)

  // When a search result is selected, navigate to that message.
  // If the message is already in the loaded events, just scroll to it in the DOM —
  // don't call jumpToEvent which loads a new event window and disrupts scroll position.
  // Only use jumpToEvent for messages outside the current window (older history).
  const handleSearchNavigate = useCallback(
    (messageId: string) => {
      const isInCurrentEvents = events.some((e) => {
        const payload = e.payload as { messageId?: string }
        return payload?.messageId === messageId
      })

      if (isInCurrentEvents) {
        // Message is loaded — scroll to it (handles both in-DOM and virtualized-out items)
        scrollToMessage(messageId)
        return
      }

      // Message not in current window — load events around it, then scroll after load
      disableAutoScroll()
      pendingScrollTarget.current = messageId
      jumpToEvent(messageId)
    },
    [events, jumpToEvent, disableAutoScroll, scrollToMessage]
  )

  // Highlight search matches in the DOM via CSS Custom Highlight API
  useSearchHighlight(
    scrollContainerRef,
    isSearchOpen ? streamSearch.query : "",
    streamSearch.activeMessageId,
    streamSearch.activeOccurrence
  )
  useEffect(() => {
    if (!pendingScrollTarget.current || isLoading) return
    const target = pendingScrollTarget.current
    const found = events.some((e) => {
      const payload = e.payload as { messageId?: string }
      return payload?.messageId === target
    })
    if (found) {
      // Allow one frame for Virtuoso to process the new data before scrolling
      requestAnimationFrame(() => scrollToMessage(target))
      pendingScrollTarget.current = null
    }
  }, [events, isLoading, scrollToMessage])

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

    if (isVisible) {
      scrollToMessage(highlightMessageId)
      return
    }

    if (events.length > 0) {
      jumpTriggeredRef.current = highlightMessageId
      pendingScrollTarget.current = highlightMessageId
      jumpToEvent(highlightMessageId)
        .then((success) => {
          if (!success) {
            jumpTriggeredRef.current = null
            pendingScrollTarget.current = null
          }
        })
        .catch(() => {
          jumpTriggeredRef.current = null
          pendingScrollTarget.current = null
        })
    }
  }, [highlightMessageId, isLoading, isDraft, events, jumpToEvent, disableAutoScroll, scrollToMessage])

  // Reset jump and search state when switching streams (component stays mounted).
  // Also abort any in-flight scrollToMessage retry loop so its stale closure
  // (holding an index from the previous stream) doesn't scroll the new stream
  // to the wrong position.
  useEffect(() => {
    jumpTriggeredRef.current = null
    scrollAbortRef.current?.()
    pendingScrollTarget.current = null
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
      // The event window is about to be replaced wholesale (jump window →
      // latest window). Clear the prepend baseline so the next render isn't
      // mis-detected as a real prepend.
      resetPrependState()
      requestAnimationFrame(() => {
        scrollToBottom({ force: true })
      })
    } else {
      scrollToBottom({ force: true, behavior: "smooth" })
    }
  }, [isJumpMode, exitJumpMode, resetPrependState, scrollToBottom])

  if (error && !isDraft && events.length === 0 && !idbStream) {
    return (
      <ErrorView
        className="h-full border-0"
        title="Failed to Load Messages"
        description="We couldn't load the messages for this stream. Please refresh the page or try again later."
      />
    )
  }

  const editLastMessageCtxWithScroll = useMemo(
    () => ({ ...editLastMessageCtx, scrollToMessage }),
    [editLastMessageCtx, scrollToMessage]
  )

  return (
    <EditLastMessageContext.Provider value={editLastMessageCtxWithScroll}>
      <InlineEditProvider resetKey={streamId}>
        <div className="flex h-full flex-col">
          <div className="relative flex-1 overflow-hidden">
            {isSearchOpen && (
              <StreamSearchBar search={streamSearch} onClose={handleSearchClose} onNavigate={handleSearchNavigate} />
            )}
            {isDraft && (
              <div className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain">
                <Empty className="h-full border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageSquare />
                    </EmptyMedia>
                    <EmptyTitle>Start a conversation</EmptyTitle>
                    <EmptyDescription>Type a message below to begin this scratchpad.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            )}
            {!isDraft && useVirtualized && (
              <>
                <VirtuosoMessageList
                  visibleItems={visibleItems}
                  isLoading={isLoading}
                  virtuosoRef={virtuosoRef}
                  virtuosoScrollerRef={virtuosoScrollerRef}
                  handleScrollerRef={handleScrollerRef}
                  firstItemIndex={firstItemIndex}
                  initialTopMostItemIndex={initialTopMostItemIndex}
                  shouldFollowOutput={shouldFollowOutput}
                  handleAtBottomChange={handleAtBottomChange}
                  handleRangeChanged={handleRangeChanged}
                  hasOlderEvents={hasOlderEvents}
                  hasNewerEvents={hasNewerEvents}
                  fetchOlderEvents={fetchOlderEvents}
                  fetchNewerEvents={fetchNewerEvents}
                  isFetchingOlder={isFetchingOlder}
                  isFetchingNewer={isFetchingNewer}
                  workspaceId={workspaceId}
                  streamId={streamId}
                  highlightMessageId={streamSearch.activeMessageId ?? highlightMessageId}
                  firstUnreadEventId={dividerEventId}
                  isDividerFading={isDividerFading}
                  agentActivity={agentActivity}
                  hideSessionCards={isChannel}
                  newMessageIds={newMessageIds}
                  isSearchOpen={isSearchOpen}
                />
                {/* Overlay loading indicators — absolutely positioned so they
                    don't cause layout shift when prepending older messages. */}
                <div
                  aria-hidden={!isFetchingOlder}
                  className={cn(
                    "pointer-events-none absolute left-1/2 -translate-x-1/2 z-10 rounded-full bg-background/90 px-3 py-1 shadow-sm border text-xs text-muted-foreground transition-opacity",
                    isSearchOpen ? "top-14" : "top-2",
                    isFetchingOlder ? "opacity-100" : "opacity-0"
                  )}
                >
                  Loading older messages...
                </div>
                <div
                  aria-hidden={!isFetchingNewer}
                  className={cn(
                    "pointer-events-none absolute left-1/2 -translate-x-1/2 z-20 rounded-full bg-background/90 px-3 py-1 shadow-sm border text-xs text-muted-foreground transition-opacity",
                    // Sit above the Jump to latest button (bottom-4 + button height) when visible
                    isJumpMode || isScrolledFarFromBottom ? "bottom-16" : "bottom-2",
                    isFetchingNewer ? "opacity-100" : "opacity-0"
                  )}
                >
                  Loading newer messages...
                </div>
              </>
            )}
            {!isDraft && !useVirtualized && (
              <div
                ref={plainScrollRef}
                className={cn("h-full overflow-y-auto overflow-x-hidden overscroll-y-contain", isSearchOpen && "pt-11")}
                data-suppress-pull-refresh="true"
                onScroll={plainHandleScroll}
              >
                {isThread && parentMessage && parentStreamId && (
                  <ThreadParentMessage
                    event={parentMessage}
                    workspaceId={workspaceId}
                    streamId={parentStreamId}
                    replyCount={events.length}
                  />
                )}
                {isFetchingOlder && (
                  <div className="flex justify-center py-2">
                    <p className="text-sm text-muted-foreground">Loading older messages...</p>
                  </div>
                )}
                <EventList
                  timelineItems={timelineItems}
                  isLoading={isLoading}
                  workspaceId={workspaceId}
                  streamId={streamId}
                  highlightMessageId={streamSearch.activeMessageId ?? highlightMessageId}
                  firstUnreadEventId={dividerEventId}
                  isDividerFading={isDividerFading}
                  agentActivity={agentActivity}
                  hideSessionCards={isChannel}
                  newMessageIds={newMessageIds}
                />
                {isFetchingNewer && (
                  <div className="flex justify-center py-2">
                    <p className="text-sm text-muted-foreground">Loading newer messages...</p>
                  </div>
                )}
              </div>
            )}
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

/** Virtuoso-powered message list for streams, channels, and scratchpads */
function VirtuosoMessageList({
  visibleItems,
  isLoading,
  virtuosoRef,
  virtuosoScrollerRef,
  handleScrollerRef,
  firstItemIndex,
  initialTopMostItemIndex,
  shouldFollowOutput,
  handleAtBottomChange,
  handleRangeChanged,
  hasOlderEvents,
  hasNewerEvents,
  fetchOlderEvents,
  fetchNewerEvents,
  isFetchingOlder,
  isFetchingNewer,
  workspaceId,
  streamId,
  highlightMessageId,
  firstUnreadEventId,
  isDividerFading,
  agentActivity,
  hideSessionCards,
  newMessageIds,
  isSearchOpen,
}: {
  visibleItems: TimelineItem[]
  isLoading: boolean
  virtuosoRef: React.RefObject<import("react-virtuoso").VirtuosoHandle | null>
  virtuosoScrollerRef: React.MutableRefObject<HTMLDivElement | null>
  handleScrollerRef: (ref: HTMLElement | Window | null) => void
  firstItemIndex: number
  initialTopMostItemIndex: import("react-virtuoso").IndexLocationWithAlign | number | undefined
  shouldFollowOutput: boolean
  handleAtBottomChange: (atBottom: boolean) => void
  handleRangeChanged: (range: { startIndex: number; endIndex: number }) => void
  hasOlderEvents: boolean
  hasNewerEvents: boolean
  fetchOlderEvents: () => boolean
  fetchNewerEvents: () => boolean
  isFetchingOlder: boolean
  isFetchingNewer: boolean
  workspaceId: string
  streamId: string
  highlightMessageId?: string | null
  firstUnreadEventId?: string
  isDividerFading?: boolean
  agentActivity?: Map<string, import("@/hooks").MessageAgentActivity>
  hideSessionCards?: boolean
  newMessageIds?: Set<string>
  isSearchOpen: boolean
}) {
  const { phase } = useCoordinatedLoading()

  const sessionLiveCounts = useMemo(() => {
    const counts = new Map<string, { stepCount: number; messageCount: number }>()
    if (agentActivity) {
      for (const activity of agentActivity.values()) {
        counts.set(activity.sessionId, {
          stepCount: activity.stepCount,
          messageCount: activity.messageCount,
        })
      }
    }
    return counts
  }, [agentActivity])

  const renderCtx = useMemo<TimelineItemRenderContext>(
    () => ({
      workspaceId,
      streamId,
      highlightMessageId,
      firstUnreadEventId,
      isDividerFading,
      agentActivity,
      hideSessionCards,
      newMessageIds,
      sessionLiveCounts,
      phase,
    }),
    [
      workspaceId,
      streamId,
      highlightMessageId,
      firstUnreadEventId,
      isDividerFading,
      agentActivity,
      hideSessionCards,
      newMessageIds,
      sessionLiveCounts,
      phase,
    ]
  )

  // Memoize followOutput callback ref to avoid Virtuoso re-renders
  const shouldFollowRef = useRef(shouldFollowOutput)
  shouldFollowRef.current = shouldFollowOutput

  const followOutput = useCallback((_isAtBottom: boolean) => {
    if (shouldFollowRef.current) return "auto"
    return false
  }, [])

  // Fetch guards to prevent rapid re-firing
  const olderFetchCooldownRef = useRef(0)
  const newerFetchCooldownRef = useRef(0)
  const FETCH_COOLDOWN_MS = 500

  const handleStartReached = useCallback(() => {
    if (!hasOlderEvents || isFetchingOlder) return
    const now = performance.now()
    if (now < olderFetchCooldownRef.current) return
    const started = fetchOlderEvents()
    if (started !== false) {
      olderFetchCooldownRef.current = now + FETCH_COOLDOWN_MS
    }
  }, [hasOlderEvents, isFetchingOlder, fetchOlderEvents])

  const handleEndReached = useCallback(() => {
    if (!hasNewerEvents || isFetchingNewer) return
    const now = performance.now()
    if (now < newerFetchCooldownRef.current) return
    const started = fetchNewerEvents()
    if (started !== false) {
      newerFetchCooldownRef.current = now + FETCH_COOLDOWN_MS
    }
  }, [hasNewerEvents, isFetchingNewer, fetchNewerEvents])

  const itemContent = useCallback(
    (_index: number, item: TimelineItem) => (
      <div className="mx-auto max-w-[800px]">
        <TimelineItemContent item={item} ctx={renderCtx} />
      </div>
    ),
    [renderCtx]
  )

  // Stable scroller ref callback — wrapping in useCallback avoids Virtuoso
  // calling the old callback with null and the new one with the element
  // on every render, which would disconnect/reconnect the ResizeObserver.
  const handleVirtuosoScrollerRef = useCallback(
    (ref: HTMLElement | Window | null) => {
      virtuosoScrollerRef.current = ref as HTMLDivElement | null
      handleScrollerRef(ref)
    },
    [virtuosoScrollerRef, handleScrollerRef]
  )

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    )
  }

  if (visibleItems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No messages yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Start the conversation by sending a message below</p>
        </div>
      </div>
    )
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      scrollerRef={handleVirtuosoScrollerRef}
      className={cn("h-full", isSearchOpen && "pt-11")}
      data-suppress-pull-refresh="true"
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={initialTopMostItemIndex}
      data={visibleItems}
      defaultItemHeight={120}
      skipAnimationFrameInResizeObserver
      itemContent={itemContent}
      followOutput={followOutput}
      atBottomStateChange={handleAtBottomChange}
      rangeChanged={handleRangeChanged}
      startReached={handleStartReached}
      endReached={handleEndReached}
      atBottomThreshold={30}
      increaseViewportBy={{ top: 600, bottom: 600 }}
    />
  )
}
