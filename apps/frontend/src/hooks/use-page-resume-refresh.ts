import { useQueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { usePageResume } from "./use-page-resume"
import { workspaceKeys } from "./use-workspaces"
import { streamKeys } from "./use-streams"

/**
 * Threshold for triggering bootstrap invalidation on resume. Tighter than
 * `useAppUpdate`'s 10s version-check window because a few seconds away is
 * enough for socket events to be missed (e.g. notification-shade peek that
 * actually delivered a push). Lighter freshness work justifies a tighter gate.
 */
const RESUME_REFRESH_THRESHOLD_MS = 5_000

/**
 * Invalidate workspace + active stream bootstrap queries when the tab returns
 * from a >5s background. Complements socket-driven invalidation
 * (`stream-sync.ts` invalidates on reconnect): when the socket has stayed
 * connected through a brief background, we still want to catch any events
 * that landed while the tab couldn't react. Redundant fires are dedup'd by
 * TanStack's in-flight refetch coalescing.
 */
export function usePageResumeRefresh(): void {
  const queryClient = useQueryClient()
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId?: string }>()

  usePageResume(() => {
    if (!workspaceId) return
    queryClient.invalidateQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })
    if (streamId) {
      queryClient.invalidateQueries({ queryKey: streamKeys.bootstrap(workspaceId, streamId) })
    }
  }, RESUME_REFRESH_THRESHOLD_MS)
}
