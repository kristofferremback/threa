import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useSocketReconnectCount } from "@/contexts"
import { workspaceKeys } from "./use-workspaces"
import { streamKeys } from "./use-streams"

/**
 * Hook that handles re-bootstrapping data when the socket reconnects.
 *
 * When a reconnect is detected (via reconnectCount change), this hook:
 * 1. Invalidates workspace bootstrap query to refetch fresh data
 * 2. Invalidates all stream bootstrap queries to refetch fresh data
 *
 * The actual room re-joining is handled automatically by useSocketEvents and
 * useStreamSocket - when their useEffect runs again due to the socket
 * reconnecting, they will emit "join" for their rooms.
 *
 * React Query's invalidation will trigger refetches, which combined with
 * the re-joining of rooms follows the subscribe-then-bootstrap pattern.
 */
export function useReconnectBootstrap(workspaceId: string, streamIds: string[]) {
  const queryClient = useQueryClient()
  const reconnectCount = useSocketReconnectCount()

  // Track the previous reconnect count to detect actual reconnections
  const prevReconnectCountRef = useRef(reconnectCount)

  useEffect(() => {
    // Only act on reconnections, not initial mount
    if (reconnectCount === 0) {
      prevReconnectCountRef.current = reconnectCount
      return
    }

    // Check if this is a new reconnection
    if (reconnectCount !== prevReconnectCountRef.current) {
      prevReconnectCountRef.current = reconnectCount

      console.log("[ReconnectBootstrap] Socket reconnected, invalidating queries...")

      // Invalidate workspace bootstrap to get fresh sidebar data
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.bootstrap(workspaceId),
      })

      // Invalidate all currently visible stream bootstraps
      // Filter out draft streams (they don't need server fetch)
      const serverStreamIds = streamIds.filter((id) => !id.startsWith("draft_") && !id.startsWith("draft:"))

      for (const streamId of serverStreamIds) {
        queryClient.invalidateQueries({
          queryKey: streamKeys.bootstrap(workspaceId, streamId),
        })
      }

      console.log(`[ReconnectBootstrap] Invalidated workspace + ${serverStreamIds.length} stream queries`)
    }
  }, [reconnectCount, workspaceId, streamIds, queryClient])
}
