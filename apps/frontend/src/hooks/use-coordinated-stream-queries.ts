import { useMemo } from "react"
import { useQueries, useQueryClient } from "@tanstack/react-query"
import { useSocket, useStreamService, type StreamService } from "@/contexts"
import { ApiError } from "@/api/client"
import { debugBootstrap } from "@/lib/bootstrap-debug"
import { db } from "@/db"
import { joinRoomWithAck } from "@/lib/socket-room"
import { streamKeys } from "./use-streams"
import type { Socket } from "socket.io-client"

function isDraftId(id: string): boolean {
  // Draft scratchpads use "draft_xxx" format, draft thread panels use "draft:xxx:xxx" format
  return id.startsWith("draft_") || id.startsWith("draft:")
}

function isTerminalBootstrapError(error: unknown): boolean {
  return ApiError.isApiError(error) && (error.status === 403 || error.status === 404)
}

async function queryFnWithoutSocket() {
  throw new Error("Socket not available for stream subscription")
}

// Create a stable query function factory
function createBootstrapQueryFn(streamService: StreamService, socket: Socket, workspaceId: string, streamId: string) {
  return async () => {
    debugBootstrap("Coordinated stream bootstrap queryFn start", { workspaceId, streamId })
    try {
      await joinRoomWithAck(socket, `ws:${workspaceId}:stream:${streamId}`)
    } catch (error) {
      console.error(
        `[CoordinatedStreamBootstrap] Failed to receive join ack for ws:${workspaceId}:stream:${streamId}; continuing with bootstrap fetch`,
        error
      )
    }

    const bootstrap = await streamService.bootstrap(workspaceId, streamId)
    debugBootstrap("Coordinated stream bootstrap fetch success", {
      workspaceId,
      streamId,
      eventCount: bootstrap.events.length,
    })
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
  const socket = useSocket()
  const streamService = useStreamService()
  const queryClient = useQueryClient()

  // Filter out draft IDs - they don't need server fetches
  const serverStreamIds = useMemo(() => streamIds.filter((id) => !isDraftId(id)), [streamIds])

  // Check which queries have already errored - don't re-enable them.
  // Note: queryClient is stable (never changes reference), so this memo only re-runs
  // when serverStreamIds or workspaceId change. This is intentional - we want to check
  // cached query state when the stream list changes, but not re-check on every render.
  // Queries that error after mount will still be caught because useQueries tracks them.
  const erroredStreamIds = useMemo(() => {
    const errored = new Set<string>()
    for (const streamId of serverStreamIds) {
      const state = queryClient.getQueryState(streamKeys.bootstrap(workspaceId, streamId))
      if (state?.status === "error" && isTerminalBootstrapError(state.error)) {
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
        queryFn: socket ? createBootstrapQueryFn(streamService, socket, workspaceId, streamId) : queryFnWithoutSocket,
        // Don't enable queries that have already errored to prevent continuous refetch loops
        enabled: !!workspaceId && !!socket && !erroredStreamIds.has(streamId),
        staleTime: Infinity, // Never consider data stale
        gcTime: Infinity, // Never garbage collect
        // Prevent ALL automatic refetching
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // Disable structural sharing to avoid issues with the dynamic queries array.
        // Since we create new query objects when the stream list changes, structural
        // sharing can cause stale references. Worth the extra re-renders for correctness.
        structuralSharing: false,
      })),
    [serverStreamIds, workspaceId, streamService, socket, erroredStreamIds]
  )

  const results = useQueries({ queries })

  // A query is considered "loading" only if it's fetching AND hasn't errored.
  // Errored queries should not block the UI - let components handle the error.
  const isLoading = results.some((r) => r.isLoading && !r.isError)
  const isError = results.some((r) => r.isError)
  const errors = results.filter((r) => r.error).map((r) => r.error)

  debugBootstrap("Coordinated stream observer state", {
    workspaceId,
    streamIds,
    serverStreamIds,
    hasSocket: !!socket,
    isLoading,
    isError,
    errorCount: errors.length,
  })

  return {
    results,
    isLoading,
    isError,
    errors,
  }
}
