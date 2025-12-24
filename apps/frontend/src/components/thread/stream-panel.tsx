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
import { ThreadHeader } from "./thread-header"
import { StreamTypes } from "@threa/types"

interface StreamPanelProps {
  workspaceId: string
  streamId: string
  onClose: () => void
}

export function StreamPanel({ workspaceId, streamId, onClose }: StreamPanelProps) {
  const [searchParams] = useSearchParams()
  const highlightMessageId = searchParams.get("m")

  const { data: bootstrap } = useStreamBootstrap(workspaceId, streamId)
  const stream = bootstrap?.stream
  const isThread = stream?.type === StreamTypes.THREAD

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
        <StreamContent workspaceId={workspaceId} streamId={streamId} highlightMessageId={highlightMessageId} />
      </SidePanelContent>
    </SidePanel>
  )
}
