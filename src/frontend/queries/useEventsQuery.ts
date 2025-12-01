/**
 * Events Query Hook
 *
 * Fetches events for a stream with infinite scroll pagination.
 */

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { streamApi } from "../../shared/api"
import type { StreamEvent } from "../types"
import type { EventsResponse } from "../../shared/api/types"

// Query keys for events
export const eventKeys = {
  all: ["events"] as const,
  stream: (workspaceId: string, streamId: string) => [...eventKeys.all, workspaceId, streamId] as const,
}

const DEFAULT_PAGE_SIZE = 50

interface UseEventsQueryOptions {
  workspaceId: string
  streamId: string | undefined
  enabled?: boolean
  pageSize?: number
}

/**
 * Hook to fetch events for a stream with infinite scroll.
 *
 * Returns flattened list of events across all loaded pages.
 */
export function useEventsQuery({
  workspaceId,
  streamId,
  enabled = true,
  pageSize = DEFAULT_PAGE_SIZE,
}: UseEventsQueryOptions) {
  const queryClient = useQueryClient()

  const query = useInfiniteQuery({
    queryKey: eventKeys.stream(workspaceId, streamId || ""),
    queryFn: async ({ pageParam }): Promise<EventsResponse> => {
      if (!streamId) throw new Error("No stream ID")

      // For pending threads, return empty events
      if (streamId.startsWith("event_")) {
        return { events: [], hasMore: false }
      }

      return streamApi.getEvents(workspaceId, streamId, {
        cursor: pageParam,
        limit: pageSize,
      })
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled: enabled && Boolean(streamId),
    staleTime: 30 * 1000, // 30 seconds (events change more frequently)
    gcTime: 24 * 60 * 60 * 1000,
    networkMode: "offlineFirst",
    refetchOnReconnect: true,
  })

  // Flatten pages into single events array
  const events = query.data?.pages.flatMap((page) => page.events) || []

  // Get last read event ID from first page
  const lastReadEventId = query.data?.pages[0]?.lastReadEventId

  // Add a new event to the cache (from WebSocket)
  const addEvent = (event: StreamEvent) => {
    if (!streamId) return
    queryClient.setQueryData<typeof query.data>(eventKeys.stream(workspaceId, streamId), (old) => {
      if (!old) return old

      // Check if event already exists
      const allEvents = old.pages.flatMap((p) => p.events)
      if (allEvents.some((e) => e.id === event.id)) return old

      // Add to the last page
      const pages = old.pages.map((page, i) => {
        if (i === old.pages.length - 1) {
          return { ...page, events: [...page.events, event] }
        }
        return page
      })

      return { ...old, pages }
    })
  }

  // Update an existing event in the cache
  const updateEvent = (eventId: string, updates: Partial<StreamEvent>) => {
    if (!streamId) return
    queryClient.setQueryData<typeof query.data>(eventKeys.stream(workspaceId, streamId), (old) => {
      if (!old) return old

      const pages = old.pages.map((page) => ({
        ...page,
        events: page.events.map((e) => (e.id === eventId ? { ...e, ...updates } : e)),
      }))

      return { ...old, pages }
    })
  }

  // Remove an event from the cache
  const removeEvent = (eventId: string) => {
    if (!streamId) return
    queryClient.setQueryData<typeof query.data>(eventKeys.stream(workspaceId, streamId), (old) => {
      if (!old) return old

      const pages = old.pages.map((page) => ({
        ...page,
        events: page.events.filter((e) => e.id !== eventId),
      }))

      return { ...old, pages }
    })
  }

  // Update reply count for an event
  const updateReplyCount = (eventId: string, replyCount: number) => {
    updateEvent(eventId, { replyCount })
  }

  return {
    events,
    lastReadEventId,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    error: query.error ? query.error.message : null,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    // Cache mutations
    addEvent,
    updateEvent,
    removeEvent,
    updateReplyCount,
  }
}
