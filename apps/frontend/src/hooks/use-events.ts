import { useCallback, useMemo } from "react"
import { useStreamBootstrap, streamKeys } from "./use-streams"
import { useStreamService } from "@/contexts"
import { useQueryClient, useInfiniteQuery } from "@tanstack/react-query"
import { db } from "@/db"
import type { StreamEvent } from "@/types/domain"

export const eventKeys = {
  all: ["events"] as const,
  list: (workspaceId: string, streamId: string) =>
    [...eventKeys.all, "list", workspaceId, streamId] as const,
}

export function useEvents(workspaceId: string, streamId: string, options?: { enabled?: boolean }) {
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

  // Use infinite query for pagination of older events
  const {
    data: paginatedData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: eventKeys.list(workspaceId, streamId),
    queryFn: async ({ pageParam }) => {
      if (!pageParam) {
        // First page comes from bootstrap
        return { events: [], hasMore: false }
      }
      // Fetch older events
      const events = await streamService.getEvents(workspaceId, streamId, {
        before: pageParam,
        limit: 50,
      })
      // Cache to IndexedDB
      const now = Date.now()
      await db.events.bulkPut(events.map((e) => ({ ...e, _cachedAt: now })))
      return { events, hasMore: events.length === 50 }
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.events.length === 0) return undefined
      return lastPage.events[0].sequence
    },
    initialPageParam: undefined as string | undefined,
    enabled: shouldFetch && !!workspaceId && !!streamId && !!bootstrap,
  })

  // Combine bootstrap events with paginated older events
  const events = useMemo(() => {
    const bootstrapEvents = bootstrap?.events ?? []
    const olderEvents = paginatedData?.pages.flatMap((page) => page.events).filter((e) => e) ?? []

    // Merge and dedupe by ID, sorted by sequence ascending
    const eventMap = new Map<string, StreamEvent>()
    for (const event of [...olderEvents, ...bootstrapEvents]) {
      eventMap.set(event.id, event)
    }

    return Array.from(eventMap.values()).sort((a, b) => {
      const seqA = BigInt(a.sequence)
      const seqB = BigInt(b.sequence)
      if (seqA < seqB) return -1
      if (seqA > seqB) return 1
      return 0
    })
  }, [bootstrap?.events, paginatedData])

  // Handler to add a new event (from WebSocket or optimistic update)
  const addEvent = useCallback(
    async (event: StreamEvent) => {
      // Update cache
      queryClient.setQueryData(
        streamKeys.bootstrap(workspaceId, streamId),
        (old: typeof bootstrap) => {
          if (!old) return old
          return {
            ...old,
            events: [...old.events, event],
            latestSequence: event.sequence,
          }
        }
      )
      // Also cache to IndexedDB
      await db.events.put({ ...event, _cachedAt: Date.now() })
    },
    [queryClient, workspaceId, streamId]
  )

  // Handler to update an existing event (edit/delete)
  const updateEvent = useCallback(
    async (eventId: string, updates: Partial<StreamEvent>) => {
      queryClient.setQueryData(
        streamKeys.bootstrap(workspaceId, streamId),
        (old: typeof bootstrap) => {
          if (!old) return old
          return {
            ...old,
            events: old.events.map((e) => (e.id === eventId ? { ...e, ...updates } : e)),
          }
        }
      )
      // Update IndexedDB
      await db.events.update(eventId, updates)
    },
    [queryClient, workspaceId, streamId]
  )

  return {
    events,
    isLoading,
    error,
    fetchOlderEvents: fetchNextPage,
    hasOlderEvents: hasNextPage ?? false,
    isFetchingOlder: isFetchingNextPage,
    addEvent,
    updateEvent,
    latestSequence: bootstrap?.latestSequence ?? "0",
  }
}
