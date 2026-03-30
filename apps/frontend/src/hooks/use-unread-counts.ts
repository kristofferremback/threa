import { useCallback } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useWorkspaceService, useStreamService } from "@/contexts"
import { workspaceKeys } from "./use-workspaces"
import { useWorkspaceUnreadState } from "@/stores/workspace-store"
import { db } from "@/db"
import type { WorkspaceBootstrap } from "@threa/types"

export function useUnreadCounts(workspaceId: string) {
  const queryClient = useQueryClient()
  const streamService = useStreamService()
  const workspaceService = useWorkspaceService()

  // Read from IDB via useLiveQuery — reactive and offline-capable
  const unreadState = useWorkspaceUnreadState(workspaceId)
  const unreadCounts = unreadState?.unreadCounts ?? {}

  const getUnreadCount = useCallback((streamId: string): number => unreadCounts[streamId] ?? 0, [unreadCounts])

  const getTotalUnreadCount = useCallback(
    (): number => Object.values(unreadCounts).reduce((sum, count) => sum + count, 0),
    [unreadCounts]
  )

  const markAsReadMutation = useMutation({
    mutationFn: ({ streamId, lastEventId }: { streamId: string; lastEventId: string }) =>
      streamService.markAsRead(workspaceId, streamId, lastEventId),
    onSuccess: (_membership, { streamId }) => {
      const current = queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId))
      const hadActivity = (current?.activityCounts[streamId] ?? 0) > 0

      // Update TanStack cache (bridge for unmigrated consumers)
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        const clearedActivity = old.activityCounts[streamId] ?? 0
        return {
          ...old,
          unreadCounts: { ...old.unreadCounts, [streamId]: 0 },
          mentionCounts: { ...old.mentionCounts, [streamId]: 0 },
          activityCounts: { ...old.activityCounts, [streamId]: 0 },
          unreadActivityCount: Math.max(0, (old.unreadActivityCount ?? 0) - clearedActivity),
        }
      })

      // Update IDB for immediate consistency with IDB-backed consumers
      db.transaction("rw", [db.unreadState], async () => {
        const state = await db.unreadState.get(workspaceId)
        if (!state) return
        const clearedActivity = state.activityCounts[streamId] ?? 0
        await db.unreadState.put({
          ...state,
          unreadCounts: { ...state.unreadCounts, [streamId]: 0 },
          mentionCounts: { ...state.mentionCounts, [streamId]: 0 },
          activityCounts: { ...state.activityCounts, [streamId]: 0 },
          unreadActivityCount: Math.max(0, state.unreadActivityCount - clearedActivity),
          _cachedAt: Date.now(),
        })
      })

      if (hadActivity) {
        queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] })
      }
    },
  })

  const markAllAsReadMutation = useMutation({
    mutationFn: () => workspaceService.markAllAsRead(workspaceId),
    onSuccess: (updatedStreamIds) => {
      // Update TanStack cache (bridge)
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        const newUnread = { ...old.unreadCounts }
        const newMention = { ...old.mentionCounts }
        const newActivity = { ...old.activityCounts }
        for (const streamId of updatedStreamIds) {
          newUnread[streamId] = 0
          newMention[streamId] = 0
          newActivity[streamId] = 0
        }
        return {
          ...old,
          unreadCounts: newUnread,
          mentionCounts: newMention,
          activityCounts: newActivity,
          unreadActivityCount: 0,
        }
      })

      // Update IDB
      db.transaction("rw", [db.unreadState], async () => {
        const state = await db.unreadState.get(workspaceId)
        if (!state) return
        const newUnread = { ...state.unreadCounts }
        const newMention = { ...state.mentionCounts }
        const newActivity = { ...state.activityCounts }
        for (const streamId of updatedStreamIds) {
          newUnread[streamId] = 0
          newMention[streamId] = 0
          newActivity[streamId] = 0
        }
        await db.unreadState.put({
          ...state,
          unreadCounts: newUnread,
          mentionCounts: newMention,
          activityCounts: newActivity,
          unreadActivityCount: 0,
          _cachedAt: Date.now(),
        })
      })
    },
  })

  const markAsRead = useCallback(
    (streamId: string, lastEventId: string) => {
      markAsReadMutation.mutate({ streamId, lastEventId })
    },
    [markAsReadMutation]
  )

  const markAllAsRead = useCallback(() => {
    markAllAsReadMutation.mutate()
  }, [markAllAsReadMutation])

  const incrementUnread = useCallback(
    (streamId: string) => {
      // Update TanStack cache (bridge)
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        return {
          ...old,
          unreadCounts: {
            ...old.unreadCounts,
            [streamId]: (old.unreadCounts[streamId] ?? 0) + 1,
          },
        }
      })

      // Update IDB
      db.transaction("rw", [db.unreadState], async () => {
        const state = await db.unreadState.get(workspaceId)
        if (!state) return
        await db.unreadState.put({
          ...state,
          unreadCounts: {
            ...state.unreadCounts,
            [streamId]: (state.unreadCounts[streamId] ?? 0) + 1,
          },
          _cachedAt: Date.now(),
        })
      })
    },
    [queryClient, workspaceId]
  )

  return {
    unreadCounts,
    getUnreadCount,
    getTotalUnreadCount,
    markAsRead,
    markAllAsRead,
    incrementUnread,
    isMarkingAsRead: markAsReadMutation.isPending,
    isMarkingAllAsRead: markAllAsReadMutation.isPending,
  }
}
