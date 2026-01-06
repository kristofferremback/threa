import { useQueries } from "@tanstack/react-query"
import { useStreamService } from "@/contexts"
import { db } from "@/db"
import { streamKeys } from "./use-streams"

function isDraftId(id: string): boolean {
  return id.startsWith("draft_")
}

/**
 * Fetches multiple stream bootstraps in parallel using React Query's useQueries.
 * Filters out draft IDs since they're local IndexedDB data.
 */
export function useCoordinatedStreamQueries(workspaceId: string, streamIds: string[]) {
  const streamService = useStreamService()

  // Filter out draft IDs - they don't need server fetches
  const serverStreamIds = streamIds.filter((id) => !isDraftId(id))

  const results = useQueries({
    queries: serverStreamIds.map((streamId) => ({
      queryKey: streamKeys.bootstrap(workspaceId, streamId),
      queryFn: async () => {
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
      },
      enabled: !!workspaceId,
      staleTime: 0,
    })),
  })

  const isLoading = results.some((r) => r.isLoading)
  const isError = results.some((r) => r.isError)
  const errors = results.filter((r) => r.error).map((r) => r.error)

  return {
    results,
    isLoading,
    isError,
    errors,
  }
}
