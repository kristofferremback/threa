import { useMemo } from "react"
import { useQueries, useQueryClient } from "@tanstack/react-query"
import { useStreamService, type StreamService } from "@/contexts"
import { db } from "@/db"
import { streamKeys } from "./use-streams"

function isDraftId(id: string): boolean {
  return id.startsWith("draft_")
}

// Create a stable query function factory
function createBootstrapQueryFn(streamService: StreamService, workspaceId: string, streamId: string) {
  return async () => {
    const bootstrap = await streamService.bootstrap(workspaceId, streamId)
    const now = Date.now()

    // Cache stream and events to IndexedDB (same as useStreamBootstrap)
    await Promise.all([
      db.streams.put({
        ...bootstrap.stream,
        pinned: bootstrap.membership?.pinned,
        muted: bootstrap.membership?.muted,
        lastReadEventId: bootstrap.membership?.lastReadEventId,
        _cachedAt: now,
      }),
      db.events.bulkPut(bootstrap.events.map((e) => ({ ...e, _cachedAt: now }))),
    ])

    return bootstrap
  }
}

/**
 * Fetches multiple stream bootstraps in parallel using React Query's useQueries.
 * Filters out draft IDs since they're local IndexedDB data.
 */
export function useCoordinatedStreamQueries(workspaceId: string, streamIds: string[]) {
  const streamService = useStreamService()
  const queryClient = useQueryClient()

  // Filter out draft IDs - they don't need server fetches
  const serverStreamIds = useMemo(() => streamIds.filter((id) => !isDraftId(id)), [streamIds])

  // Check which queries have already errored - don't re-enable them
  const erroredStreamIds = useMemo(() => {
    const errored = new Set<string>()
    for (const streamId of serverStreamIds) {
      const state = queryClient.getQueryState(streamKeys.bootstrap(workspaceId, streamId))
      if (state?.status === "error") {
        errored.add(streamId)
      }
    }
    return errored
  }, [serverStreamIds, workspaceId, queryClient])

  // Memoize the queries array to prevent unnecessary re-renders
  const queries = useMemo(
    () =>
      serverStreamIds.map((streamId) => ({
        queryKey: streamKeys.bootstrap(workspaceId, streamId),
        queryFn: createBootstrapQueryFn(streamService, workspaceId, streamId),
        // Don't enable queries that have already errored to prevent continuous refetch loops
        enabled: !!workspaceId && !erroredStreamIds.has(streamId),
        staleTime: Infinity, // Never consider data stale
        gcTime: Infinity, // Never garbage collect
        // Prevent ALL automatic refetching
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // Prevent structural sharing issues that might cause re-renders
        structuralSharing: false,
      })),
    [serverStreamIds, workspaceId, streamService, erroredStreamIds]
  )

  const results = useQueries({ queries })

  // A query is considered "loading" only if it's fetching AND hasn't errored.
  // Errored queries should not block the UI - let components handle the error.
  const isLoading = results.some((r) => r.isLoading && !r.isError)
  const isError = results.some((r) => r.isError)
  const errors = results.filter((r) => r.error).map((r) => r.error)

  return {
    results,
    isLoading,
    isError,
    errors,
  }
}
