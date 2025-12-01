/**
 * Stream Query Hook
 *
 * Fetches individual stream data with parent/root info for threads.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { streamApi } from "../../shared/api"
import type { Stream, StreamEvent } from "../types"

// Query keys for stream data
export const streamKeys = {
  all: ["streams"] as const,
  stream: (workspaceId: string, streamId: string) => [...streamKeys.all, workspaceId, streamId] as const,
}

interface UseStreamQueryOptions {
  workspaceId: string
  streamId: string | undefined
  enabled?: boolean
}

interface StreamData {
  stream: Stream
  parentStream?: Stream
  rootEvent?: StreamEvent
  ancestors?: StreamEvent[]
}

/**
 * Hook to fetch a single stream's data.
 *
 * For threads, also returns parent stream, root event, and ancestor chain.
 */
export function useStreamQuery({ workspaceId, streamId, enabled = true }: UseStreamQueryOptions) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: streamKeys.stream(workspaceId, streamId || ""),
    queryFn: async (): Promise<StreamData> => {
      if (!streamId) throw new Error("No stream ID")

      // Handle pending threads (event_* IDs that don't have a stream yet)
      if (streamId.startsWith("event_")) {
        // Strip the event_ prefix to get the actual event ID
        const eventId = streamId.replace(/^event_/, "")
        let rootEvent: StreamEvent | undefined
        let parentStream: Stream | undefined

        try {
          const eventData = await streamApi.getEvent(workspaceId, eventId)
          rootEvent = eventData.event
          parentStream = eventData.stream
        } catch (err) {
          // If we can't fetch the event, continue with placeholder data
          console.warn("Could not fetch root event for pending thread:", err)
        }

        return {
          stream: {
            id: streamId,
            workspaceId,
            streamType: "thread",
            name: null,
            slug: null,
            description: null,
            topic: null,
            parentStreamId: rootEvent?.streamId || null,
            branchedFromEventId: eventId,
            visibility: "inherit",
            status: "active",
            isMember: true,
            unreadCount: 0,
            lastReadAt: null,
            notifyLevel: "default",
            pinnedAt: null,
          } as Stream,
          parentStream,
          rootEvent,
          ancestors: rootEvent ? [rootEvent] : [],
        }
      }

      const response = await streamApi.getStream(workspaceId, streamId)
      return response
    },
    enabled: enabled && Boolean(streamId),
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    networkMode: "offlineFirst",
    refetchOnReconnect: true,
  })

  // Update stream in cache
  const updateStream = (updates: Partial<Stream>) => {
    if (!streamId) return
    queryClient.setQueryData<StreamData>(streamKeys.stream(workspaceId, streamId), (old) => {
      if (!old) return old
      return { ...old, stream: { ...old.stream, ...updates } }
    })
  }

  return {
    data: query.data,
    stream: query.data?.stream,
    parentStream: query.data?.parentStream,
    rootEvent: query.data?.rootEvent,
    ancestors: query.data?.ancestors || [],
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
    refetch: query.refetch,
    updateStream,
  }
}
