import type { ReactNode, RefObject } from "react"
import { MessageSquare } from "lucide-react"
import {
  SidePanel,
  SidePanelHeader,
  SidePanelTitle,
  SidePanelClose,
  SidePanelContent,
} from "@/components/ui/side-panel"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { EventList } from "@/components/timeline"
import { ThreadParentMessage } from "./thread-parent-message"
import type { StreamEvent } from "@threa/types"

interface EmptyStateConfig {
  title: string
  description: string
}

interface ThreadPanelViewProps {
  workspaceId: string
  streamId: string
  title: string
  onClose: () => void

  /** Parent message to display at top (optional) */
  parentMessage?: StreamEvent
  parentStreamId?: string

  /** Events to display */
  events: StreamEvent[]
  replyCount: number
  isLoading: boolean

  /** Infinite scroll */
  isFetchingOlder?: boolean
  scrollContainerRef?: RefObject<HTMLDivElement | null>
  onScroll?: () => void

  /** Empty state configuration */
  emptyState: EmptyStateConfig

  /** Input component (MessageInput or MessageComposer) */
  inputSlot: ReactNode

  /** Error state */
  error?: Error | null
}

export function ThreadPanelView({
  workspaceId,
  streamId,
  title,
  onClose,
  parentMessage,
  parentStreamId,
  events,
  replyCount,
  isLoading,
  isFetchingOlder = false,
  scrollContainerRef,
  onScroll,
  emptyState,
  inputSlot,
  error,
}: ThreadPanelViewProps) {
  if (error) {
    return (
      <SidePanel>
        <SidePanelHeader>
          <SidePanelTitle>Thread</SidePanelTitle>
          <SidePanelClose onClose={onClose} />
        </SidePanelHeader>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-destructive">Failed to load thread</p>
        </div>
      </SidePanel>
    )
  }

  return (
    <SidePanel>
      <SidePanelHeader>
        <SidePanelTitle>{title}</SidePanelTitle>
        <SidePanelClose onClose={onClose} />
      </SidePanelHeader>
      <SidePanelContent className="flex flex-col">
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onScroll={onScroll}>
          {isFetchingOlder && (
            <div className="flex justify-center py-2">
              <p className="text-sm text-muted-foreground">Loading older messages...</p>
            </div>
          )}
          {parentMessage && parentStreamId && (
            <ThreadParentMessage
              event={parentMessage}
              workspaceId={workspaceId}
              streamId={parentStreamId}
              replyCount={replyCount}
            />
          )}
          {events.length === 0 && !isLoading ? (
            <Empty className="h-full border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquare />
                </EmptyMedia>
                <EmptyTitle>{emptyState.title}</EmptyTitle>
                <EmptyDescription>{emptyState.description}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <EventList events={events} isLoading={isLoading} workspaceId={workspaceId} streamId={streamId} />
          )}
        </div>
        {inputSlot}
      </SidePanelContent>
    </SidePanel>
  )
}
