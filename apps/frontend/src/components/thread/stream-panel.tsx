import { useSearchParams } from "react-router-dom"
import {
  SidePanel,
  SidePanelHeader,
  SidePanelTitle,
  SidePanelClose,
  SidePanelContent,
} from "@/components/ui/side-panel"
import { useStreamBootstrap } from "@/hooks"
import { StreamContent } from "@/components/timeline"
import { StreamErrorView } from "@/components/stream-error-view"
import { ThreadHeader } from "./thread-header"
import { StreamTypes } from "@threa/types"
import { ApiError } from "@/api/client"

interface StreamPanelProps {
  workspaceId: string
  streamId: string
  onClose: () => void
}

export function StreamPanel({ workspaceId, streamId, onClose }: StreamPanelProps) {
  const [searchParams] = useSearchParams()
  const highlightMessageId = searchParams.get("m")

  const { data: bootstrap, error } = useStreamBootstrap(workspaceId, streamId)
  const stream = bootstrap?.stream
  const isThread = stream?.type === StreamTypes.THREAD

  const errorType = ApiError.isApiError(error)
    ? error.status === 404
      ? "not-found"
      : error.status === 403
        ? "forbidden"
        : null
    : null

  return (
    <SidePanel>
      <SidePanelHeader>
        {isThread && stream ? (
          <ThreadHeader workspaceId={workspaceId} stream={stream} onBack={onClose} />
        ) : (
          <SidePanelTitle>{stream?.displayName || "Stream"}</SidePanelTitle>
        )}
        <SidePanelClose onClose={onClose} />
      </SidePanelHeader>
      <SidePanelContent className="flex flex-col">
        {errorType ? (
          <StreamErrorView type={errorType} />
        ) : (
          <StreamContent
            workspaceId={workspaceId}
            streamId={streamId}
            highlightMessageId={highlightMessageId}
            stream={stream}
          />
        )}
      </SidePanelContent>
    </SidePanel>
  )
}
