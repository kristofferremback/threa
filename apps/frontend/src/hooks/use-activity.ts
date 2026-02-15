import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useActivityService } from "@/contexts"
import { workspaceKeys } from "./use-workspaces"
import type { Activity, WorkspaceBootstrap } from "@threa/types"

export const activityKeys = {
  all: ["activity"] as const,
  list: (workspaceId: string) => ["activity", workspaceId] as const,
  listFiltered: (workspaceId: string, unreadOnly: boolean) => ["activity", workspaceId, { unreadOnly }] as const,
}

export function useActivityFeed(workspaceId: string, opts?: { unreadOnly?: boolean }) {
  const activityService = useActivityService()
  const unreadOnly = opts?.unreadOnly ?? false

  return useQuery({
    queryKey: activityKeys.listFiltered(workspaceId, unreadOnly),
    queryFn: () => activityService.list(workspaceId, { limit: 50, unreadOnly }),
    // Subscribe-then-bootstrap pattern:
    // staleTime: Infinity prevents auto-refetch; socket events invalidate when needed.
    // refetchOnMount: true triggers refetch when data is stale (after invalidation).
    staleTime: Infinity,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: !!workspaceId,
  })
}

export function useMarkActivityRead(workspaceId: string) {
  const activityService = useActivityService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (activityId: string) => activityService.markAsRead(workspaceId, activityId),
    onMutate: async (activityId: string) => {
      // Optimistic update: mark as read in cache
      await queryClient.cancelQueries({ queryKey: activityKeys.list(workspaceId) })

      queryClient.setQueriesData<Activity[]>({ queryKey: activityKeys.list(workspaceId) }, (old) => {
        if (!old) return old
        return old.map((a) => (a.id === activityId ? { ...a, readAt: new Date().toISOString() } : a))
      })

      // Decrement unreadActivityCount
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        return {
          ...old,
          unreadActivityCount: Math.max(0, (old.unreadActivityCount ?? 0) - 1),
        }
      })
    },
    onError: () => {
      // Rollback: refetch on error
      queryClient.invalidateQueries({ queryKey: activityKeys.list(workspaceId) })
    },
  })
}

export function useMarkAllActivityRead(workspaceId: string) {
  const activityService = useActivityService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => activityService.markAllAsRead(workspaceId),
    onSuccess: () => {
      // Clear all activity data and counts
      queryClient.invalidateQueries({ queryKey: activityKeys.list(workspaceId) })

      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        const clearedMentionCounts: Record<string, number> = {}
        const clearedActivityCounts: Record<string, number> = {}
        for (const key of Object.keys(old.mentionCounts)) {
          clearedMentionCounts[key] = 0
        }
        for (const key of Object.keys(old.activityCountsByStream)) {
          clearedActivityCounts[key] = 0
        }
        return {
          ...old,
          mentionCounts: clearedMentionCounts,
          activityCountsByStream: clearedActivityCounts,
          unreadActivityCount: 0,
        }
      })
    },
  })
}
