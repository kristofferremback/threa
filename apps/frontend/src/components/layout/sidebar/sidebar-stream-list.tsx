import type { RefObject } from "react"
import type { CollapseState } from "@/contexts"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { SmartSection, StreamSection } from "./sections"
import type { StreamItemData } from "./types"

interface SidebarStreamListProps {
  workspaceId: string
  viewMode: "smart" | "all"
  isLoading: boolean
  hasError: boolean
  hasUserStreams: boolean
  activeStreamId?: string
  processedStreams: StreamItemData[]
  streamsBySection: {
    important: StreamItemData[]
    recent: StreamItemData[]
    pinned: StreamItemData[]
    other: StreamItemData[]
  }
  streamsByType: {
    scratchpads: StreamItemData[]
    channels: StreamItemData[]
    dms: StreamItemData[]
  }
  getUnreadCount: (streamId: string) => number
  getMentionCount: (streamId: string) => number
  getSectionState: (section: string, defaultState?: CollapseState) => CollapseState
  cycleSectionState: (section: string, defaultState?: CollapseState) => void
  setSectionState: (section: string, state: CollapseState) => void
  onCreateScratchpad: () => void | Promise<void>
  onCreateChannel: () => void | Promise<void>
  scrollContainerRef: RefObject<HTMLDivElement | null>
}

export function SidebarStreamList({
  workspaceId,
  viewMode,
  isLoading: _isLoading,
  hasError,
  hasUserStreams,
  activeStreamId,
  processedStreams,
  streamsBySection,
  streamsByType,
  getUnreadCount,
  getMentionCount,
  getSectionState,
  cycleSectionState,
  setSectionState,
  onCreateScratchpad,
  onCreateChannel,
  scrollContainerRef,
}: SidebarStreamListProps) {
  let content: React.ReactNode

  if (hasError) {
    content = <p className="px-2 py-4 text-xs text-destructive text-center">Failed to load</p>
  } else if (!hasUserStreams) {
    content = (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground mb-4">No streams yet</p>
        <Button variant="outline" size="sm" onClick={() => void onCreateScratchpad()} className="mr-2">
          + New Scratchpad
        </Button>
        <Button variant="outline" size="sm" onClick={() => void onCreateChannel()}>
          + New Channel
        </Button>
      </div>
    )
  } else if (viewMode === "smart") {
    content = (
      <>
        <SmartSection
          section="important"
          items={streamsBySection.important}
          allStreams={processedStreams}
          workspaceId={workspaceId}
          activeStreamId={activeStreamId}
          getUnreadCount={getUnreadCount}
          getMentionCount={getMentionCount}
          state={getSectionState("important")}
          onCycle={() => cycleSectionState("important")}
          scrollContainerRef={scrollContainerRef}
        />
        <SmartSection
          section="recent"
          items={streamsBySection.recent}
          allStreams={processedStreams}
          workspaceId={workspaceId}
          activeStreamId={activeStreamId}
          getUnreadCount={getUnreadCount}
          getMentionCount={getMentionCount}
          state={getSectionState("recent")}
          onCycle={() => cycleSectionState("recent")}
          scrollContainerRef={scrollContainerRef}
        />
        <SmartSection
          section="pinned"
          items={streamsBySection.pinned}
          allStreams={processedStreams}
          workspaceId={workspaceId}
          activeStreamId={activeStreamId}
          getUnreadCount={getUnreadCount}
          getMentionCount={getMentionCount}
          state={getSectionState("pinned")}
          onCycle={() => cycleSectionState("pinned")}
          scrollContainerRef={scrollContainerRef}
        />
        <SmartSection
          section="other"
          items={streamsBySection.other}
          allStreams={processedStreams}
          workspaceId={workspaceId}
          activeStreamId={activeStreamId}
          getUnreadCount={getUnreadCount}
          getMentionCount={getMentionCount}
          state={getSectionState("other", "collapsed")}
          onCycle={() => cycleSectionState("other", "collapsed")}
          onExpand={() => setSectionState("other", "open")}
          scrollContainerRef={scrollContainerRef}
        />
      </>
    )
  } else {
    content = (
      <>
        <StreamSection
          label="Scratchpads"
          items={streamsByType.scratchpads}
          allStreams={processedStreams}
          workspaceId={workspaceId}
          activeStreamId={activeStreamId}
          getUnreadCount={getUnreadCount}
          getMentionCount={getMentionCount}
          state={getSectionState("scratchpads")}
          onCycle={() => cycleSectionState("scratchpads")}
          scrollContainerRef={scrollContainerRef}
          onAdd={() => void onCreateScratchpad()}
          addTooltip="+ New Scratchpad"
          compact
          showPreviewOnHover
        />

        <StreamSection
          label="Channels"
          items={streamsByType.channels}
          allStreams={processedStreams}
          workspaceId={workspaceId}
          activeStreamId={activeStreamId}
          getUnreadCount={getUnreadCount}
          getMentionCount={getMentionCount}
          state={getSectionState("channels")}
          onCycle={() => cycleSectionState("channels")}
          scrollContainerRef={scrollContainerRef}
          onAdd={() => void onCreateChannel()}
          addTooltip="+ New Channel"
          compact
          showPreviewOnHover
        />

        {streamsByType.dms.length > 0 && (
          <StreamSection
            label="Direct Messages"
            items={streamsByType.dms}
            allStreams={processedStreams}
            workspaceId={workspaceId}
            activeStreamId={activeStreamId}
            getUnreadCount={getUnreadCount}
            getMentionCount={getMentionCount}
            state={getSectionState("dms")}
            onCycle={() => cycleSectionState("dms")}
            scrollContainerRef={scrollContainerRef}
            compact
            showPreviewOnHover
          />
        )}
      </>
    )
  }

  return (
    <ScrollArea className="h-full [&>div>div]:!block [&>div>div]:!w-full">
      <div ref={scrollContainerRef} className="p-2">
        {content}
      </div>
    </ScrollArea>
  )
}
