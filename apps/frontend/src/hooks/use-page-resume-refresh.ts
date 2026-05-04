import { useQueryClient } from "@tanstack/react-query"
import { useParams, useSearchParams } from "react-router-dom"
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
 * Invalidate workspace + every visible stream's bootstrap when the tab returns
 * from a >5s background. Visible streams = the route stream plus any open
 * `?panel=` panes — same set `WorkspaceLayout` feeds into the sync engine, so
 * INV-53 (subscribe-then-bootstrap) holds for panels too. Complements
 * socket-driven invalidation (`stream-sync.ts` invalidates on reconnect): when
 * the socket has stayed connected through a brief background, we still want
 * to catch any events that landed while the tab couldn't react. Redundant
 * fires are dedup'd by TanStack's in-flight refetch coalescing.
 */
export function usePageResumeRefresh(): void {
  const queryClient = useQueryClient()
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId?: string }>()
  const [searchParams] = useSearchParams()

  usePageResume(() => {
    if (!workspaceId) return
    queryClient.invalidateQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })

    const visibleStreamIds = [streamId, ...searchParams.getAll("panel")].filter((id): id is string => Boolean(id))
    for (const visibleStreamId of visibleStreamIds) {
      queryClient.invalidateQueries({ queryKey: streamKeys.bootstrap(workspaceId, visibleStreamId) })
    }
  }, RESUME_REFRESH_THRESHOLD_MS)
}
