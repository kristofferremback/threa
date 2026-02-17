import { useRef, type ReactNode, type RefObject } from "react"
import { Archive, Bell, FileEdit, Hash, Lock, MessageSquareText, MoreHorizontal, Settings, User } from "lucide-react"
import { Link } from "react-router-dom"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { MentionIndicator } from "@/components/mention-indicator"
import { RelativeTime } from "@/components/relative-time"
import { getThreadRootContext } from "@/components/thread/breadcrumb-helpers"
import { useActors, useStreamOrDraft } from "@/hooks"
import { useSidebar } from "@/contexts"
import { useStreamSettings } from "@/components/stream-settings/use-stream-settings"
import { cn } from "@/lib/utils"
import { getStreamName, streamFallbackLabel } from "@/lib/streams"
import { BADGE_CONFIG, URGENCY_COLORS } from "./config"
import { useUrgencyTracking } from "./use-urgency-tracking"
import { truncateContent } from "./utils"
import { StreamTypes, Visibilities, type AuthorType, type StreamWithPreview } from "@threa/types"
import type { StreamItemData, UrgencyLevel } from "./types"

function UrgencyStrip({ urgency }: { urgency: UrgencyLevel }) {
  return (
    <div
      className="w-1 flex-shrink-0 rounded-l-lg transition-colors duration-300"
      style={{ backgroundColor: URGENCY_COLORS[urgency] }}
    />
  )
}

interface StreamItemAvatarProps {
  icon: ReactNode
  className: string
  badge?: { icon: typeof Hash; color: string } | null
}

function StreamItemAvatar({ icon, className, badge }: StreamItemAvatarProps) {
  return (
    <div
      className={cn(
        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 relative",
        badge ? "bg-muted" : className
      )}
    >
      {badge ? <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" /> : icon}
      {badge && (
        <div
          className={cn(
            "absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full bg-background border border-border flex items-center justify-center",
            badge.color
          )}
        >
          <badge.icon className="h-2 w-2" />
        </div>
      )}
    </div>
  )
}

interface StreamItemPreviewProps {
  preview: StreamWithPreview["lastMessagePreview"]
  getActorName: (actorId: string | null, actorType: AuthorType | null) => string
  compact: boolean
  showPreviewOnHover: boolean
}

function StreamItemPreview({ preview, getActorName, compact, showPreviewOnHover }: StreamItemPreviewProps) {
  if (!preview?.content) return null

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground",
        compact && !showPreviewOnHover && "hidden",
        compact && showPreviewOnHover && "hidden group-hover:flex"
      )}
    >
      <span className="truncate flex-1">
        {getActorName(preview.authorId, preview.authorType)}: {truncateContent(preview.content)}
      </span>
      <RelativeTime date={preview.createdAt} className="flex-shrink-0" />
    </div>
  )
}

function StreamItemContextMenu({ children }: { children: ReactNode }) {
  const { setMenuOpen } = useSidebar()

  return (
    <DropdownMenu onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1 h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface StreamItemProps {
  workspaceId: string
  stream: StreamItemData
  isActive: boolean
  unreadCount: number
  mentionCount: number
  allStreams: StreamItemData[]
  showUrgencyStrip?: boolean
  /** Show compact view (title only, no preview) */
  compact?: boolean
  /** Show preview on hover when compact (only works with compact=true) */
  showPreviewOnHover?: boolean
  /** Reference to scroll container for position tracking */
  scrollContainerRef?: RefObject<HTMLDivElement | null>
}

export function StreamItem({
  workspaceId,
  stream,
  isActive,
  unreadCount,
  mentionCount,
  allStreams,
  showUrgencyStrip = true,
  compact = false,
  showPreviewOnHover = false,
  scrollContainerRef,
}: StreamItemProps) {
  const { getActorName } = useActors(workspaceId)
  const { openStreamSettings } = useStreamSettings()
  const itemRef = useRef<HTMLAnchorElement>(null)
  const hasUnread = unreadCount > 0
  const preview = stream.lastMessagePreview

  useUrgencyTracking(itemRef, stream.id, stream.urgency, scrollContainerRef)

  // Determine avatar content based on stream type
  const getAvatar = () => {
    if (stream.type === StreamTypes.CHANNEL) {
      return {
        icon: <Hash className="h-3.5 w-3.5" />,
        className: "bg-muted text-[hsl(200_60%_50%)]",
      }
    }
    if (stream.type === StreamTypes.SCRATCHPAD) {
      return {
        icon: <FileEdit className="h-3.5 w-3.5" />,
        className: "bg-primary/10 text-primary",
      }
    }
    if (stream.type === StreamTypes.SYSTEM) {
      return {
        icon: <Bell className="h-3.5 w-3.5" />,
        className: "bg-blue-500/10 text-blue-500",
      }
    }
    if (stream.type === StreamTypes.THREAD) {
      return {
        icon: <MessageSquareText className="h-3.5 w-3.5" />,
        className: "bg-muted text-muted-foreground",
      }
    }
    // DM
    return {
      icon: <User className="h-3.5 w-3.5" />,
      className: "bg-muted text-muted-foreground",
    }
  }

  const avatar = getAvatar()
  const name = getStreamName(stream) ?? streamFallbackLabel(stream.type, "sidebar")

  const threadRootContext = stream.type === StreamTypes.THREAD ? getThreadRootContext(stream, allStreams) : null

  const threadBadge = (() => {
    if (stream.type !== StreamTypes.THREAD || !stream.rootStreamId) return null
    const rootStream = allStreams.find((s) => s.id === stream.rootStreamId)
    if (!rootStream?.type) return null
    const config = BADGE_CONFIG[rootStream.type]
    return config ?? null
  })()

  // For scratchpads, support renaming
  if (stream.type === StreamTypes.SCRATCHPAD) {
    return (
      <ScratchpadItem
        workspaceId={workspaceId}
        stream={stream}
        isActive={isActive}
        unreadCount={unreadCount}
        mentionCount={mentionCount}
        compact={compact}
        showPreviewOnHover={showPreviewOnHover}
        showUrgencyStrip={showUrgencyStrip}
        scrollContainerRef={scrollContainerRef}
      />
    )
  }

  return (
    <Link
      ref={itemRef}
      to={`/w/${workspaceId}/s/${stream.id}`}
      className={cn(
        "group relative flex items-stretch rounded-lg text-sm transition-colors",
        isActive ? "bg-primary/10" : "hover:bg-muted/50",
        hasUnread && !isActive && "bg-primary/5 hover:bg-primary/10"
      )}
    >
      {showUrgencyStrip && <UrgencyStrip urgency={stream.urgency} />}

      <div className="flex items-center gap-2.5 flex-1 min-w-0 px-2 py-2">
        <StreamItemAvatar icon={avatar.icon} className={avatar.className} badge={threadBadge} />

        <div className="flex flex-col flex-1 min-w-0 gap-0.5">
          <div className="flex items-center gap-2 pr-8">
            <span className={cn("truncate text-sm", hasUnread ? "font-semibold" : "font-medium")}>
              {name}
              {threadRootContext && (
                <span className="font-normal text-muted-foreground/60 text-xs"> · {threadRootContext}</span>
              )}
            </span>
            {stream.type === StreamTypes.CHANNEL && stream.visibility === Visibilities.PRIVATE && (
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            )}
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
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation()
            openStreamSettings(stream.id)
          }}
        >
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
      </StreamItemContextMenu>
    </Link>
  )
}

interface ScratchpadItemProps {
  workspaceId: string
  stream: StreamItemData
  isActive: boolean
  unreadCount: number
  mentionCount: number
  showUrgencyStrip?: boolean
  /** Show compact view (title only, no preview) */
  compact?: boolean
  /** Show preview on hover when compact (only works with compact=true) */
  showPreviewOnHover?: boolean
  /** Reference to scroll container for position tracking */
  scrollContainerRef?: RefObject<HTMLDivElement | null>
}

function ScratchpadItem({
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
