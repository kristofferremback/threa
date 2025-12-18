import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useSocket } from "@/contexts"
import { db } from "@/db"
import { streamKeys } from "./use-streams"
import { workspaceKeys } from "./use-workspaces"
import type { Stream } from "@/types/domain"

interface StreamPayload {
  workspaceId: string
  streamId: string
  stream: Stream
}

/**
 * Hook to handle Socket.io events for stream updates.
 * Joins the workspace room and listens for stream:created/updated/archived events.
 * Updates React Query cache and IndexedDB when events are received.
 */
export function useSocketEvents(workspaceId: string) {
  const queryClient = useQueryClient()
  const socket = useSocket()

  useEffect(() => {
    if (!socket || !workspaceId) return

    // Join workspace room to receive stream metadata events
    socket.emit("join", `ws:${workspaceId}`)

    // Handle stream created
    socket.on("stream:created", (payload: StreamPayload) => {
      // Add to workspace bootstrap cache (sidebar)
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { streams?: Stream[] }
        if (!bootstrap.streams) return old
        // Only add if not already present (avoid duplicates from own actions)
        if (bootstrap.streams.some((s) => s.id === payload.stream.id)) return old
        return {
          ...bootstrap,
          streams: [...bootstrap.streams, payload.stream],
        }
      })

      // Cache to IndexedDB
      db.streams.put({ ...payload.stream, _cachedAt: Date.now() })
    })

    // Handle stream updated
    socket.on("stream:updated", (payload: StreamPayload) => {
      // Update stream detail cache
      queryClient.setQueryData(streamKeys.detail(workspaceId, payload.stream.id), payload.stream)

      // Update stream bootstrap cache (preserves events, members, etc.)
      queryClient.setQueryData(streamKeys.bootstrap(workspaceId, payload.stream.id), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        return { ...old, stream: payload.stream }
      })

      // Update workspace bootstrap cache (sidebar)
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { streams?: Stream[] }
        if (!bootstrap.streams) return old
        return {
          ...bootstrap,
          streams: bootstrap.streams.map((s) => (s.id === payload.stream.id ? payload.stream : s)),
        }
      })

      // Update IndexedDB
      db.streams.put({ ...payload.stream, _cachedAt: Date.now() })
    })

    // Handle stream archived
    socket.on("stream:archived", (payload: StreamPayload) => {
      // Remove from stream-specific caches
      queryClient.removeQueries({ queryKey: streamKeys.detail(workspaceId, payload.stream.id) })
      queryClient.removeQueries({ queryKey: streamKeys.bootstrap(workspaceId, payload.stream.id) })

      // Remove from workspace bootstrap cache (sidebar)
      queryClient.setQueryData(workspaceKeys.bootstrap(workspaceId), (old: unknown) => {
        if (!old || typeof old !== "object") return old
        const bootstrap = old as { streams?: Stream[] }
        if (!bootstrap.streams) return old
        return {
          ...bootstrap,
          streams: bootstrap.streams.filter((s) => s.id !== payload.stream.id),
        }
      })

      // Remove from IndexedDB
      db.streams.delete(payload.stream.id)
    })

    return () => {
      socket.emit("leave", `ws:${workspaceId}`)
      socket.off("stream:created")
      socket.off("stream:updated")
      socket.off("stream:archived")
    }
  }, [socket, workspaceId, queryClient])
}
