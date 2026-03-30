import { useCallback, useEffect, useMemo, useState } from "react"
import { useStreamBootstrap } from "./use-streams"
import { useStreamService } from "@/contexts"
import { useQueryClient, useInfiniteQuery } from "@tanstack/react-query"
import { db } from "@/db"
import { EVENT_PAGE_SIZE } from "@/lib/constants"
import { useStreamEvents } from "@/stores/stream-store"
import type { StreamEvent, EventsAroundResponse } from "@threa/types"

export const eventKeys = {
  all: ["events"] as const,
  list: (workspaceId: string, streamId: string) => [...eventKeys.all, "list", workspaceId, streamId] as const,
  newer: (workspaceId: string, streamId: string) => [...eventKeys.all, "newer", workspaceId, streamId] as const,
}

interface JumpState {
  events: StreamEvent[]
  hasOlder: boolean
  hasNewer: boolean
  /** Sequence of the oldest event in the jump window — cursor for backward pagination */
  oldestSequence: string
  /** Sequence of the newest event in the jump window — cursor for forward pagination */
  newestSequence: string
}

function sortBySequence(events: StreamEvent[]): StreamEvent[] {
  return [...events].sort((a, b) => {
    const seqA = BigInt(a.sequence)
    const seqB = BigInt(b.sequence)
    if (seqA < seqB) return -1
    if (seqA > seqB) return 1
    return 0
  })
}

function dedupeAndSort(eventArrays: StreamEvent[][]): StreamEvent[] {
  const eventMap = new Map<string, StreamEvent>()
  for (const arr of eventArrays) {
    for (const event of arr) {
      eventMap.set(event.id, event)
    }
  }
  return sortBySequence(Array.from(eventMap.values()))
}

async function cacheToIndexedDB(workspaceId: string, events: StreamEvent[]) {
  if (events.length === 0) return
  const now = Date.now()
  await db.events.bulkPut(events.map((e) => ({ ...e, workspaceId, _cachedAt: now })))
}

export function useEvents(workspaceId: string, streamId: string, options?: { enabled?: boolean; loadAll?: boolean }) {
  const shouldFetch = options?.enabled ?? true

  // Bootstrap query still drives the fetch lifecycle (loading/error states)
  // and triggers IDB writes via applyStreamBootstrap in its queryFn.
  const {
    isLoading: isBootstrapLoading,
    error,
    data: bootstrap,
  } = useStreamBootstrap(workspaceId, streamId, {
    enabled: shouldFetch,
  })
  const streamService = useStreamService()
  const queryClient = useQueryClient()

  // Primary data source: IndexedDB via useLiveQuery.
  // This returns ALL events for the stream cached in IDB — including events
  // from previous sessions, bootstrap data, and real-time socket updates.
  // Updates reactively whenever IDB is written to.
  const idbEvents = useStreamEvents(streamId)

  // Jump-to-message state: when set, replaces bootstrap as the anchor window
  const [jumpState, setJumpState] = useState<JumpState | null>(null)

  // Infinite query for older events (backward pagination).
  // enabled: false — never auto-fetches. Triggered exclusively via seed + fetchOlderPage().
  const {
    data: olderData,
    fetchNextPage: fetchOlderPage,
    hasNextPage: hasOlderPage,
    isFetchingNextPage: isFetchingOlder,
  } = useInfiniteQuery({
    queryKey: eventKeys.list(workspaceId, streamId),
    queryFn: async ({ pageParam }) => {
      if (!pageParam) {
        return { events: [] as StreamEvent[], hasMore: false, cursor: undefined }
      }
      const events = await streamService.getEvents(workspaceId, streamId, {
        before: pageParam,
        limit: EVENT_PAGE_SIZE,
      })
      // Write fetched events to IDB — they become available via useStreamEvents
      await cacheToIndexedDB(workspaceId, events)
      return { events, hasMore: events.length === EVENT_PAGE_SIZE, cursor: undefined }
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) return undefined
      if (lastPage.events.length === 0) return lastPage.cursor
      return lastPage.events[0].sequence
    },
    initialPageParam: undefined as string | undefined,
    enabled: false,
  })

  // Infinite query for newer events (forward pagination, only active in jump-to mode).
  const {
    data: newerData,
    fetchNextPage: fetchNewerPage,
    hasNextPage: hasNewerPage,
    isFetchingNextPage: isFetchingNewer,
  } = useInfiniteQuery({
    queryKey: eventKeys.newer(workspaceId, streamId),
    queryFn: async ({ pageParam }) => {
      if (!pageParam) {
        return { events: [] as StreamEvent[], hasMore: false, cursor: undefined }
      }
      const events = await streamService.getEvents(workspaceId, streamId, {
        after: pageParam,
        limit: EVENT_PAGE_SIZE,
      })
      await cacheToIndexedDB(workspaceId, events)
      return { events, hasMore: events.length === EVENT_PAGE_SIZE, cursor: undefined }
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) return undefined
      if (lastPage.events.length === 0) return lastPage.cursor
      return lastPage.events[lastPage.events.length - 1].sequence
    },
    initialPageParam: undefined as string | undefined,
    enabled: false,
  })

  // The bootstrap's oldest event sequence defines the lower bound of the
  // display window. Events older than this are from previous sessions and
  // should not be shown (they'd break unread divider positioning and cause
  // stale data to appear). Events at or newer than this bound include:
  // - All bootstrap events
  // - Socket events that arrived during or after bootstrap (INV-53 guarantee)
  // - Pending/failed optimistic events (regardless of sequence)
  const bootstrapFloor = useMemo(() => {
    if (!bootstrap?.events?.length) return null
    // Find the actual minimum sequence via BigInt comparison
    let min = BigInt(bootstrap.events[0].sequence)
    for (let i = 1; i < bootstrap.events.length; i++) {
      const seq = BigInt(bootstrap.events[i].sequence)
      if (seq < min) min = seq
    }
    return min
  }, [bootstrap?.events])

  // Combine all event sources.
  // In jump mode: use jump window + paginated older/newer events.
  // In normal mode: filter IDB events to bootstrap window + newer.
  const events = useMemo(() => {
    if (jumpState) {
      const olderEvents = olderData?.pages.flatMap((page) => page.events).filter(Boolean) ?? []
      const newerEvents = newerData?.pages.flatMap((page) => page.events).filter(Boolean) ?? []
      return dedupeAndSort([jumpState.events, olderEvents, newerEvents])
    }

    // Before bootstrap loads, IDB events are unfiltered (stale from previous
    // sessions). isLoading is true so components show skeletons, not events.
    // After bootstrap loads, filter to the bootstrap window + newer.
    if (bootstrapFloor !== null) {
      const filtered = idbEvents.filter((e) => {
        // Keep pending/failed optimistic events regardless of sequence
        if (e._status === "pending" || e._status === "failed") return true
        // Keep events within or newer than the bootstrap window
        return BigInt(e.sequence) >= bootstrapFloor
      })
      return filtered as unknown as StreamEvent[]
    }

    return idbEvents as unknown as StreamEvent[]
  }, [idbEvents, olderData, newerData, jumpState, bootstrapFloor])

  // Show loading until bootstrap completes AND useLiveQuery has resolved
  // the IDB events. Without the idbEvents check, components see empty data
  // for one render cycle after bootstrap completes (useLiveQuery is async).
  const bootstrapHasEvents = (bootstrap?.events?.length ?? 0) > 0
  const idbResolved = !bootstrapHasEvents || idbEvents.length > 0
  const isLoading = isBootstrapLoading || !idbResolved

  // Determine if older events exist.
  const hasOlderEvents = useMemo(() => {
    if (hasOlderPage) return true
    const hasRunQuery = (olderData?.pages.length ?? 0) > 0
    if (hasRunQuery) return false
    if (jumpState) return jumpState.hasOlder
    return bootstrap?.hasOlderEvents ?? false
  }, [hasOlderPage, jumpState, olderData?.pages.length, bootstrap?.hasOlderEvents])

  // Determine if newer events exist (only in jump mode).
  const hasNewerEvents = useMemo(() => {
    if (!jumpState) return false
    if (hasNewerPage) return true
    const hasRunQuery = (newerData?.pages.length ?? 0) > 0
    if (hasRunQuery) return false
    return jumpState.hasNewer
  }, [jumpState, hasNewerPage, newerData?.pages.length])

  const fetchOlderEvents = useCallback(() => {
    if (isFetchingOlder) return

    if (hasOlderPage) {
      fetchOlderPage()
      return
    }

    // Seed with a cursor-only page, then fetch immediately.
    const anchorEvents = jumpState ? jumpState.events : idbEvents
    if (anchorEvents.length === 0) return
    const oldestSequence = anchorEvents[0].sequence
    queryClient.setQueryData(eventKeys.list(workspaceId, streamId), {
      pages: [{ events: [], hasMore: true, cursor: oldestSequence }],
      pageParams: [undefined],
    })
    fetchOlderPage()
  }, [isFetchingOlder, hasOlderPage, jumpState, idbEvents, queryClient, workspaceId, streamId, fetchOlderPage])

  // Auto-load all older events on mount when loadAll is true (e.g. thread panels)
  const loadAll = options?.loadAll ?? false
  useEffect(() => {
    if (!loadAll || !hasOlderEvents || isFetchingOlder) return
    fetchOlderEvents()
  }, [loadAll, hasOlderEvents, isFetchingOlder, fetchOlderEvents])

  const fetchNewerEvents = useCallback(() => {
    if (!jumpState || isFetchingNewer) return

    if (hasNewerPage) {
      fetchNewerPage()
      return
    }

    queryClient.setQueryData(eventKeys.newer(workspaceId, streamId), {
      pages: [{ events: [], hasMore: true, cursor: jumpState.newestSequence }],
      pageParams: [undefined],
    })
    fetchNewerPage()
  }, [jumpState, isFetchingNewer, hasNewerPage, queryClient, workspaceId, streamId, fetchNewerPage])

  /**
   * Jump to a specific event (e.g. from search or push notification deep link).
   * Loads events around it and switches to bidirectional pagination mode.
   */
  const jumpToEvent = useCallback(
    async (targetMessageId: string): Promise<boolean> => {
      const result: EventsAroundResponse = await streamService.getEventsAround(
        workspaceId,
        streamId,
        targetMessageId,
        EVENT_PAGE_SIZE
      )
      if (result.events.length === 0) return false

      // Write to IDB so they persist across sessions
      await cacheToIndexedDB(workspaceId, result.events)

      const sorted = sortBySequence([...result.events])
      setJumpState({
        events: sorted,
        hasOlder: result.hasOlder,
        hasNewer: result.hasNewer,
        oldestSequence: sorted[0].sequence,
        newestSequence: sorted[sorted.length - 1].sequence,
      })

      // Reset pagination caches for this stream
      queryClient.removeQueries({ queryKey: eventKeys.list(workspaceId, streamId) })
      queryClient.removeQueries({ queryKey: eventKeys.newer(workspaceId, streamId) })

      return true
    },
    [streamService, workspaceId, streamId, queryClient]
  )

  /** Exit jump mode and return to live tail (latest messages from IDB). */
  const exitJumpMode = useCallback(() => {
    setJumpState(null)
    queryClient.removeQueries({ queryKey: eventKeys.list(workspaceId, streamId) })
    queryClient.removeQueries({ queryKey: eventKeys.newer(workspaceId, streamId) })
  }, [queryClient, workspaceId, streamId])

  // addEvent and updateEvent now write directly to IDB.
  // useLiveQuery picks up changes automatically — no TanStack cache needed.
  const addEvent = useCallback(
    async (event: StreamEvent) => {
      await db.events.put({ ...event, workspaceId, _cachedAt: Date.now() })
    },
    [workspaceId]
  )

  const updateEvent = useCallback(async (eventId: string, updates: Partial<StreamEvent>) => {
    await db.events.update(eventId, { ...updates, _cachedAt: Date.now() })
  }, [])

  // Latest sequence from IDB events
  const latestSequence = useMemo(() => {
    if (idbEvents.length === 0) return bootstrap?.latestSequence ?? "0"
    return idbEvents[idbEvents.length - 1].sequence
  }, [idbEvents, bootstrap?.latestSequence])

  return {
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
    isJumpMode: !!jumpState,
    addEvent,
    updateEvent,
    latestSequence,
  }
}
