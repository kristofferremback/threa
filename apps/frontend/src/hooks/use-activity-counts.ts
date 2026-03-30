import { useCallback } from "react"
import { useWorkspaceUnreadState } from "@/stores/workspace-store"

export function useActivityCounts(workspaceId: string) {
  const unreadState = useWorkspaceUnreadState(workspaceId)
  const mentionCounts = unreadState?.mentionCounts ?? {}
  const activityCounts = unreadState?.activityCounts ?? {}
  const unreadActivityCount = unreadState?.unreadActivityCount ?? 0

  const getMentionCount = useCallback((streamId: string): number => mentionCounts[streamId] ?? 0, [mentionCounts])

  const getActivityCount = useCallback((streamId: string): number => activityCounts[streamId] ?? 0, [activityCounts])

  const getTotalMentionCount = useCallback(
    (): number => Object.values(mentionCounts).reduce((sum, count) => sum + count, 0),
    [mentionCounts]
  )

  return {
    mentionCounts,
    getMentionCount,
    getActivityCount,
    getTotalMentionCount,
    unreadActivityCount,
  }
}
