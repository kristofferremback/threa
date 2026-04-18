import type { RefObject } from "react"
import type { CollapseState } from "@/contexts"
import { Button } from "@/components/ui/button"
import { SMART_SECTIONS } from "./config"
import { SmartSection, SplitStreamSection } from "./sections"
import type { StreamItemData } from "./types"

/** Rest subsection default state: collapsed so an open parent with lots of "quiet" items stays tight. */
const REST_DEFAULT: CollapseState = "collapsed"

/** Key for the "Rest" subsection of a parent section. */
function restKey(parent: string): string {
  return `${parent}:rest`
}

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
  toggleSectionState: (section: string, defaultState?: CollapseState) => void
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
  toggleSectionState,
  onCreateScratchpad,
  onCreateChannel,
  scrollContainerRef,
}: SidebarStreamListProps) {
  if (hasError) {
    return <p className="px-2 py-4 text-xs text-destructive text-center">Failed to load</p>
  }

  if (!hasUserStreams) {
    return (
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
  }

  if (viewMode === "smart") {
    return (
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
          onToggle={() => toggleSectionState("important")}
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
          onToggle={() => toggleSectionState("recent")}
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
          onToggle={() => toggleSectionState("pinned")}
          scrollContainerRef={scrollContainerRef}
        />
        {streamsBySection.other.length > 0 && (
          <SplitStreamSection
            sectionKey="other"
            label={SMART_SECTIONS.other.label}
            icon={SMART_SECTIONS.other.icon}
            items={streamsBySection.other}
            allStreams={processedStreams}
            workspaceId={workspaceId}
            activeStreamId={activeStreamId}
            getUnreadCount={getUnreadCount}
            getMentionCount={getMentionCount}
            state={getSectionState("other", "collapsed")}
            onToggle={() => toggleSectionState("other", "collapsed")}
            restState={getSectionState(restKey("other"), REST_DEFAULT)}
            onToggleRest={() => toggleSectionState(restKey("other"), REST_DEFAULT)}
            compact={SMART_SECTIONS.other.compact}
            showPreviewOnHover={SMART_SECTIONS.other.showPreviewOnHover}
            scrollContainerRef={scrollContainerRef}
          />
        )}
      </>
    )
  }

  return (
    <>
      <SplitStreamSection
        sectionKey="scratchpads"
        label="Scratchpads"
        items={streamsByType.scratchpads}
        allStreams={processedStreams}
        workspaceId={workspaceId}
        activeStreamId={activeStreamId}
        getUnreadCount={getUnreadCount}
        getMentionCount={getMentionCount}
        state={getSectionState("scratchpads")}
        onToggle={() => toggleSectionState("scratchpads")}
        restState={getSectionState(restKey("scratchpads"), REST_DEFAULT)}
        onToggleRest={() => toggleSectionState(restKey("scratchpads"), REST_DEFAULT)}
        scrollContainerRef={scrollContainerRef}
        onAdd={() => void onCreateScratchpad()}
        addTooltip="+ New Scratchpad"
        compact
        showPreviewOnHover
      />

      <SplitStreamSection
        sectionKey="channels"
        label="Channels"
        items={streamsByType.channels}
        allStreams={processedStreams}
        workspaceId={workspaceId}
        activeStreamId={activeStreamId}
        getUnreadCount={getUnreadCount}
        getMentionCount={getMentionCount}
        state={getSectionState("channels")}
        onToggle={() => toggleSectionState("channels")}
        restState={getSectionState(restKey("channels"), REST_DEFAULT)}
        onToggleRest={() => toggleSectionState(restKey("channels"), REST_DEFAULT)}
        scrollContainerRef={scrollContainerRef}
        onAdd={() => void onCreateChannel()}
        addTooltip="+ New Channel"
        compact
        showPreviewOnHover
      />

      {streamsByType.dms.length > 0 && (
        <SplitStreamSection
          sectionKey="dms"
          label="Direct Messages"
          items={streamsByType.dms}
          allStreams={processedStreams}
          workspaceId={workspaceId}
          activeStreamId={activeStreamId}
          getUnreadCount={getUnreadCount}
          getMentionCount={getMentionCount}
          state={getSectionState("dms")}
          onToggle={() => toggleSectionState("dms")}
          restState={getSectionState(restKey("dms"), REST_DEFAULT)}
          onToggleRest={() => toggleSectionState(restKey("dms"), REST_DEFAULT)}
          scrollContainerRef={scrollContainerRef}
          compact
          showPreviewOnHover
        />
      )}
    </>
  )
}
