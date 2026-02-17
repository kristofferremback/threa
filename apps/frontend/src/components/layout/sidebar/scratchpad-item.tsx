import { useRef, type RefObject } from "react"
import { Archive, FileEdit, Settings } from "lucide-react"
import { Link } from "react-router-dom"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { MentionIndicator } from "@/components/mention-indicator"
import { useActors, useStreamOrDraft } from "@/hooks"
import { useStreamSettings } from "@/components/stream-settings/use-stream-settings"
import { cn } from "@/lib/utils"
import { streamFallbackLabel } from "@/lib/streams"
import { useUrgencyTracking } from "./use-urgency-tracking"
import { UrgencyStrip, StreamItemAvatar, StreamItemPreview, StreamItemContextMenu } from "./stream-item"
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
  const { openStreamSettings } = useStreamSettings()
  const itemRef = useRef<HTMLAnchorElement>(null)
  const hasUnread = unreadCount > 0

  const currentDisplayName = stream?.displayName ?? streamWithPreview.displayName ?? null
  const name = currentDisplayName || streamFallbackLabel("scratchpad", "sidebar")
  const preview = streamWithPreview.lastMessagePreview

  useUrgencyTracking(itemRef, streamWithPreview.id, streamWithPreview.urgency, scrollContainerRef)

  const handleArchive = async () => {
    await archive()
  }

  return (
    <Link
      ref={itemRef}
      to={`/w/${workspaceId}/s/${streamWithPreview.id}`}
      className={cn(
        "group relative flex items-stretch rounded-lg text-sm transition-colors",
        isActive ? "bg-primary/10" : "hover:bg-muted/50",
        hasUnread && !isActive && "bg-primary/5 hover:bg-primary/10"
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

      <StreamItemContextMenu>
        {!isDraft && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              openStreamSettings(streamWithPreview.id)
            }}
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
        )}
        {!isDraft && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation()
            void handleArchive()
          }}
          className="text-destructive"
        >
          <Archive className="mr-2 h-4 w-4" />
          {isDraft ? "Delete" : "Archive"}
        </DropdownMenuItem>
      </StreamItemContextMenu>
    </Link>
  )
}
