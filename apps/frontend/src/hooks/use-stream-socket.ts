import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useSocket } from "@/contexts"
import { joinRoomFireAndForget } from "@/lib/socket-room"
import { registerStreamSocketHandlers } from "@/sync/stream-sync"

/**
 * Hook to handle real-time message/reaction events for a specific stream.
 * Joins the stream room and delegates event handling to the sync module
 * which writes exclusively to IndexedDB (UI updates via useLiveQuery).
 *
 * Bootstrap hooks also use join ack via joinRoomWithAck before fetching.
 * This hook keeps the room subscription active for realtime updates.
 */
export function useStreamSocket(workspaceId: string, streamId: string, options?: { enabled?: boolean }) {
  const shouldSubscribe = options?.enabled ?? true
  const queryClient = useQueryClient()
  const socket = useSocket()

  useEffect(() => {
    if (!socket || !workspaceId || !streamId || !shouldSubscribe) return

    const room = `ws:${workspaceId}:stream:${streamId}`
    const abortController = new AbortController()

    // Subscribe FIRST (before any fetches happen)
    joinRoomFireAndForget(socket, room, abortController.signal, "StreamSocket")

    // Register all stream-level socket handlers — they write to IDB only.
    // queryClient is passed for transitional workspace bootstrap preview updates
    // (will be removed in Phase 3).
    const cleanupHandlers = registerStreamSocketHandlers(socket, workspaceId, streamId, queryClient)

    return () => {
      abortController.abort()
      cleanupHandlers()
      // Do NOT leave the room here. Socket.io rooms are not reference-counted:
      // a single leave undoes ALL joins. The SyncEngine also joins this room
      // for stream:activity delivery — leaving here would break sidebar updates.
    }
  }, [socket, workspaceId, streamId, shouldSubscribe, queryClient])
}
