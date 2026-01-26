import { useMemo } from "react"
import { useParams } from "react-router-dom"
import { useThreadAncestors, useWorkspaceBootstrap } from "@/hooks"
import { usePanel } from "@/contexts"
import { ResponsiveBreadcrumbs } from "./responsive-breadcrumbs"

interface ThreadHeaderStream {
  id: string
  displayName: string | null
  parentStreamId: string | null
  rootStreamId: string | null
}

interface ThreadHeaderProps {
  workspaceId: string
  stream: ThreadHeaderStream
  /** Whether this header is in a panel (true) or main view (false). Affects navigation behavior. */
  inPanel?: boolean
}

export function ThreadHeader({ workspaceId, stream, inPanel = false }: ThreadHeaderProps) {
  const { ancestors: hookAncestors, isLoading } = useThreadAncestors(
    workspaceId,
    stream.id,
    stream.parentStreamId,
    stream.rootStreamId
  )

  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId)
  const ancestors = useMemo(() => {
    if (hookAncestors.length > 0) return hookAncestors

    if (stream.rootStreamId && bootstrap?.streams) {
      const rootStream = bootstrap.streams.find((s) => s.id === stream.rootStreamId)
      if (rootStream) {
        return [
          {
            id: rootStream.id,
            displayName: rootStream.displayName,
            slug: rootStream.slug,
            type: rootStream.type,
            parentStreamId: rootStream.parentStreamId,
          },
        ]
      }
    }

    return []
  }, [hookAncestors, stream.rootStreamId, bootstrap?.streams])

  const { getPanelUrl, closePanel } = usePanel()
  const { streamId: mainViewStreamId } = useParams<{ streamId: string }>()

  const getNavigationUrl = (streamId: string) => {
    return inPanel ? getPanelUrl(streamId) : `/w/${workspaceId}/s/${streamId}`
  }

  const isMainViewStream = (streamId: string) => {
    return inPanel && mainViewStreamId === streamId
  }

  const showLoadingPlaceholder = isLoading && stream.parentStreamId && ancestors.length === 0

  return (
    <div className={`min-w-0 flex-1 overflow-hidden ${inPanel ? "pr-2" : ""}`}>
      <ResponsiveBreadcrumbs
        ancestors={ancestors}
        currentLabel={stream.displayName || "Thread"}
        isMainViewStream={isMainViewStream}
        onClosePanel={closePanel}
        getNavigationUrl={getNavigationUrl}
        isLoading={!!showLoadingPlaceholder}
      />
    </div>
  )
}
