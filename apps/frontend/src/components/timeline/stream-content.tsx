import { useMemo, useEffect, useCallback, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Virtuoso } from "react-virtuoso"
import { MessageSquare, ArrowDown, X, Move, Loader2 } from "lucide-react"
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
  useAbortResearch,
  useEditLastMessageTrigger,
  useKeyboardShortcuts,
  streamKeys,
  workspaceKeys,
} from "@/hooks"
import { useSocket, useCoordinatedLoading } from "@/contexts"
import { useMessageService } from "@/contexts"
import { useStreamEvents } from "@/stores/stream-store"
import { useWorkspaceStreams, useWorkspaceStreamMemberships } from "@/stores/workspace-store"
import { useUser } from "@/auth"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { ErrorView } from "@/components/error-view"
import {
  StreamTypes,
  Visibilities,
  AgentStepTypes,
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
  annotateAuthorGroups,
  findFirstMessageId,
  getTimelineItemKey,
  filterVisibleItems,
  type TimelineItem,
  type TimelineItemRenderContext,
  type BatchTimelineState,
} from "./event-list"
import { MessageInput } from "./message-input"
import { JoinChannelBar } from "./join-channel-bar"
import { ThreadParentMessage } from "../thread/thread-parent-message"
import { EditLastMessageContext } from "./edit-last-message-context"
import { QuoteReplyProvider } from "./quote-reply-context"
import { SharedMessagesProvider } from "@/components/shared-messages/context"
import { TextSelectionQuote } from "./text-selection-quote"
import { StreamSearchBar } from "./stream-search-bar"
import { useStreamSearch } from "@/hooks/use-stream-search"
import { useSearchHighlight } from "@/hooks/use-search-highlight"
import { stripMarkdownToInline } from "@/lib/markdown"
import { addStartBatchSelectListener } from "@/lib/batch-selection-events"

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
  const messageService = useMessageService()
  const jumpTriggeredRef = useRef<string | null>(null)
  const user = useUser()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set())
  const [hoveredBatchTargetId, setHoveredBatchTargetId] = useState<string | null>(null)
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number } | null>(null)
  const [pendingMove, setPendingMove] = useState<{
    targetMessageId: string
    messageIds: string[]
    leaseKey: string
    messageCount: number
  } | null>(null)
  const [isMoveValidating, setIsMoveValidating] = useState(false)
  const [isMoveConfirming, setIsMoveConfirming] = useState(false)
  // Anti-flicker: only surface the validating dialog if validation is slow
  // enough that the user would otherwise wonder whether anything happened.
  // Matches `LOADING_DELAY_MS` / `SKELETON_DELAY_MS` (300ms) used elsewhere.
  const [showValidatingDialog, setShowValidatingDialog] = useState(false)
  const suppressNextBatchClickRef = useRef(false)
  const suppressNextBatchClickTimerRef = useRef<number | null>(null)
  const batchPointerRef = useRef<{
    id: number
    messageId: string
    x: number
    y: number
    dragging: boolean
    wasSelected: boolean
  } | null>(null)

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
    isConfirmedEmpty,
    error,
    pagedSharedMessages,
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

  // Merge bootstrap + paginated `sharedMessages` so pointers in pages older
  // than the bootstrap window (or in jump-mode windows) hydrate without
  // waiting for a full bootstrap refetch. Bootstrap entries take precedence
  // when both maps carry the same source-message id since bootstrap reflects
  // the latest backend response while paged data may be older.
  const mergedSharedMessages = useMemo(
    () => ({ ...pagedSharedMessages, ...(bootstrap?.sharedMessages ?? {}) }),
    [pagedSharedMessages, bootstrap?.sharedMessages]
  )

  // For drafts, query pending/failed events directly from IDB so optimistic
  // messages are visible while offline or waiting for queue processing.
  const draftPendingEvents = useStreamEvents(isDraft ? streamId : undefined)
  const hasDraftPendingEvents = isDraft && draftPendingEvents && draftPendingEvents.length > 0

  const editLastMessageCtx = useEditLastMessageTrigger(events, currentWorkspaceUserId)

  // Track live agent session progress for all stream types (step/message counts on session cards).
  // In channels, session cards are hidden (responses go to threads) and inline activity shows on trigger messages instead.
  const isChannel = stream?.type === StreamTypes.CHANNEL
  const agentActivity = useAgentActivity(events, socket)

  // --- In-stream search ---
  const streamSearch = useStreamSearch({ workspaceId, streamId })
  const clearSearch = streamSearch.clear
  const openOrFocusSearch = useCallback(() => {
    if (isSearchOpen) {
      streamSearch.focus()
    } else {
      setIsSearchOpen(true)
    }
  }, [isSearchOpen, streamSearch])

  useKeyboardShortcuts(
    {
      searchInStream: openOrFocusSearch,
    },
    !isThread && !isDraft
  )

  // Header search button dispatches a custom event so it can share the same open/focus path.
  useEffect(() => {
    if (isThread || isDraft) return

    document.addEventListener("threa:open-stream-search", openOrFocusSearch)
    return () => {
      document.removeEventListener("threa:open-stream-search", openOrFocusSearch)
    }
  }, [isDraft, isThread, openOrFocusSearch])

  // Escape closes search when focus is outside the search input.
  useEffect(() => {
    if (!isSearchOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable

      if (event.key === "Escape" && !isInput) {
        setIsSearchOpen(false)
        clearSearch()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isSearchOpen, clearSearch])

  const handleSearchClose = useCallback(() => {
    setIsSearchOpen(false)
    clearSearch()
  }, [clearSearch])

  // Compute timeline items in StreamContent so the virtualizer can use count + keys.
  // After grouping commands/sessions, annotate consecutive same-author message runs
  // with `groupContinuation` so MessageEvent can collapse the repeated header row.
  const displayEvents = useMemo(() => {
    if (!isThread) return events
    return [...events].sort((a, b) => {
      const timeDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      if (timeDelta !== 0) return timeDelta
      return a.id.localeCompare(b.id)
    })
  }, [events, isThread])

  const timelineItems = useMemo(
    () => annotateAuthorGroups(groupTimelineItems(displayEvents, user?.id)),
    [displayEvents, user?.id]
  )

  const messageEventMeta = useMemo(() => {
    const meta = new Map<string, { sequence: bigint; content: string }>()
    for (const event of displayEvents) {
      if (event.eventType !== "message_created") continue
      const payload = event.payload as { messageId?: string; contentMarkdown?: string; deletedAt?: string }
      if (!payload.messageId || payload.deletedAt) continue
      meta.set(payload.messageId, { sequence: BigInt(event.sequence), content: payload.contentMarkdown ?? "" })
    }
    return meta
  }, [displayEvents])

  const selectedSequenceFloor = useMemo(() => {
    let min: bigint | null = null
    for (const messageId of selectedMessageIds) {
      const sequence = messageEventMeta.get(messageId)?.sequence
      if (sequence === undefined) continue
      min = min === null || sequence < min ? sequence : min
    }
    return min
  }, [messageEventMeta, selectedMessageIds])

  const invalidBatchTargetIds = useMemo(() => {
    const invalid = new Set<string>()
    if (!batchMode || !dragGhost || selectedSequenceFloor === null) return invalid
    for (const [messageId, meta] of messageEventMeta) {
      if (selectedMessageIds.has(messageId) || meta.sequence >= selectedSequenceFloor) {
        invalid.add(messageId)
      }
    }
    return invalid
  }, [batchMode, dragGhost, messageEventMeta, selectedMessageIds, selectedSequenceFloor])

  const isValidBatchTarget = useCallback(
    (messageId: string | null) => {
      if (!messageId || selectedSequenceFloor === null) return false
      const meta = messageEventMeta.get(messageId)
      return !!meta && !selectedMessageIds.has(messageId) && meta.sequence < selectedSequenceFloor
    },
    [messageEventMeta, selectedMessageIds, selectedSequenceFloor]
  )

  const startBatchSelect = useCallback(() => {
    setBatchMode(true)
    setSelectedMessageIds(new Set())
    setHoveredBatchTargetId(null)
    setDragGhost(null)
    // Selection and search share the same flush-top strip; keep one open at a
    // time so they can't stack. Search bar's own listeners handle the reverse.
    setIsSearchOpen(false)
    clearSearch()
  }, [clearSearch])

  const toggleBatchMessage = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) {
        next.delete(messageId)
      } else {
        next.add(messageId)
      }
      return next
    })
  }, [])

  const cancelBatchMode = useCallback(() => {
    setBatchMode(false)
    setSelectedMessageIds(new Set())
    setHoveredBatchTargetId(null)
    setDragGhost(null)
    setPendingMove(null)
    batchPointerRef.current = null
    suppressNextBatchClickRef.current = false
    if (suppressNextBatchClickTimerRef.current !== null) {
      window.clearTimeout(suppressNextBatchClickTimerRef.current)
      suppressNextBatchClickTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return addStartBatchSelectListener((detail) => {
      if (detail.streamId !== streamId) return
      startBatchSelect()
    })
  }, [startBatchSelect, streamId])

  useEffect(() => {
    cancelBatchMode()
    suppressNextBatchClickRef.current = false
  }, [streamId, cancelBatchMode])

  const batchState = useMemo<BatchTimelineState | undefined>(
    () => ({
      enabled: batchMode,
      selectedMessageIds,
      invalidTargetIds: invalidBatchTargetIds,
      hoveredTargetId: hoveredBatchTargetId,
      onToggleMessage: toggleBatchMessage,
    }),
    [batchMode, selectedMessageIds, invalidBatchTargetIds, hoveredBatchTargetId, toggleBatchMessage]
  )

  const findMessageIdFromPoint = useCallback((x: number, y: number) => {
    const element = document.elementFromPoint(x, y)
    return element?.closest<HTMLElement>("[data-message-id]")?.dataset.messageId ?? null
  }, [])

  const dropBatchOnTarget = useCallback(
    async (targetMessageId: string) => {
      const messageIds = Array.from(selectedMessageIds)
      if (messageIds.length === 0 || isMoveValidating) return
      setIsMoveValidating(true)
      try {
        const validation = await messageService.validateMoveToThread(workspaceId, {
          sourceStreamId: streamId,
          targetMessageId,
          messageIds,
        })
        setPendingMove({
          targetMessageId,
          messageIds,
          leaseKey: validation.leaseKey,
          messageCount: validation.messageCount,
        })
      } catch (error) {
        console.error("validateMoveToThread failed", { error, streamId, targetMessageId, messageIds })
        toast.error(error instanceof Error ? error.message : "Could not validate this move")
      } finally {
        setIsMoveValidating(false)
      }
    },
    [isMoveValidating, messageService, selectedMessageIds, streamId, workspaceId]
  )

  const confirmPendingMove = useCallback(async () => {
    if (!pendingMove || isMoveConfirming) return
    setIsMoveConfirming(true)
    try {
      await messageService.moveToThread(workspaceId, {
        sourceStreamId: streamId,
        targetMessageId: pendingMove.targetMessageId,
        messageIds: pendingMove.messageIds,
        leaseKey: pendingMove.leaseKey,
      })
      toast.success(`Moved ${pendingMove.messageCount} message${pendingMove.messageCount === 1 ? "" : "s"} to thread`)
      cancelBatchMode()
    } catch (error) {
      console.error("moveToThread failed", { error, streamId, pendingMove })
      toast.error(error instanceof Error ? error.message : "Could not move messages")
    } finally {
      setIsMoveConfirming(false)
    }
  }, [cancelBatchMode, isMoveConfirming, messageService, pendingMove, streamId, workspaceId])

  const closePendingMove = useCallback(() => {
    if (isMoveConfirming) return
    setPendingMove(null)
  }, [isMoveConfirming])

  // Show the loading dialog ONLY if validation hasn't resolved within 300ms.
  // Fast validations skip straight to the confirm dialog with no flash.
  useEffect(() => {
    if (!isMoveValidating) {
      setShowValidatingDialog(false)
      return
    }
    const timer = window.setTimeout(() => setShowValidatingDialog(true), 300)
    return () => window.clearTimeout(timer)
  }, [isMoveValidating])

  const pendingMoveDescription = pendingMove
    ? `Move ${pendingMove.messageCount} selected message${pendingMove.messageCount === 1 ? "" : "s"} into this thread?`
    : ""
  const isValidatingPhase = showValidatingDialog && !pendingMove
  const moveDialogOpen = !!pendingMove || isValidatingPhase

  const batchPointerHandlers = batchMode
    ? {
        onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
          const target = event.target as HTMLElement
          if (target.closest("[data-batch-control]")) return
          const messageId = target.closest<HTMLElement>("[data-message-id]")?.dataset.messageId
          if (!messageId) return
          event.preventDefault()
          batchPointerRef.current = {
            id: event.pointerId,
            messageId,
            x: event.clientX,
            y: event.clientY,
            dragging: false,
            wasSelected: selectedMessageIds.has(messageId),
          }
          if (!selectedMessageIds.has(messageId)) {
            setSelectedMessageIds((prev) => new Set(prev).add(messageId))
          }
        },
        onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
          const pointer = batchPointerRef.current
          if (!pointer || pointer.id !== event.pointerId) return
          const distance = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y)
          if (!pointer.dragging && distance < 6) return
          event.preventDefault()
          if (!pointer.dragging && !selectedMessageIds.has(pointer.messageId)) {
            setSelectedMessageIds((prev) => new Set(prev).add(pointer.messageId))
          }
          pointer.dragging = true
          setDragGhost({ x: event.clientX, y: event.clientY })
          const targetId = findMessageIdFromPoint(event.clientX, event.clientY)
          const validTargetId = isValidBatchTarget(targetId) ? targetId : null
          setHoveredBatchTargetId((previous) => {
            if (previous !== validTargetId && validTargetId && "vibrate" in navigator) {
              navigator.vibrate?.(10)
            }
            return validTargetId
          })
        },
        onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
          const pointer = batchPointerRef.current
          if (!pointer || pointer.id !== event.pointerId) return
          event.preventDefault()
          suppressNextBatchClickRef.current = true
          if (suppressNextBatchClickTimerRef.current !== null) {
            window.clearTimeout(suppressNextBatchClickTimerRef.current)
          }
          suppressNextBatchClickTimerRef.current = window.setTimeout(() => {
            suppressNextBatchClickRef.current = false
            suppressNextBatchClickTimerRef.current = null
          }, 350)
          const targetId = hoveredBatchTargetId
          const wasDragging = pointer.dragging
          batchPointerRef.current = null
          setDragGhost(null)
          setHoveredBatchTargetId(null)
          if (!wasDragging) {
            setSelectedMessageIds((prev) => {
              const next = new Set(prev)
              if (pointer.wasSelected) {
                next.delete(pointer.messageId)
              } else {
                next.add(pointer.messageId)
              }
              return next
            })
            return
          }
          if (wasDragging && targetId && isValidBatchTarget(targetId)) {
            void dropBatchOnTarget(targetId)
          }
        },
        onPointerCancel: () => {
          batchPointerRef.current = null
          setDragGhost(null)
          setHoveredBatchTargetId(null)
          suppressNextBatchClickRef.current = false
          if (suppressNextBatchClickTimerRef.current !== null) {
            window.clearTimeout(suppressNextBatchClickTimerRef.current)
            suppressNextBatchClickTimerRef.current = null
          }
        },
        onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
          if (!suppressNextBatchClickRef.current) return
          suppressNextBatchClickRef.current = false
          event.preventDefault()
          event.stopPropagation()
        },
      }
    : {}

  // For drafts with pending events, compute timeline items from those events. Drafts
  // are a single-author transcript already, but running the same pipeline keeps the
  // rendering branch identical whether an event is committed or pending.
  const draftTimelineItems = useMemo(
    () => (hasDraftPendingEvents ? annotateAuthorGroups(groupTimelineItems(draftPendingEvents!, user?.id)) : []),
    [hasDraftPendingEvents, draftPendingEvents, user?.id]
  )

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
      <QuoteReplyProvider>
        <SharedMessagesProvider map={mergedSharedMessages}>
          <TextSelectionQuote streamId={streamId} />
          <div className="relative h-full">
            <div className="absolute inset-0 overflow-hidden">
              {batchMode && (
                <BatchSelectionBar
                  count={selectedMessageIds.size}
                  isValidating={isMoveValidating}
                  onCancel={cancelBatchMode}
                />
              )}
              {isSearchOpen && (
                <StreamSearchBar search={streamSearch} onClose={handleSearchClose} onNavigate={handleSearchNavigate} />
              )}
              {isDraft && (
                <div
                  className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
                  style={{ paddingBottom: "var(--composer-height, 0px)" }}
                >
                  {hasDraftPendingEvents ? (
                    <EventList
                      timelineItems={draftTimelineItems}
                      isLoading={false}
                      workspaceId={workspaceId}
                      streamId={streamId}
                      batch={batchState}
                    />
                  ) : (
                    <Empty className="h-full border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <MessageSquare />
                        </EmptyMedia>
                        <EmptyTitle>Start a conversation</EmptyTitle>
                        <EmptyDescription>Type a message below to begin this scratchpad.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </div>
              )}
              {!isDraft && useVirtualized && (
                <>
                  <VirtuosoMessageList
                    visibleItems={visibleItems}
                    isLoading={isLoading}
                    isConfirmedEmpty={isConfirmedEmpty}
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
                    batch={batchState}
                    batchPointerHandlers={batchPointerHandlers}
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
                      isFetchingNewer ? "opacity-100" : "opacity-0"
                    )}
                    style={{
                      // Sit above the Jump to latest button (when visible) which itself sits above the floating composer.
                      bottom:
                        isJumpMode || isScrolledFarFromBottom
                          ? "calc(var(--composer-height, 0px) + 3.5rem)"
                          : "calc(var(--composer-height, 0px) + 0.5rem)",
                    }}
                  >
                    Loading newer messages...
                  </div>
                </>
              )}
              {!isDraft && !useVirtualized && (
                <div
                  ref={plainScrollRef}
                  className={cn(
                    "h-full overflow-y-auto overflow-x-hidden overscroll-y-contain",
                    (isSearchOpen || batchMode) && "pt-11",
                    batchMode && "select-none"
                  )}
                  style={{ paddingBottom: "var(--composer-height, 0px)" }}
                  data-suppress-pull-refresh="true"
                  onScroll={plainHandleScroll}
                  {...batchPointerHandlers}
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
                    batch={batchState}
                  />
                  {isFetchingNewer && (
                    <div className="flex justify-center py-2">
                      <p className="text-sm text-muted-foreground">Loading newer messages...</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Jump to latest button — shown when scrolled far from bottom or in jump mode.
              Positioned above the floating composer pill. */}
            {(isJumpMode || isScrolledFarFromBottom) && (
              <div
                className="pointer-events-none absolute left-1/2 -translate-x-1/2 z-10"
                style={{ bottom: "calc(var(--composer-height, 0px) + 0.5rem)" }}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  className="pointer-events-auto shadow-lg gap-1.5"
                  onClick={handleJumpToLatest}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  Jump to latest
                </Button>
              </div>
            )}
            {dragGhost && (
              <div
                className="pointer-events-none fixed z-50 max-w-[280px] rounded-md border bg-popover/95 px-3 py-2 text-sm shadow-lg"
                style={{ left: dragGhost.x + 12, top: dragGhost.y + 12 }}
              >
                <div className="font-medium">{selectedMessageIds.size} selected</div>
                <div className="line-clamp-1 text-xs text-muted-foreground">
                  {Array.from(selectedMessageIds)
                    .map((messageId) => {
                      const content = messageEventMeta.get(messageId)?.content
                      return content ? stripMarkdownToInline(content) : null
                    })
                    .filter(Boolean)
                    .slice(0, 1)
                    .join("")}
                </div>
              </div>
            )}
            <AlertDialog
              open={moveDialogOpen}
              onOpenChange={(open) => {
                if (open) return
                // Block dismiss while we're still working — there's no abort
                // path for the in-flight validate/move request, so let it
                // complete. The dialog will swap to the confirm step (or close
                // on error toast) within ~1s in the worst case.
                if (isValidatingPhase || isMoveConfirming) return
                closePendingMove()
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Move messages?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {isValidatingPhase ? "Checking that this move is still valid…" : pendingMoveDescription}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {isValidatingPhase && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Validating" />
                  </div>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isValidatingPhase || isMoveConfirming}>Cancel</AlertDialogCancel>
                  <Button onClick={confirmPendingMove} disabled={!pendingMove || isMoveConfirming}>
                    {isMoveConfirming ? "Moving..." : "Move"}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {membershipResolved && !isMember && isPublicChannel && (
              <div className="absolute inset-x-0 z-10" style={{ bottom: "var(--composer-height, 0px)" }}>
                <JoinChannelBar
                  workspaceId={workspaceId}
                  streamId={streamId}
                  channelName={stream?.slug ?? stream?.displayName ?? ""}
                  onJoined={handleJoined}
                />
              </div>
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
        </SharedMessagesProvider>
      </QuoteReplyProvider>
    </EditLastMessageContext.Provider>
  )
}

/** Virtuoso-powered message list for streams, channels, and scratchpads */
function VirtuosoMessageList({
  visibleItems,
  isLoading,
  isConfirmedEmpty,
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
  batch,
  batchPointerHandlers,
}: {
  visibleItems: TimelineItem[]
  isLoading: boolean
  /** True only when we've fully resolved IDB and bootstrap and the stream is
   *  actually empty. During mid-switch transitions this is false, so we avoid
   *  flashing the "No messages yet" state before useLiveQuery catches up. */
  isConfirmedEmpty: boolean
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
  batch?: BatchTimelineState
  batchPointerHandlers?: React.HTMLAttributes<HTMLElement>
}) {
  const { phase } = useCoordinatedLoading()
  const socket = useSocket()
  const abortResearch = useAbortResearch(socket)

  const { sessionLiveCounts, sessionLiveSubsteps, sessionCanAbort } = useMemo(() => {
    const counts = new Map<string, { stepCount: number; messageCount: number }>()
    const substeps = new Map<string, string | null>()
    const canAbort = new Map<string, boolean>()
    if (agentActivity) {
      for (const activity of agentActivity.values()) {
        counts.set(activity.sessionId, {
          stepCount: activity.stepCount,
          messageCount: activity.messageCount,
        })
        substeps.set(activity.sessionId, activity.substep)
        canAbort.set(activity.sessionId, activity.currentStepType === AgentStepTypes.WORKSPACE_SEARCH)
      }
    }
    return { sessionLiveCounts: counts, sessionLiveSubsteps: substeps, sessionCanAbort: canAbort }
  }, [agentActivity])

  const handleAbortResearch = useCallback(
    (sessionId: string) => abortResearch({ sessionId, workspaceId }),
    [abortResearch, workspaceId]
  )

  // First-message lookup for the context-bag attachment badge anchor.
  // Computed once per timeline change; the Virtuoso path threads this through
  // `renderCtx` so the badge can light up on whichever message the
  // conversation opened with. Without this, virtualized scratchpad timelines
  // would never get `isFirstMessage=true` and the badge would silently drop.
  const firstMessageId = useMemo(() => findFirstMessageId(visibleItems), [visibleItems])

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
      firstMessageId,
      sessionLiveCounts,
      sessionLiveSubsteps,
      sessionCanAbort,
      onAbortResearch: handleAbortResearch,
      phase,
      batch,
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
      firstMessageId,
      sessionLiveCounts,
      sessionLiveSubsteps,
      sessionCanAbort,
      handleAbortResearch,
      phase,
      batch,
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

  // Key items by stable identity so React doesn't reuse component instances
  // across messages and leak per-message state (e.g. link previews).
  const computeItemKey = useCallback((_index: number, item: TimelineItem) => getTimelineItemKey(item), [])

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

  // Virtuoso's `startReached` / `endReached` observables throttle via
  // `zt(200)` and use `distinctUntilChanged` on the emitted index, which
  // means they can silently miss boundary crossings after a prepend
  // (firstItemIndex decrements, but the distinct tracker may still hold a
  // stale value if the user never scrolled away from the top between
  // prepends). Tracking the range ourselves via `rangeChanged` guarantees
  // the fetch triggers fire whenever the user is actually within a few
  // items of either edge. Gated on `hasSettledRef` so transient ranges
  // during the initial scroll-to-LAST don't kick off an unwanted fetch.
  const hasRangeSettledRef = useRef(false)
  useEffect(() => {
    hasRangeSettledRef.current = false
  }, [streamId])

  const wrappedHandleAtBottomChange = useCallback(
    (atBottom: boolean) => {
      if (visibleItems.length > 0) hasRangeSettledRef.current = true
      handleAtBottomChange(atBottom)
    },
    [handleAtBottomChange, visibleItems.length]
  )

  const wrappedHandleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      handleRangeChanged(range)
      if (!hasRangeSettledRef.current || visibleItems.length === 0) return
      const distFromStart = range.startIndex - firstItemIndex
      if (distFromStart <= 3) handleStartReached()
      const lastVirtualIndex = firstItemIndex + visibleItems.length - 1
      const distFromEnd = lastVirtualIndex - range.endIndex
      if (distFromEnd <= 3) handleEndReached()
    },
    [handleRangeChanged, firstItemIndex, visibleItems.length, handleStartReached, handleEndReached]
  )

  // Virtuoso positions items absolutely inside its scroller, so plain CSS
  // `padding-top` on the wrapper is silently ignored — the topmost item still
  // renders flush at scroller-top, where the floating BatchSelectionBar /
  // StreamSearchBar overlap it. The official escape hatch is the `Header`
  // component, which renders before the first item and is treated as
  // scrollable content. We swap it in only while one of the bars is open.
  // Must sit above the early returns below so the hook order stays stable.
  const reservedTopSpacer = isSearchOpen || batch?.enabled
  const components = useMemo(
    () => ({
      // When no bar is open, fall back to StreamHeaderSpacer so the head
      // row's hover toolbar (which floats above the message via
      // `bottom-[calc(100%-20px)]`) doesn't get clipped by the scroller's
      // top edge. Bar-open state uses the taller h-11 spacer.
      Header: reservedTopSpacer ? BarTopSpacer : StreamHeaderSpacer,
      Footer: ComposerFooterSpacer,
    }),
    [reservedTopSpacer]
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

  // Only render the empty state when we're *certain* the stream has no events.
  // Without this guard, the mid-switch gap where visibleItems is briefly [] (IDB
  // re-subscribing after a streamId change) flashes the empty state before the
  // real data arrives. When visibleItems is empty but !isConfirmedEmpty, we
  // fall through and render <Virtuoso data={[]} /> — a blank scroll area that
  // doesn't visually disrupt the transition.
  if (visibleItems.length === 0 && isConfirmedEmpty) {
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
      className={cn("h-full", batch?.enabled && "select-none")}
      data-suppress-pull-refresh="true"
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={initialTopMostItemIndex}
      data={visibleItems}
      defaultItemHeight={120}
      skipAnimationFrameInResizeObserver
      itemContent={itemContent}
      computeItemKey={computeItemKey}
      followOutput={followOutput}
      atBottomStateChange={wrappedHandleAtBottomChange}
      rangeChanged={wrappedHandleRangeChanged}
      startReached={handleStartReached}
      endReached={handleEndReached}
      atBottomThreshold={30}
      increaseViewportBy={{ top: 600, bottom: 600 }}
      components={components}
      {...batchPointerHandlers}
    />
  )
}

// Spacer reserving room for the floating composer pill, so the most recent
// message sits visually offset above the pill at rest and `atBottom` accounts
// for the composer's height (Virtuoso treats Footer as content).
const StreamHeaderSpacer = () => <div className="h-3 sm:h-6" aria-hidden />

const ComposerFooterSpacer = () => <div aria-hidden style={{ height: "var(--composer-height, 0px)" }} />

// 44px scrollable spacer used as Virtuoso's Header while the search or
// batch-selection bar is open. Both bars render `absolute top-0` outside the
// scroller; Header reserves matching room *inside* the scroller so the
// topmost item never sits permanently underneath either bar. h-11 keeps the
// numbers aligned with `StreamSearchBar` / `BatchSelectionBar`.
const BarTopSpacer = () => <div aria-hidden className="h-11" />

/**
 * Flush-top toolbar shown while batch-selection mode is active. Mirrors the
 * `StreamSearchBar` pattern (h-11 strip, border-b, blurred translucent
 * background) so the scroller's matching `pt-11` keeps every previously
 * visible message reachable — the topmost item slides under the bar instead
 * of disappearing.
 */
function BatchSelectionBar({
  count,
  isValidating,
  onCancel,
}: {
  count: number
  isValidating: boolean
  onCancel: () => void
}) {
  let hint: string
  if (isValidating) {
    hint = "Validating move…"
  } else if (count === 0) {
    hint = "Tap messages to select"
  } else {
    hint = "Drag onto a message above to move"
  }

  return (
    <div
      className={cn(
        "absolute top-0 left-0 right-0 z-20",
        "flex items-center gap-2 px-2 py-1.5 sm:px-4 sm:py-2",
        "bg-background/95 backdrop-blur-sm border-b shadow-sm"
      )}
      // Outer toolbar listens for nothing — its children handle their own
      // events. Setting select-none here prevents accidental text selection
      // when the user starts dragging from a message and crosses the bar.
      style={{ userSelect: "none" }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            "inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-full",
            "text-xs font-medium tabular-nums tracking-tight transition-colors",
            count > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}
          aria-live="polite"
        >
          {count}
        </span>
        <span className="hidden sm:inline text-sm font-medium">
          {count === 1 ? "message selected" : "messages selected"}
        </span>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {isValidating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : (
          <Move className="h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        <span className="truncate">{hint}</span>
      </div>

      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onCancel} aria-label="Cancel selection">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
