import { useSearchParams } from "react-router-dom"
import { Pin, Maximize2, Minimize2 } from "lucide-react"
import {
  SidePanel,
  SidePanelHeader,
  SidePanelTitle,
  SidePanelClose,
  SidePanelContent,
} from "@/components/ui/side-panel"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { useStreamBootstrap } from "@/hooks"
import { usePanel } from "@/contexts"
import { StreamContent } from "@/components/timeline"
import { StreamErrorBoundary } from "@/components/stream-error-boundary"
import { ThreadHeader } from "./thread-header"
import { StreamTypes } from "@threa/types"

interface StreamPanelProps {
  workspaceId: string
  streamId: string
  onClose: () => void
  isFullscreen?: boolean
}

export function StreamPanel({ workspaceId, streamId, onClose, isFullscreen }: StreamPanelProps) {
  const [searchParams] = useSearchParams()
  const highlightMessageId = searchParams.get("m")
  const { panelMode, pinPanel, expandPanel, exitFullscreen } = usePanel()

  const { data: bootstrap, error } = useStreamBootstrap(workspaceId, streamId)
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
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-1">
            {/* Pin button - only show in overlay mode */}
            {panelMode === "overlay" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={pinPanel}>
                    <Pin className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Pin panel</TooltipContent>
              </Tooltip>
            )}
            {/* Expand/minimize button */}
            {isFullscreen ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={exitFullscreen}>
                    <Minimize2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Exit fullscreen</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={expandPanel}>
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Fullscreen</TooltipContent>
              </Tooltip>
            )}
            <SidePanelClose onClose={onClose} />
          </div>
        </TooltipProvider>
      </SidePanelHeader>
      <SidePanelContent className="flex flex-col">
        <StreamErrorBoundary streamId={streamId} queryError={error}>
          <StreamContent
            workspaceId={workspaceId}
            streamId={streamId}
            highlightMessageId={highlightMessageId}
            stream={stream}
          />
        </StreamErrorBoundary>
      </SidePanelContent>
    </SidePanel>
  )
}
