import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useWorkspaceService, useStreamService } from "@/contexts"
import { workspaceKeys } from "./use-workspaces"
import type { WorkspaceBootstrap } from "@threa/types"

export function useUnreadCounts(workspaceId: string) {
  const queryClient = useQueryClient()
  const streamService = useStreamService()
  const workspaceService = useWorkspaceService()

  // Get unread counts from the workspace bootstrap cache
  const bootstrap = queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId))
  const unreadCounts = bootstrap?.unreadCounts ?? {}

  const getUnreadCount = (streamId: string): number => {
    return unreadCounts[streamId] ?? 0
  }

  const getTotalUnreadCount = (): number => {
    return Object.values(unreadCounts).reduce((sum, count) => sum + count, 0)
  }

  const markAsReadMutation = useMutation({
    mutationFn: ({ streamId, lastEventId }: { streamId: string; lastEventId: string }) =>
      streamService.markAsRead(workspaceId, streamId, lastEventId),
    onSuccess: (_membership, { streamId }) => {
      const current = queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId))
      const hadActivity = (current?.activityCounts[streamId] ?? 0) > 0

      // The backend marks ALL stream activity as read (mentions + message notifications)
      // when a stream is read, so clear all activity counts for this stream.
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        const clearedActivity = old.activityCounts[streamId] ?? 0
        return {
          ...old,
          unreadCounts: {
            ...old.unreadCounts,
            [streamId]: 0,
          },
          mentionCounts: {
            ...old.mentionCounts,
            [streamId]: 0,
          },
          activityCounts: {
            ...old.activityCounts,
            [streamId]: 0,
          },
          unreadActivityCount: Math.max(0, (old.unreadActivityCount ?? 0) - clearedActivity),
        }
      })

      if (hadActivity) {
        queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] })
      }
    },
  })

  const markAllAsReadMutation = useMutation({
    mutationFn: () => workspaceService.markAllAsRead(workspaceId),
    onSuccess: (updatedStreamIds) => {
      // Update the workspace bootstrap cache to set unread count to 0 for all updated streams
      queryClient.setQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId), (old) => {
        if (!old) return old
        const newUnreadCounts = { ...old.unreadCounts }
        for (const streamId of updatedStreamIds) {
          newUnreadCounts[streamId] = 0
        }
        return {
          ...old,
          unreadCounts: newUnreadCounts,
        }
      })
    },
  })

  const markAsRead = (streamId: string, lastEventId: string) => {
    markAsReadMutation.mutate({ streamId, lastEventId })
  }

  const markAllAsRead = () => {
    markAllAsReadMutation.mutate()
  }

  /**
   * Increment unread count for a stream.
   *
   * Note: This is wired up to real-time socket events via the `stream:activity`
   * event in use-socket-events.ts. The backend broadcasts this workspace-scoped
   * event when messages are created, and the frontend filters by stream membership
   * and excludes the current user's own messages.
   */
  const incrementUnread = (streamId: string) => {
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
  }

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
