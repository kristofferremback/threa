import { useCallback, useEffect, useMemo, useState } from "react"
import { useStreamBootstrap, streamKeys } from "./use-streams"
import { useStreamService } from "@/contexts"
import { useQueryClient, useInfiniteQuery } from "@tanstack/react-query"
import { db } from "@/db"
import { EVENT_PAGE_SIZE } from "@/lib/constants"
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

async function cacheToIndexedDB(events: StreamEvent[]) {
  if (events.length === 0) return
  const now = Date.now()
  await db.events.bulkPut(events.map((e) => ({ ...e, _cachedAt: now })))
}

export function useEvents(workspaceId: string, streamId: string, options?: { enabled?: boolean; loadAll?: boolean }) {
  const shouldFetch = options?.enabled ?? true
  const {
    data: bootstrap,
    isLoading,
    error,
  } = useStreamBootstrap(workspaceId, streamId, {
    enabled: shouldFetch,
  })
  const streamService = useStreamService()
  const queryClient = useQueryClient()

  // Jump-to-message state: when set, replaces bootstrap as the anchor window
  const [jumpState, setJumpState] = useState<JumpState | null>(null)

  // Infinite query for older events (backward pagination).
  // enabled: false — never auto-fetches. Triggered exclusively via seed + fetchOlderPage().
  // This prevents an initial dummy page from poisoning the hasRunQuery check.
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
      await cacheToIndexedDB(events)
      return { events, hasMore: events.length === EVENT_PAGE_SIZE, cursor: undefined }
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) return undefined
      // Seed pages carry a cursor but no events
      if (lastPage.events.length === 0) return lastPage.cursor
      return lastPage.events[0].sequence
    },
    initialPageParam: undefined as string | undefined,
    enabled: false,
  })

  // Infinite query for newer events (forward pagination, only active in jump-to mode).
  // Also enabled: false — triggered via seed + fetchNewerPage().
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
      await cacheToIndexedDB(events)
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

  // Combine all event sources
  const events = useMemo(() => {
    const olderEvents = olderData?.pages.flatMap((page) => page.events).filter(Boolean) ?? []
    const newerEvents = newerData?.pages.flatMap((page) => page.events).filter(Boolean) ?? []

    if (jumpState) {
      return dedupeAndSort([jumpState.events, olderEvents, newerEvents])
    }

    const bootstrapEvents = bootstrap?.events ?? []
    return dedupeAndSort([bootstrapEvents, olderEvents])
  }, [bootstrap?.events, olderData, newerData, jumpState])

  // Determine if older events exist.
  // Once the infinite query has produced at least one page, trust hasOlderPage
  // exclusively — the bootstrap hint is stale after the first fetch.
  const hasOlderEvents = useMemo(() => {
    if (hasOlderPage) return true
    // Once a query has run and exhausted all pages, trust that over bootstrap/jump hints.
    // hasOlderPage is checked first, so the seed-page case (pages.length = 1, hasOlderPage = true)
    // is already handled above.
    const hasRunQuery = (olderData?.pages.length ?? 0) > 0
    if (hasRunQuery) return false
    if (jumpState) return jumpState.hasOlder
    return bootstrap?.hasOlderEvents ?? false
  }, [hasOlderPage, jumpState, olderData?.pages.length, bootstrap?.hasOlderEvents])

  // Determine if newer events exist (only in jump mode).
  // Once the newer query has produced at least one page, trust hasNewerPage
  // exclusively — the jump state hint is stale after the first fetch.
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
    // This branch is only reachable when no pages exist yet (!hasOlderPage),
    // so we never discard previously-fetched multi-page history.
    // setQueryData updates TanStack Query's internal cache synchronously,
    // so fetchOlderPage picks up the cursor without needing a second trigger.
    const anchorEvents = jumpState ? jumpState.events : (bootstrap?.events ?? [])
    if (anchorEvents.length === 0) return
    queryClient.setQueryData(eventKeys.list(workspaceId, streamId), {
      pages: [{ events: [], hasMore: true, cursor: anchorEvents[0].sequence }],
      pageParams: [undefined],
    })
    fetchOlderPage()
  }, [isFetchingOlder, hasOlderPage, jumpState, bootstrap?.events, queryClient, workspaceId, streamId, fetchOlderPage])

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
   * Jump to a specific event (e.g. from search). Loads events around it
   * and switches to bidirectional pagination mode.
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

      await cacheToIndexedDB(result.events)

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

  /** Exit jump mode and return to live tail (latest messages from bootstrap). */
  const exitJumpMode = useCallback(() => {
    setJumpState(null)
    queryClient.removeQueries({ queryKey: eventKeys.list(workspaceId, streamId) })
    queryClient.removeQueries({ queryKey: eventKeys.newer(workspaceId, streamId) })
  }, [queryClient, workspaceId, streamId])

  // Handler to add a new event (from WebSocket or optimistic update).
  // Note: useStreamSocket writes directly to bootstrap cache for real-time events.
  // These callbacks exist for programmatic use (e.g. optimistic updates).
  const addEvent = useCallback(
    async (event: StreamEvent) => {
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: typeof bootstrap) => {
        if (!old) return old
        return {
          ...old,
          events: [...old.events, event],
          latestSequence: event.sequence,
        }
      })
      await db.events.put({ ...event, _cachedAt: Date.now() })
    },
    [queryClient, workspaceId, streamId]
  )

  // Handler to update an existing event (edit/delete)
  const updateEvent = useCallback(
    async (eventId: string, updates: Partial<StreamEvent>) => {
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, streamId), (old: typeof bootstrap) => {
        if (!old) return old
        return { ...old, events: old.events.map((e) => (e.id === eventId ? { ...e, ...updates } : e)) }
      })
      await db.events.update(eventId, updates)
    },
    [queryClient, workspaceId, streamId]
  )

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
    latestSequence: bootstrap?.latestSequence ?? "0",
  }
}
