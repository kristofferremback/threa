import { useCallback, useRef } from "react"
import { useWorkspaceUnreadState } from "@/stores/workspace-store"

export function useActivityCounts(workspaceId: string) {
  const unreadState = useWorkspaceUnreadState(workspaceId)
  const mentionCounts = unreadState?.mentionCounts ?? {}
  const activityCounts = unreadState?.activityCounts ?? {}
  const unreadActivityCount = unreadState?.unreadActivityCount ?? 0

  // Refs keep callback identity stable so sidebar memos don't cascade
  const mentionCountsRef = useRef(mentionCounts)
  mentionCountsRef.current = mentionCounts
  const activityCountsRef = useRef(activityCounts)
  activityCountsRef.current = activityCounts

  const getMentionCount = useCallback((streamId: string): number => mentionCountsRef.current[streamId] ?? 0, [])

  const getActivityCount = useCallback((streamId: string): number => activityCountsRef.current[streamId] ?? 0, [])

  const getTotalMentionCount = useCallback(
    (): number => Object.values(mentionCountsRef.current).reduce((sum, count) => sum + count, 0),
    []
  )

  return {
    mentionCounts,
    getMentionCount,
    getActivityCount,
    getTotalMentionCount,
    unreadActivityCount,
  }
}
