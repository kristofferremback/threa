import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useStreamBootstrap } from "./use-streams"
import { useStreamService } from "@/contexts"
import { useQueryClient, useInfiniteQuery } from "@tanstack/react-query"
import { db, sequenceToNum } from "@/db"
import { EVENT_PAGE_SIZE } from "@/lib/constants"
import { useStreamEvents } from "@/stores/stream-store"
import { shouldSuppressBootstrapError } from "@/lib/query-load-state"
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

type SequencedEvent = Pick<StreamEvent, "sequence">
type DisplayableEvent = SequencedEvent & { _status?: string | null }

export function getMinimumSequence(events: Array<Pick<StreamEvent, "sequence">> | null | undefined): bigint | null {
  if (!events || events.length === 0) return null

  let min = BigInt(events[0].sequence)
  for (let i = 1; i < events.length; i++) {
    const seq = BigInt(events[i].sequence)
    if (seq < min) min = seq
  }
  return min
}

export function getDisplayFloor(bootstrapFloor: bigint | null, olderFloor: bigint | null): bigint | null {
  if (bootstrapFloor === null) return olderFloor
  if (olderFloor === null) return bootstrapFloor
  return olderFloor < bootstrapFloor ? olderFloor : bootstrapFloor
}

export function getCachedWindowFloor<T extends DisplayableEvent>(events: T[], pageSize: number): bigint | null {
  const persistedEvents = events.filter((event) => event._status !== "pending" && event._status !== "failed")
  if (persistedEvents.length <= pageSize) return null

  const firstVisibleEvent = persistedEvents[persistedEvents.length - pageSize]
  return BigInt(firstVisibleEvent.sequence)
}

export function filterEventsForDisplay<T extends DisplayableEvent>(events: T[], displayFloor: bigint | null): T[] {
  if (displayFloor === null) return events

  return events.filter((event) => {
    if (event._status === "pending" || event._status === "failed") return true
    return BigInt(event.sequence) >= displayFloor
  })
}

export function getOldestSequence(events: SequencedEvent[] | null | undefined): string | null {
  if (!events || events.length === 0) return null

  let oldest = events[0]
  let oldestValue = BigInt(oldest.sequence)
  for (let i = 1; i < events.length; i++) {
    const value = BigInt(events[i].sequence)
    if (value < oldestValue) {
      oldest = events[i]
      oldestValue = value
    }
  }

  return oldest.sequence
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
  await db.events.bulkPut(
    events.map((e) => ({ ...e, workspaceId, _sequenceNum: sequenceToNum(e.sequence), _cachedAt: now }))
  )
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
  const lastSuppressedErrorKeyRef = useRef<string | null>(null)

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
  //
  // The floor must never jump upward on re-fetches (e.g. after socket reconnect).
  // A higher floor would hide events already visible in IDB from the current
  // session — the events are valid, just below the latest bootstrap page.
  const bootstrapFloorRef = useRef<{ streamId: string; floor: bigint } | null>(null)
  const bootstrapFloor = useMemo(() => {
    const newFloor = getMinimumSequence(bootstrap?.events)
    // Reset when switching streams (component stays mounted across routes)
    if (bootstrapFloorRef.current && bootstrapFloorRef.current.streamId !== streamId) {
      bootstrapFloorRef.current = null
    }
    if (newFloor === null) return bootstrapFloorRef.current?.floor ?? null
    if (bootstrapFloorRef.current !== null && bootstrapFloorRef.current.floor < newFloor) {
      return bootstrapFloorRef.current.floor
    }
    bootstrapFloorRef.current = { streamId, floor: newFloor }
    return newFloor
  }, [bootstrap?.events, streamId])

  const olderFloor = useMemo(() => {
    const olderEvents = olderData?.pages.flatMap((page) => page.events).filter(Boolean) ?? []
    return getMinimumSequence(olderEvents)
  }, [olderData])

  const idbResolved = idbEvents !== undefined
  const hasIdbEvents = idbResolved && idbEvents.length > 0
  const suppressBootstrapError = shouldSuppressBootstrapError(error, hasIdbEvents)

  // IDB is the primary read model. While useLiveQuery resolves (typically <10ms),
  // fall back to bootstrap events if available. Once IDB resolves, use it exclusively.
  const bootstrapEvents: DisplayableEvent[] = bootstrap?.events ?? []
  const effectiveEvents: DisplayableEvent[] = idbResolved ? idbEvents : bootstrapEvents
  const hasAnyEvents = effectiveEvents.length > 0

  const cachedWindowFloor = useMemo(() => getCachedWindowFloor(effectiveEvents, EVENT_PAGE_SIZE), [effectiveEvents])
  const displayFloor = useMemo(() => {
    const serverFloor = getDisplayFloor(bootstrapFloor, olderFloor)
    if (serverFloor !== null) return serverFloor
    if (suppressBootstrapError) return null
    return cachedWindowFloor
  }, [bootstrapFloor, olderFloor, suppressBootstrapError, cachedWindowFloor])

  // Combine all event sources.
  // In jump mode: use jump window + paginated older/newer events.
  // In normal mode: filter IDB/bootstrap events to display window.
  const events = useMemo(() => {
    if (jumpState) {
      const olderEvents = olderData?.pages.flatMap((page) => page.events).filter(Boolean) ?? []
      const newerEvents = newerData?.pages.flatMap((page) => page.events).filter(Boolean) ?? []
      return dedupeAndSort([jumpState.events, olderEvents, newerEvents])
    }

    // Before bootstrap resolves, show only a bootstrap-sized cached window so
    // users cannot scroll into extra cached history that later disappears when
    // the bootstrap floor arrives. If bootstrap fails and we fall back to the
    // local cache, widen back out to the full cached timeline.
    return filterEventsForDisplay(effectiveEvents, displayFloor) as unknown as StreamEvent[]
  }, [effectiveEvents, olderData, newerData, jumpState, displayFloor])

  // IDB-first: if IDB or bootstrap has events, we're not loading — show them
  // immediately. Only show loading when neither source has events and bootstrap
  // is still fetching (first visit to a stream with no cached data).
  const isLoading = !hasAnyEvents && isBootstrapLoading

  useEffect(() => {
    if (!import.meta.env.DEV || !suppressBootstrapError || !error) return
    const key = `${streamId}:${error.message}`
    if (lastSuppressedErrorKeyRef.current === key) return
    lastSuppressedErrorKeyRef.current = key
    console.warn(`[useEvents] Suppressing bootstrap error for ${streamId} because local timeline data exists`, error)
  }, [suppressBootstrapError, error, streamId])

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
    if (isFetchingOlder) return false

    if (hasOlderPage) {
      void fetchOlderPage()
      return true
    }

    // Seed with a cursor-only page, then fetch immediately.
    const oldestSequence = getOldestSequence(jumpState ? jumpState.events : events)
    if (!oldestSequence) return false
    queryClient.setQueryData(eventKeys.list(workspaceId, streamId), {
      pages: [{ events: [], hasMore: true, cursor: oldestSequence }],
      pageParams: [undefined],
    })
    void fetchOlderPage()
    return true
  }, [isFetchingOlder, hasOlderPage, jumpState, events, queryClient, workspaceId, streamId, fetchOlderPage])

  // Auto-load all older events on mount when loadAll is true (e.g. thread panels)
  const loadAll = options?.loadAll ?? false
  useEffect(() => {
    if (!loadAll || !hasOlderEvents || isFetchingOlder) return
    fetchOlderEvents()
  }, [loadAll, hasOlderEvents, isFetchingOlder, fetchOlderEvents])

  const fetchNewerEvents = useCallback(() => {
    if (!jumpState || isFetchingNewer) return false

    if (hasNewerPage) {
      void fetchNewerPage()
      return true
    }

    queryClient.setQueryData(eventKeys.newer(workspaceId, streamId), {
      pages: [{ events: [], hasMore: true, cursor: jumpState.newestSequence }],
      pageParams: [undefined],
    })
    void fetchNewerPage()
    return true
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
      await db.events.put({ ...event, workspaceId, _sequenceNum: sequenceToNum(event.sequence), _cachedAt: Date.now() })
    },
    [workspaceId]
  )

  const updateEvent = useCallback(async (eventId: string, updates: Partial<StreamEvent>) => {
    await db.events.update(eventId, { ...updates, _cachedAt: Date.now() })
  }, [])

  // Latest sequence from IDB events
  const latestSequence = useMemo(() => {
    if (!idbEvents || idbEvents.length === 0) return bootstrap?.latestSequence ?? "0"
    return idbEvents[idbEvents.length - 1].sequence
  }, [idbEvents, bootstrap?.latestSequence])

  return {
    events,
    isLoading,
    error: suppressBootstrapError ? null : error,
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
