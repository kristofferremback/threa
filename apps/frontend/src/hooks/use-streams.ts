import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useStreamService } from "@/contexts"
import { db } from "@/db"
import type { Stream, StreamType } from "@/types/domain"
import type { CreateStreamInput, UpdateStreamInput } from "@/api"

// Query keys for cache management
export const streamKeys = {
  all: ["streams"] as const,
  lists: () => [...streamKeys.all, "list"] as const,
  list: (workspaceId: string, filters?: { type?: StreamType }) =>
    [...streamKeys.lists(), workspaceId, filters] as const,
  details: () => [...streamKeys.all, "detail"] as const,
  detail: (workspaceId: string, streamId: string) =>
    [...streamKeys.details(), workspaceId, streamId] as const,
  bootstrap: (workspaceId: string, streamId: string) =>
    [...streamKeys.all, "bootstrap", workspaceId, streamId] as const,
  events: (workspaceId: string, streamId: string) =>
    [...streamKeys.all, "events", workspaceId, streamId] as const,
}

export function useStreams(workspaceId: string, filters?: { type?: StreamType }) {
  const streamService = useStreamService()

  return useQuery({
    queryKey: streamKeys.list(workspaceId, filters),
    queryFn: async () => {
      const streams = await streamService.list(workspaceId, filters)

      // Cache to IndexedDB
      const now = Date.now()
      await db.streams.bulkPut(streams.map((s) => ({ ...s, _cachedAt: now })))

      return streams
    },
    enabled: !!workspaceId,
  })
}

export function useStream(workspaceId: string, streamId: string) {
  const streamService = useStreamService()

  return useQuery({
    queryKey: streamKeys.detail(workspaceId, streamId),
    queryFn: async () => {
      const stream = await streamService.get(workspaceId, streamId)

      // Cache to IndexedDB
      await db.streams.put({ ...stream, _cachedAt: Date.now() })

      return stream
    },
    enabled: !!workspaceId && !!streamId,
  })
}

export function useStreamBootstrap(workspaceId: string, streamId: string) {
  const streamService = useStreamService()

  return useQuery({
    queryKey: streamKeys.bootstrap(workspaceId, streamId),
    queryFn: async () => {
      const bootstrap = await streamService.bootstrap(workspaceId, streamId)
      const now = Date.now()

      // Cache stream and events to IndexedDB
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
    enabled: !!workspaceId && !!streamId,
  })
}

export function useCreateStream(workspaceId: string) {
  const streamService = useStreamService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateStreamInput) => streamService.create(workspaceId, data),
    onSuccess: (newStream) => {
      // Invalidate stream lists to refetch
      queryClient.invalidateQueries({ queryKey: streamKeys.lists() })

      // Cache to IndexedDB
      db.streams.put({ ...newStream, _cachedAt: Date.now() })
    },
  })
}

export function useUpdateStream(workspaceId: string, streamId: string) {
  const streamService = useStreamService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateStreamInput) => streamService.update(workspaceId, streamId, data),
    onSuccess: (updatedStream) => {
      // Update cache
      queryClient.setQueryData<Stream>(streamKeys.detail(workspaceId, streamId), updatedStream)

      // Update in lists
      queryClient.invalidateQueries({ queryKey: streamKeys.lists() })

      // Cache to IndexedDB
      db.streams.put({ ...updatedStream, _cachedAt: Date.now() })
    },
  })
}

export function useDeleteStream(workspaceId: string) {
  const streamService = useStreamService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (streamId: string) => streamService.delete(workspaceId, streamId),
    onSuccess: (_, streamId) => {
      // Invalidate stream lists
      queryClient.invalidateQueries({ queryKey: streamKeys.lists() })

      // Remove from cache
      queryClient.removeQueries({ queryKey: streamKeys.detail(workspaceId, streamId) })

      // Remove from IndexedDB
      db.streams.delete(streamId)
    },
  })
}
