import { useMemo } from "react"
import { useAuth } from "@/auth"
import { useWorkspaceBootstrap } from "./use-workspaces"
import { getLastStreamId, clearLastStreamId } from "@/lib/last-stream"
import type { StreamWithPreview } from "@threa/types"

interface UseLastStreamResult {
  /** Stream ID to redirect to, or null if no stream is available */
  redirectStreamId: string | null
  /** True when bootstrap is loaded and the workspace has zero streams */
  shouldOpenSidebar: boolean
}

/**
 * Resolves which stream to show when the workspace index route loads.
 *
 * Priority:
 * 1. Stored last-stream from localStorage (validated against bootstrap)
 * 2. Most recently active stream from bootstrap data
 * 3. First available stream
 *
 * Evicts stale localStorage entries when the stored stream no longer
 * exists in the user's workspace (deleted, lost access, etc).
 *
 * Returns `shouldOpenSidebar: true` only after bootstrap has loaded
 * and confirmed the workspace has no streams — avoids premature
 * sidebar mutations while async data is still in flight.
 */
export function useLastStream(workspaceId: string): UseLastStreamResult {
  const { user } = useAuth()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId)

  return useMemo(() => {
    // Wait for bootstrap before making any decisions
    if (!bootstrap) {
      return { redirectStreamId: null, shouldOpenSidebar: false }
    }

    const streams = bootstrap.streams
    const storedId = user ? getLastStreamId(user.id, workspaceId) : null

    // Validate stored ID against current workspace streams
    if (storedId) {
      const stillExists = streams.some((s) => s.id === storedId)
      if (stillExists) {
        return { redirectStreamId: storedId, shouldOpenSidebar: false }
      }
      // Evict stale entry
      if (user) clearLastStreamId(user.id, workspaceId)
    }

    // Fall back to most recently active stream
    if (streams.length > 0) {
      return { redirectStreamId: getMostRecentStreamId(streams), shouldOpenSidebar: false }
    }

    // Empty workspace — signal sidebar should open
    return { redirectStreamId: null, shouldOpenSidebar: true }
  }, [user, workspaceId, bootstrap])
}

function getMostRecentStreamId(streams: StreamWithPreview[]): string {
  const withPreview = streams
    .filter((s) => s.lastMessagePreview)
    .sort((a, b) => b.lastMessagePreview!.createdAt.localeCompare(a.lastMessagePreview!.createdAt))
  return withPreview[0]?.id ?? streams[0]?.id ?? streams[0].id
}
