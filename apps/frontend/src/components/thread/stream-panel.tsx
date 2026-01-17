import { useSearchParams } from "react-router-dom"
import { X } from "lucide-react"
import {
  SidePanel,
  SidePanelHeader,
  SidePanelTitle,
  SidePanelClose,
  SidePanelContent,
} from "@/components/ui/side-panel"
import { cn } from "@/lib/utils"
import { useStreamBootstrap } from "@/hooks"
import { usePanel } from "@/contexts"
import { StreamContent } from "@/components/timeline"
import { StreamErrorBoundary } from "@/components/stream-error-boundary"
import { ThreadHeader } from "./thread-header"
import { StreamTypes } from "@threa/types"

interface StreamPanelProps {
  workspaceId: string
  onClose: () => void
}

export function StreamPanel({ workspaceId, onClose }: StreamPanelProps) {
  const [searchParams] = useSearchParams()
  const highlightMessageId = searchParams.get("m")
  const { openPanels, activePanelId, activeTabIndex, setActiveTab, closePanel } = usePanel()

  // Get active panel's stream ID from context
  const activeStreamId = activePanelId
  if (!activeStreamId) return null

  const { data: bootstrap, error } = useStreamBootstrap(workspaceId, activeStreamId)
  const stream = bootstrap?.stream
  const isThread = stream?.type === StreamTypes.THREAD

  const showTabs = openPanels.length > 1

  // Helper to get display name for a stream ID
  const getStreamDisplayName = (streamId: string): string => {
    if (streamId === activeStreamId && stream) {
      // We have the active stream data loaded
      if (stream.type === StreamTypes.THREAD) {
        return stream.displayName || "Thread"
      }
      if (stream.slug) {
        return `#${stream.slug}`
      }
      if (stream.displayName) {
        return stream.displayName
      }
      if (stream.type === StreamTypes.SCRATCHPAD) {
        return "New scratchpad"
      }
      return "Stream"
    }
    // For non-active panels, we don't have the data yet - show a loading state
    return "..."
  }

  return (
    <SidePanel>
      <SidePanelHeader>
        {/* Tabs when multiple panels */}
        {showTabs ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <div className="flex gap-1 overflow-x-auto flex-1 min-w-0">
              {openPanels.map((panel, index) => {
                const isActive = index === activeTabIndex
                const displayName = getStreamDisplayName(panel.streamId)
                return (
                  <div
                    key={panel.streamId}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm cursor-pointer transition-all max-w-[150px] group",
                      "hover:bg-muted/50 hover:text-foreground",
                      isActive ? "bg-primary/10 text-primary" : "text-muted-foreground"
                    )}
                    onClick={() => {
                      if (index !== activeTabIndex) {
                        setActiveTab(index)
                      }
                    }}
                  >
                    <span className="truncate">{displayName}</span>
                    <button
                      className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        closePanel(panel.streamId)
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
            <SidePanelClose onClose={onClose} />
          </div>
        ) : (
          // Single panel header
          <>
            {isThread && stream ? (
              <ThreadHeader workspaceId={workspaceId} stream={stream} onBack={onClose} />
            ) : (
              <SidePanelTitle>{stream?.displayName || "Stream"}</SidePanelTitle>
            )}
            <SidePanelClose onClose={onClose} />
          </>
        )}
      </SidePanelHeader>

      {/* Breadcrumbs row (below tabs, when active panel is a thread) */}
      {showTabs && isThread && stream && (
        <div className="border-b bg-muted/20">
          <div className="px-4 py-2">
            <ThreadHeader workspaceId={workspaceId} stream={stream} onBack={onClose} />
          </div>
        </div>
      )}

      <SidePanelContent className="flex flex-col">
        <StreamErrorBoundary streamId={activeStreamId} queryError={error}>
          <StreamContent
            workspaceId={workspaceId}
            streamId={activeStreamId}
            highlightMessageId={highlightMessageId}
            stream={stream}
          />
        </StreamErrorBoundary>
      </SidePanelContent>
    </SidePanel>
  )
}
