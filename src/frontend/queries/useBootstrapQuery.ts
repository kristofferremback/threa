/**
 * Bootstrap Query Hook
 *
 * Fetches workspace bootstrap data (streams, users, workspace info)
 * using TanStack Query for caching and offline support.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { workspaceApi } from "../../shared/api"
import type { BootstrapData, Stream, BootstrapUser } from "../types"

// Query keys for bootstrap data
export const bootstrapKeys = {
  all: ["bootstrap"] as const,
  workspace: (workspaceId: string) => [...bootstrapKeys.all, workspaceId] as const,
}

interface UseBootstrapQueryOptions {
  workspaceId?: string
  enabled?: boolean
}

/**
 * Hook to fetch bootstrap data for a workspace.
 *
 * Returns cached data immediately when offline, refetches when online.
 */
export function useBootstrapQuery({ workspaceId = "default", enabled = true }: UseBootstrapQueryOptions = {}) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: bootstrapKeys.workspace(workspaceId),
    queryFn: () => workspaceApi.getBootstrap(workspaceId),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
    networkMode: "offlineFirst",
    refetchOnReconnect: true,
  })

  // Helper to update streams in the cache
  const updateStreams = (updater: (streams: Stream[]) => Stream[]) => {
    queryClient.setQueryData<BootstrapData>(bootstrapKeys.workspace(workspaceId), (old) => {
      if (!old) return old
      return { ...old, streams: updater(old.streams) }
    })
  }

  // Add a stream to the cache
  const addStream = (stream: Stream) => {
    updateStreams((streams) => {
      const existingIndex = streams.findIndex((s) => s.id === stream.id)
      if (existingIndex >= 0) {
        // Update existing
        return streams
          .map((s) => (s.id === stream.id ? { ...s, ...stream } : s))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      }
      // Add new
      return [...streams, stream].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    })
  }

  // Update a stream in the cache
  const updateStream = (streamIdOrStream: string | Stream, updates?: Partial<Stream>) => {
    updateStreams((streams) => {
      const streamId = typeof streamIdOrStream === "string" ? streamIdOrStream : streamIdOrStream.id
      const streamUpdates = typeof streamIdOrStream === "string" ? updates || {} : streamIdOrStream

      return streams
        .map((s) => (s.id === streamId ? { ...s, ...streamUpdates } : s))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    })
  }

  // Remove a stream from the cache
  const removeStream = (streamId: string) => {
    updateStreams((streams) => streams.filter((s) => s.id !== streamId))
  }

  // Increment unread count for a stream
  const incrementUnreadCount = (streamId: string, increment = 1) => {
    updateStreams((streams) =>
      streams.map((s) =>
        s.id === streamId || s.slug === streamId ? { ...s, unreadCount: s.unreadCount + increment } : s,
      ),
    )
  }

  // Reset unread count for a stream
  const resetUnreadCount = (streamId: string) => {
    updateStreams((streams) =>
      streams.map((s) => (s.id === streamId || s.slug === streamId ? { ...s, unreadCount: 0 } : s)),
    )
  }

  // Helper to update users in the cache
  const updateUsers = (updater: (users: BootstrapUser[]) => BootstrapUser[]) => {
    queryClient.setQueryData<BootstrapData>(bootstrapKeys.workspace(workspaceId), (old) => {
      if (!old) return old
      return { ...old, users: updater(old.users) }
    })
  }

  // Add a user to the cache
  const addUser = (user: BootstrapUser) => {
    updateUsers((users) => {
      const existingIndex = users.findIndex((u) => u.id === user.id)
      if (existingIndex >= 0) {
        return users.map((u) => (u.id === user.id ? { ...u, ...user } : u))
      }
      return [...users, user].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    })
  }

  // Update a user in the cache
  const updateUser = (userId: string, updates: Partial<BootstrapUser>) => {
    updateUsers((users) =>
      users
        .map((u) => (u.id === userId ? { ...u, ...updates } : u))
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    )
  }

  // Remove a user from the cache
  const removeUser = (userId: string) => {
    updateUsers((users) => users.filter((u) => u.id !== userId))
  }

  // Check if we got a 404/403 (no workspace access)
  const noWorkspace = query.error?.message?.includes("404") || query.error?.message?.includes("403")

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
    noWorkspace,
    refetch: query.refetch,
    // Stream mutations
    addStream,
    updateStream,
    removeStream,
    incrementUnreadCount,
    resetUnreadCount,
    // User mutations
    addUser,
    updateUser,
    removeUser,
  }
}
