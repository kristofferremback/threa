import { useQueryClient } from "@tanstack/react-query"
import { workspaceKeys } from "./use-workspaces"
import type { WorkspaceBootstrap } from "@threa/types"

export function useMentionCounts(workspaceId: string) {
  const queryClient = useQueryClient()

  const bootstrap = queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId))
  const mentionCounts = bootstrap?.mentionCounts ?? {}
  const activityCountsByStream = bootstrap?.activityCountsByStream ?? {}
  const unreadActivityCount = bootstrap?.unreadActivityCount ?? 0

  const getMentionCount = (streamId: string): number => {
    return mentionCounts[streamId] ?? 0
  }

  const getActivityCount = (streamId: string): number => {
    return activityCountsByStream[streamId] ?? 0
  }

  const getTotalMentionCount = (): number => {
    return Object.values(mentionCounts).reduce((sum, count) => sum + count, 0)
  }

  return {
    mentionCounts,
    getMentionCount,
    getActivityCount,
    getTotalMentionCount,
    unreadActivityCount,
  }
}
