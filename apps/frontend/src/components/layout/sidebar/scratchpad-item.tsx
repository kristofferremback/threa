import { useCallback, useRef, useState, type MouseEvent, type RefObject } from "react"
import { Archive, FileEdit, Settings } from "lucide-react"
import { Link } from "react-router-dom"
import { MentionIndicator } from "@/components/mention-indicator"
import { useActors, useStreamOrDraft } from "@/hooks"
import { useSidebar } from "@/contexts"
import { useStreamSettings } from "@/components/stream-settings/use-stream-settings"
import { useIsMobile } from "@/hooks/use-mobile"
import { useLongPress } from "@/hooks/use-long-press"
import { cn } from "@/lib/utils"
import { streamFallbackLabel } from "@/lib/streams"
import { useUrgencyTracking } from "./use-urgency-tracking"
import {
  SidebarActionDrawer,
  SidebarActionMenu,
  type SidebarActionItem,
  type SidebarActionPreview,
} from "./sidebar-actions"
import { UrgencyStrip, StreamItemAvatar, StreamItemPreview } from "./stream-item"
import { truncateContent } from "./utils"
import type { StreamItemData } from "./types"

interface ScratchpadItemProps {
  workspaceId: string
  stream: StreamItemData
  isActive: boolean
  unreadCount: number
  mentionCount: number
  showUrgencyStrip?: boolean
  compact?: boolean
  showPreviewOnHover?: boolean
  scrollContainerRef?: RefObject<HTMLDivElement | null>
}

export function ScratchpadItem({
  workspaceId,
  stream: streamWithPreview,
  isActive,
  unreadCount,
  mentionCount,
  showUrgencyStrip = true,
  compact = false,
  showPreviewOnHover = false,
  scrollContainerRef,
}: ScratchpadItemProps) {
  const { stream, isDraft, archive } = useStreamOrDraft(workspaceId, streamWithPreview.id)
  const { getActorName } = useActors(workspaceId)
  const { collapseOnMobile } = useSidebar()
  const { openStreamSettings } = useStreamSettings()
  const isMobile = useIsMobile()
  const itemRef = useRef<HTMLAnchorElement>(null)
  const preventNavigationUntilRef = useRef(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const hasUnread = unreadCount > 0

  const currentDisplayName = stream?.displayName ?? streamWithPreview.displayName ?? null
  const name = currentDisplayName || streamFallbackLabel("scratchpad", "sidebar")
  const preview = streamWithPreview.lastMessagePreview

  useUrgencyTracking(itemRef, streamWithPreview.id, streamWithPreview.urgency, scrollContainerRef)

  const handleArchive = async () => {
    await archive()
  }

  const actions: SidebarActionItem[] = [
    ...(!isDraft
      ? [
          {
            id: "settings",
            label: "Settings",
            icon: Settings,
            onSelect: () => openStreamSettings(streamWithPreview.id),
          } satisfies SidebarActionItem,
        ]
      : []),
    {
      id: "archive",
      label: isDraft ? "Delete" : "Archive",
      icon: Archive,
      onSelect: handleArchive,
      variant: "destructive",
      separatorBefore: !isDraft,
    },
  ]

  const drawerPreview: SidebarActionPreview | null =
    preview && preview.content
      ? {
          streamName: isDraft ? `${name} (draft)` : name,
          authorName: getActorName(preview.authorId, preview.authorType),
          content: truncateContent(preview.content, 140),
          createdAt: preview.createdAt,
        }
      : null

  const openDrawer = useCallback(() => {
    if (actions.length === 0) return
    preventNavigationUntilRef.current = Date.now() + 750
    setDrawerOpen(true)
  }, [actions.length])

  const longPress = useLongPress({
    onLongPress: openDrawer,
    enabled: isMobile && actions.length > 0,
  })

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      if (preventNavigationUntilRef.current > Date.now()) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      collapseOnMobile()
    },
    [collapseOnMobile]
  )

  return (
    <>
      <Link
        ref={itemRef}
        to={`/w/${workspaceId}/s/${streamWithPreview.id}`}
        onClick={handleClick}
        onTouchStart={isMobile ? longPress.handlers.onTouchStart : undefined}
        onTouchEnd={isMobile ? longPress.handlers.onTouchEnd : undefined}
        onTouchMove={isMobile ? longPress.handlers.onTouchMove : undefined}
        onContextMenu={isMobile ? longPress.handlers.onContextMenu : undefined}
        className={cn(
          "group relative flex items-stretch rounded-lg text-sm transition-colors",
          isActive ? "bg-primary/10" : "hover:bg-muted/50",
          hasUnread && !isActive && "bg-primary/5 hover:bg-primary/10",
          isMobile && actions.length > 0 && "select-none",
          longPress.isPressed && "opacity-70 transition-opacity duration-100"
        )}
      >
        {showUrgencyStrip && <UrgencyStrip urgency={streamWithPreview.urgency} />}

        <div className="flex items-center gap-2.5 flex-1 min-w-0 px-2 py-2">
          <StreamItemAvatar icon={<FileEdit className="h-3.5 w-3.5" />} className="bg-primary/10 text-primary" />

          <div className="flex flex-col flex-1 min-w-0 gap-0.5">
            <div className="flex items-center gap-2 pr-8">
              <span className={cn("truncate text-sm", hasUnread ? "font-semibold" : "font-medium")}>
                {name}
                {isDraft && <span className="ml-1.5 text-xs text-muted-foreground font-normal">(draft)</span>}
              </span>
              <MentionIndicator count={mentionCount} className="ml-auto" />
            </div>
            <StreamItemPreview
              preview={preview}
              getActorName={getActorName}
              compact={compact}
              showPreviewOnHover={showPreviewOnHover}
            />
          </div>
        </div>

        <SidebarActionMenu actions={actions} ariaLabel="Stream actions" />
      </Link>
      {isMobile && actions.length > 0 && (
        <SidebarActionDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          actions={actions}
          title={`Actions for ${name}`}
          description="Choose an action for this stream."
          preview={drawerPreview}
        />
      )}
    </>
  )
}
