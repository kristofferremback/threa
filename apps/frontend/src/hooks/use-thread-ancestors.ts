import { useStreamBootstrap } from "./use-streams"

interface ThreadAncestor {
  id: string
  displayName: string | null
  slug: string | null
  type: string
}

/**
 * Fetches ancestor streams from current thread to root
 * Returns array from root to current (excluding current)
 */
export function useThreadAncestors(
  workspaceId: string,
  currentStreamId: string,
  parentStreamId: string | null,
  rootStreamId: string | null
): {
  ancestors: ThreadAncestor[]
  isLoading: boolean
} {
  // Fetch root stream
  const { data: rootBootstrap, isLoading: rootLoading } = useStreamBootstrap(workspaceId, rootStreamId ?? "", {
    enabled: !!rootStreamId && rootStreamId !== currentStreamId,
  })

  // Fetch parent stream (if different from root)
  const { data: parentBootstrap, isLoading: parentLoading } = useStreamBootstrap(workspaceId, parentStreamId ?? "", {
    enabled: !!parentStreamId && parentStreamId !== rootStreamId && parentStreamId !== currentStreamId,
  })

  const isLoading = rootLoading || parentLoading

  // Build ancestor array (from root to current parent)
  const ancestors: ThreadAncestor[] = []

  // Add root stream first
  if (rootBootstrap?.stream) {
    ancestors.push({
      id: rootBootstrap.stream.id,
      displayName: rootBootstrap.stream.displayName,
      slug: rootBootstrap.stream.slug,
      type: rootBootstrap.stream.type,
    })
  }

  // Add parent stream if different from root
  if (parentBootstrap?.stream && parentStreamId !== rootStreamId) {
    ancestors.push({
      id: parentBootstrap.stream.id,
      displayName: parentBootstrap.stream.displayName,
      slug: parentBootstrap.stream.slug,
      type: parentBootstrap.stream.type,
    })
  }

  return { ancestors, isLoading }
}
