import { useMemo } from "react"
import { useWorkspaceBootstrap } from "./use-workspaces"

interface ThreadAncestor {
  id: string
  displayName: string | null
  slug: string | null
  type: string
  parentStreamId: string | null
}

/**
 * Builds the full ancestor chain from current thread to root.
 * Uses cached workspace streams to walk parentStreamId chain.
 * Returns array ordered from root to immediate parent (excluding current).
 */
export function useThreadAncestors(
  workspaceId: string,
  currentStreamId: string,
  parentStreamId: string | null,
  _rootStreamId: string | null
): {
  ancestors: ThreadAncestor[]
  isLoading: boolean
} {
  const { data: bootstrap, isLoading } = useWorkspaceBootstrap(workspaceId)

  const ancestors = useMemo(() => {
    if (!bootstrap?.streams || !parentStreamId) {
      return []
    }

    // Build a lookup map for O(1) access
    const streamMap = new Map(bootstrap.streams.map((s) => [s.id, s]))

    // Walk up the parent chain starting from parentStreamId
    const chain: ThreadAncestor[] = []
    const visited = new Set<string>()
    let currentId: string | null = parentStreamId

    while (currentId && currentId !== currentStreamId) {
      if (visited.has(currentId)) break
      visited.add(currentId)

      const stream = streamMap.get(currentId)
      if (!stream) break

      chain.unshift({
        id: stream.id,
        displayName: stream.displayName,
        slug: stream.slug,
        type: stream.type,
        parentStreamId: stream.parentStreamId,
      })

      currentId = stream.parentStreamId
    }

    return chain
  }, [bootstrap?.streams, parentStreamId, currentStreamId])

  return { ancestors, isLoading }
}
