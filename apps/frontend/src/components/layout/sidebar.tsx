import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, type ReactNode } from "react"
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom"
import {
  MoreHorizontal,
  Pencil,
  Archive,
  Search as SearchIcon,
  FileEdit,
  DollarSign,
  Settings,
  RefreshCw,
  Hash,
  User,
  MessageSquareText,
  Plus,
  ChevronRight,
  Bell,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { serializeToMarkdown } from "@threa/prosemirror"
import type { JSONContent } from "@threa/types"
import { getThreadDisplayName, getThreadRootContext } from "@/components/thread/breadcrumb-helpers"
import {
  useWorkspaceBootstrap,
  useCreateStream,
  useDraftScratchpads,
  useStreamOrDraft,
  useUnreadCounts,
  useMentionCounts,
  useAllDrafts,
  workspaceKeys,
  useActors,
} from "@/hooks"
import { useQuickSwitcher, useCoordinatedLoading, useSidebar, type ViewMode } from "@/contexts"
import { UnreadBadge } from "@/components/unread-badge"
import { MentionIndicator } from "@/components/mention-indicator"
import { RelativeTime } from "@/components/relative-time"
import { StreamTypes, AuthorTypes, type AuthorType, type StreamWithPreview } from "@threa/types"
import { useQueryClient } from "@tanstack/react-query"
import { ThemeDropdown } from "@/components/theme-dropdown"
import { ThreaLogo } from "@/components/threa-logo"

// ============================================================================
// Types & Constants
// ============================================================================

type UrgencyLevel = "mentions" | "activity" | "quiet" | "ai"

/** Sorting strategies for sidebar sections */
type SortType = "activity" | "importance" | "alphabetic_active_first"

interface StreamItemData extends StreamWithPreview {
  urgency: UrgencyLevel
  section: SectionKey
}

const URGENCY_COLORS = {
  mentions: "hsl(0 90% 55%)", // Vibrant red
  activity: "hsl(210 100% 55%)", // Bright blue
  quiet: "transparent", // Hidden when no activity
  ai: "hsl(45 100% 50%)", // Bright gold/amber
} as const

const BADGE_CONFIG: Record<string, { icon: typeof Hash; color: string }> = {
  channel: { icon: Hash, color: "text-[hsl(200_60%_50%)]" },
  scratchpad: { icon: FileEdit, color: "text-primary" },
  dm: { icon: User, color: "text-muted-foreground" },
}

/** Smart view section configuration - single source of truth for section behavior */
const SMART_SECTIONS = {
  important: {
    label: "Important",
    icon: "⚡",
    compact: false, // Shows full preview always
    showPreviewOnHover: false,
    showCollapsedHint: false,
    sortType: "importance" as SortType,
  },
  recent: {
    label: "Recent",
    icon: "🕐",
    compact: true,
    showPreviewOnHover: true,
    showCollapsedHint: false,
    sortType: "activity" as SortType,
  },
  pinned: {
    label: "Pinned",
    icon: "📌",
    compact: true,
    showPreviewOnHover: true,
    showCollapsedHint: false,
    sortType: "activity" as SortType,
  },
  other: {
    label: "Everything Else",
    icon: "📂",
    compact: true,
    showPreviewOnHover: true,
    showCollapsedHint: true,
    sortType: "activity" as SortType,
  },
} as const

type SectionKey = keyof typeof SMART_SECTIONS

/** All view section configuration */
const ALL_SECTIONS = {
  scratchpads: { sortType: "activity" as SortType },
  channels: { sortType: "alphabetic_active_first" as SortType },
  dms: { sortType: "alphabetic_active_first" as SortType },
} as const

// ============================================================================
// Helper Functions
// ============================================================================

/** Calculate urgency level for a stream based on unread and mention state */
function calculateUrgency(
  stream: StreamWithPreview,
  unreadCount: number,
  mentionCount: number,
  isMuted: boolean
): UrgencyLevel {
  if (isMuted) return "quiet"

  if (mentionCount > 0) return "mentions"

  if (stream.lastMessagePreview?.authorType === AuthorTypes.PERSONA && unreadCount > 0) {
    return "ai"
  }

  if (unreadCount > 0) return "activity"

  return "quiet"
}

/** Categorize stream into smart section */
function categorizeStream(stream: StreamWithPreview, unreadCount: number, urgency: UrgencyLevel): SectionKey {
  // TODO: Add pinned support when backend implements it
  // if (stream.isPinned && unreadCount > 0) return "important"
  // if (stream.isPinned) return "pinned"

  // Important: mentions or AI activity with unread
  if (urgency === "mentions" || (urgency === "ai" && unreadCount > 0)) {
    return "important"
  }

  // Recent: activity in last 7 days
  if (stream.lastMessagePreview) {
    const diff = Date.now() - new Date(stream.lastMessagePreview.createdAt).getTime()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    if (diff < sevenDays) {
      return "recent"
    }
  }

  return "other"
}

/** Truncate content for preview display. Accepts either JSONContent or plain markdown string. */
function truncateContent(content: JSONContent | string, maxLength: number = 50): string {
  // Handle plain markdown string (from socket events) vs JSONContent (from database)
  const markdown = typeof content === "string" ? content : serializeToMarkdown(content)
  const stripped = markdown
    .replace(/[*_~`#]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim()
  return stripped.length > maxLength ? stripped.slice(0, maxLength) + "..." : stripped
}

/** Get display name for sorting (handles channels, scratchpads, DMs) */
function getStreamSortName(stream: StreamWithPreview): string {
  return (stream.slug ?? stream.displayName ?? "").toLowerCase()
}

/** Get activity timestamp for sorting (most recent message or creation) */
function getActivityTime(stream: StreamWithPreview): number {
  const timestamp = stream.lastMessagePreview?.createdAt ?? stream.createdAt
  return new Date(timestamp).getTime()
}

/**
 * Sort streams by the specified sort type.
 * @param streams - Array of streams to sort (mutates in place for efficiency)
 * @param sortType - Sorting strategy to use
 * @param getUnreadCount - Function to get unread count for a stream
 */
function sortStreams(
  streams: StreamItemData[],
  sortType: SortType,
  getUnreadCount: (streamId: string) => number
): StreamItemData[] {
  switch (sortType) {
    case "activity":
      // Most recent activity first
      return streams.sort((a, b) => getActivityTime(b) - getActivityTime(a))

    case "importance":
      // Mentions first, then AI activity, then by unread count
      return streams.sort((a, b) => {
        if (a.urgency === "mentions" && b.urgency !== "mentions") return -1
        if (a.urgency !== "mentions" && b.urgency === "mentions") return 1
        if (a.urgency === "ai" && b.urgency !== "ai") return -1
        if (a.urgency !== "ai" && b.urgency === "ai") return 1
        return getUnreadCount(b.id) - getUnreadCount(a.id)
      })

    case "alphabetic_active_first":
      // Unreads first (sorted alphabetically), then reads (sorted alphabetically)
      return streams.sort((a, b) => {
        const aUnread = getUnreadCount(a.id) > 0
        const bUnread = getUnreadCount(b.id) > 0
        if (aUnread && !bUnread) return -1
        if (!aUnread && bUnread) return 1
        return getStreamSortName(a).localeCompare(getStreamSortName(b))
      })

    default:
      return streams
  }
}

// ============================================================================
// Hooks
// ============================================================================

/** Track item position for collapsed urgency strip */
function useUrgencyTracking(
  itemRef: React.RefObject<HTMLAnchorElement | null>,
  streamId: string,
  urgency: UrgencyLevel,
  scrollContainerRef: React.RefObject<HTMLDivElement | null> | undefined
) {
  const { setUrgencyBlock, sidebarHeight, scrollContainerOffset } = useSidebar()

  useLayoutEffect(() => {
    const el = itemRef.current
    const container = scrollContainerRef?.current
    if (!el || !container || sidebarHeight === 0) return

    if (urgency === "quiet") {
      setUrgencyBlock(streamId, null)
      return
    }

    const position = (scrollContainerOffset + el.offsetTop) / sidebarHeight
    const height = el.offsetHeight / sidebarHeight

    setUrgencyBlock(streamId, {
      position,
      height,
      color: URGENCY_COLORS[urgency],
    })

    return () => setUrgencyBlock(streamId, null)
  }, [streamId, urgency, scrollContainerRef, sidebarHeight, scrollContainerOffset, setUrgencyBlock, itemRef])
}

// ============================================================================
// Stream Item Sub-Components
// ============================================================================

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
  return (
    <DropdownMenu>
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

// ============================================================================
// Header Component
// ============================================================================

interface SidebarHeaderProps {
  workspaceName: string
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  /** Hide the view toggle (e.g., when no streams exist) */
  hideViewToggle?: boolean
}

function SidebarHeader({ workspaceName, viewMode, onViewModeChange, hideViewToggle }: SidebarHeaderProps) {
  const { openSwitcher } = useQuickSwitcher()

  return (
    <div className="flex-shrink-0 border-b px-4 py-3">
      {/* Logo + workspace name + actions */}
      <div className="flex items-center justify-between mb-3">
        <Link to="/workspaces" className="flex items-center gap-2 hover:opacity-80 transition-opacity truncate">
          <ThreaLogo size="sm" />
          <span className="font-semibold text-sm truncate">{workspaceName}</span>
        </Link>
        <ThemeDropdown />
      </div>

      {/* Search box */}
      <button
        onClick={() => openSwitcher("search")}
        className="w-full flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <SearchIcon className="h-3.5 w-3.5" />
        <span>Search messages</span>
      </button>

      {/* View toggle - hidden when no streams */}
      {!hideViewToggle && (
        <div className="flex items-center gap-2 mt-3">
          <div className="flex gap-1 bg-muted rounded-md p-0.5">
            <button
              onClick={() => onViewModeChange("smart")}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium transition-all",
                viewMode === "smart" ? "bg-card text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Smart
            </button>
            <button
              onClick={() => onViewModeChange("all")}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium transition-all",
                viewMode === "all" ? "bg-card text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              All
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Section Components (unified for Smart and All views)
// ============================================================================

interface SectionHeaderProps {
  label: string
  icon?: string
  /** Total unread count for the section (sum of all item unreads) */
  unreadCount?: number
  /** Whether the section is currently collapsed */
  isCollapsed?: boolean
  /** Toggle callback - if provided, section becomes collapsible */
  onToggle?: () => void
  /** Add button callback - shows plus icon on hover */
  onAdd?: () => void
  /** Tooltip for add button */
  addTooltip?: string
}

/** Section header with consistent styling across all views */
function SectionHeader({ label, icon, unreadCount, isCollapsed, onToggle, onAdd, addTooltip }: SectionHeaderProps) {
  const isCollapsible = !!onToggle

  const headingContent = (
    <div className="flex items-center gap-1.5">
      {isCollapsible && (
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            !isCollapsed && "rotate-90"
          )}
        />
      )}
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground m-0">
        {icon && `${icon} `}
        {label}
      </h3>
    </div>
  )

  const rightContent = (
    <div className="flex items-center gap-1">
      {unreadCount !== undefined && unreadCount > 0 && (
        <span className="px-2 py-0.5 bg-muted rounded-full text-[10px]">{unreadCount}</span>
      )}
      {onAdd && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}
          className="h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover/section:opacity-100 hover:bg-muted transition-all"
          title={addTooltip}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )

  if (isCollapsible) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggle()
          }
        }}
        className={cn(
          "group/section w-full flex items-center justify-between px-3 py-2 rounded-md cursor-pointer",
          "hover:bg-muted/50 transition-colors"
        )}
      >
        {headingContent}
        {rightContent}
      </div>
    )
  }

  return (
    <div className="group/section px-3 py-2 flex items-center justify-between">
      {headingContent}
      {rightContent}
    </div>
  )
}

interface StreamSectionProps {
  label: string
  icon?: string
  items: StreamItemData[]
  allStreams: StreamItemData[]
  workspaceId: string
  activeStreamId?: string
  getUnreadCount: (streamId: string) => number
  getMentionCount: (streamId: string) => number
  isCollapsed?: boolean
  onToggle?: () => void
  showCollapsedHint?: boolean
  action?: ReactNode
  /** Show compact view (title only, no preview) */
  compact?: boolean
  /** Show preview on hover when compact (only works with compact=true) */
  showPreviewOnHover?: boolean
  /** Reference to scroll container for position tracking */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  /** Add button callback - shows plus icon in header */
  onAdd?: () => void
  /** Tooltip for add button */
  addTooltip?: string
}

/** Stream section that composes SectionHeader + items + optional action */
function StreamSection({
  label,
  icon,
  items,
  allStreams,
  workspaceId,
  activeStreamId,
  getUnreadCount,
  getMentionCount,
  isCollapsed = false,
  onToggle,
  showCollapsedHint = false,
  action,
  compact = false,
  showPreviewOnHover = false,
  scrollContainerRef,
  onAdd,
  addTooltip,
}: StreamSectionProps) {
  // Sum up unread counts for all items in this section
  const totalUnreadCount = items.reduce((sum, item) => sum + getUnreadCount(item.id), 0)

  return (
    <div className="mb-4">
      <SectionHeader
        label={label}
        icon={icon}
        unreadCount={totalUnreadCount}
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        onAdd={onAdd}
        addTooltip={addTooltip}
      />

      {/* Section items */}
      {!isCollapsed && (
        <div className="mt-1 flex flex-col gap-0.5">
          {items.map((stream) => (
            <StreamItem
              key={stream.id}
              workspaceId={workspaceId}
              stream={stream}
              isActive={stream.id === activeStreamId}
              unreadCount={getUnreadCount(stream.id)}
              mentionCount={getMentionCount(stream.id)}
              allStreams={allStreams}
              compact={compact}
              showPreviewOnHover={showPreviewOnHover}
              scrollContainerRef={scrollContainerRef}
            />
          ))}
        </div>
      )}

      {/* Collapsed hint for "Everything Else" style sections */}
      {showCollapsedHint && isCollapsed && items.length > 0 && (
        <div className="mx-3 mt-1 px-3 py-2 rounded-md bg-muted/30 border border-dashed border-border/50">
          <p className="text-center text-xs text-muted-foreground">
            {items.length} more stream{items.length !== 1 ? "s" : ""} — click to expand or use{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">⌘K</kbd>
          </p>
        </div>
      )}

      {/* Optional action (like "+ New Scratchpad" button) */}
      {!isCollapsed && action}
    </div>
  )
}

interface SmartSectionProps {
  section: SectionKey
  items: StreamItemData[]
  allStreams: StreamItemData[]
  workspaceId: string
  activeStreamId?: string
  getUnreadCount: (streamId: string) => number
  getMentionCount: (streamId: string) => number
  isCollapsed?: boolean
  onToggle?: () => void
  /** Reference to scroll container for position tracking */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
}

/** Smart view section wrapper - uses StreamSection with config-driven settings */
function SmartSection({
  section,
  items,
  allStreams,
  workspaceId,
  activeStreamId,
  getUnreadCount,
  getMentionCount,
  isCollapsed = false,
  onToggle,
  scrollContainerRef,
}: SmartSectionProps) {
  const config = SMART_SECTIONS[section]

  // Hide empty sections
  if (items.length === 0) return null

  return (
    <StreamSection
      label={config.label}
      icon={config.icon}
      items={items}
      allStreams={allStreams}
      workspaceId={workspaceId}
      activeStreamId={activeStreamId}
      getUnreadCount={getUnreadCount}
      getMentionCount={getMentionCount}
      isCollapsed={isCollapsed}
      onToggle={onToggle}
      showCollapsedHint={config.showCollapsedHint}
      compact={config.compact}
      showPreviewOnHover={config.showPreviewOnHover}
      scrollContainerRef={scrollContainerRef}
    />
  )
}

// ============================================================================
// Stream Item Component
// ============================================================================

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
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
}

function StreamItem({
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
  const name =
    stream.type === StreamTypes.THREAD
      ? getThreadDisplayName(stream)
      : stream.slug
        ? `#${stream.slug}`
        : stream.displayName || "Untitled"

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
        <DropdownMenuItem disabled className="text-muted-foreground">
          <Pencil className="mr-2 h-4 w-4" />
          Settings (coming soon)
        </DropdownMenuItem>
      </StreamItemContextMenu>
    </Link>
  )
}

// ============================================================================
// Scratchpad Item Component (supports renaming)
// ============================================================================

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
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
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
  const { stream, isDraft, rename, archive } = useStreamOrDraft(workspaceId, streamWithPreview.id)
  const { getActorName } = useActors(workspaceId)
  const itemRef = useRef<HTMLAnchorElement>(null)
  const hasUnread = unreadCount > 0
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const currentDisplayName = stream?.displayName ?? streamWithPreview.displayName ?? null
  const name = currentDisplayName || "New scratchpad"
  const preview = streamWithPreview.lastMessagePreview

  useUrgencyTracking(itemRef, streamWithPreview.id, streamWithPreview.urgency, scrollContainerRef)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartRename = () => {
    setEditValue(currentDisplayName || "")
    setIsEditing(true)
  }

  const handleSaveRename = async () => {
    const trimmed = editValue.trim()
    setIsEditing(false)
    if (!trimmed || trimmed === currentDisplayName) return
    await rename(trimmed)
  }

  const handleArchive = async () => {
    await archive()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveRename()
    } else if (e.key === "Escape") {
      setIsEditing(false)
    }
  }

  if (isEditing) {
    return (
      <div className="px-1">
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSaveRename}
          onKeyDown={handleKeyDown}
          className="h-8 text-sm"
          placeholder="Scratchpad name"
        />
      </div>
    )
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
        <DropdownMenuItem
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleStartRename()
          }}
        >
          <Pencil className="mr-2 h-4 w-4" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleArchive()
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

// ============================================================================
// Shell - defines structural layout
// ============================================================================

interface SidebarShellProps {
  header: ReactNode
  quickLinks: ReactNode
  streamList: ReactNode
  footer?: ReactNode
  /** Ref for measuring sidebar dimensions */
  sidebarRef?: React.RefObject<HTMLDivElement | null>
}

/**
 * Sidebar structural shell.
 * Note: Collapsed state is handled by app-shell.tsx which clips the sidebar to 6px.
 * This component just renders content - no need to react to collapse state.
 */
export function SidebarShell({ header, quickLinks, streamList, footer, sidebarRef }: SidebarShellProps) {
  return (
    <div ref={sidebarRef} className="relative flex h-full flex-col">
      {/* Header */}
      <div>{header}</div>

      {/* Quick links (Drafts, Threads) */}
      <div className="border-b px-2 py-2">{quickLinks}</div>

      {/* Body with scrollable content */}
      <div className="flex-1 overflow-hidden">{streamList}</div>

      {/* Footer */}
      {footer && <div className="border-t px-2 py-2">{footer}</div>}
    </div>
  )
}

// ============================================================================
// Skeleton components
// ============================================================================

function HeaderSkeleton() {
  return (
    <div className="flex-shrink-0 border-b px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-9 w-full rounded-lg" />
      <div className="flex items-center gap-2 mt-3">
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
    </div>
  )
}

function QuickLinksSkeleton() {
  return (
    <div className="space-y-1">
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  )
}

function StreamListSkeleton() {
  return (
    <div className="flex-1 p-2">
      <div className="mb-4">
        <Skeleton className="mb-2 h-6 w-28 px-3" />
        <div className="space-y-1">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
      <div>
        <Skeleton className="mb-2 h-6 w-20 px-3" />
        <div className="space-y-1">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Footer Component
// ============================================================================

function SidebarFooter({ workspaceId }: { workspaceId: string }) {
  const [searchParams, setSearchParams] = useSearchParams()

  const openWorkspaceSettings = () => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set("ws-settings", "members")
    setSearchParams(newParams, { replace: true })
  }

  return (
    <div className="space-y-1">
      <button
        onClick={openWorkspaceSettings}
        className={cn(
          "w-full flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
          "hover:bg-muted/50 text-muted-foreground"
        )}
      >
        <Settings className="h-4 w-4" />
        Settings
      </button>
      <Link
        to={`/w/${workspaceId}/admin/ai-usage`}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
          "hover:bg-muted/50 text-muted-foreground"
        )}
      >
        <DollarSign className="h-4 w-4" />
        AI Usage
      </Link>
    </div>
  )
}

// ============================================================================
// Main Sidebar Component
// ============================================================================

interface SidebarProps {
  workspaceId: string
}

export function Sidebar({ workspaceId }: SidebarProps) {
  const { phase } = useCoordinatedLoading()
  const {
    viewMode,
    setViewMode,
    collapsedSections,
    toggleSectionCollapsed,
    setSidebarHeight,
    setScrollContainerOffset,
  } = useSidebar()
  const { streamId: activeStreamId, "*": splat } = useParams<{ streamId: string; "*": string }>()
  const { data: bootstrap, isLoading, error, retryBootstrap } = useWorkspaceBootstrap(workspaceId)
  const createStream = useCreateStream(workspaceId)
  const { createDraft } = useDraftScratchpads(workspaceId)
  const { getUnreadCount } = useUnreadCounts(workspaceId)
  const { getMentionCount, unreadActivityCount } = useMentionCounts(workspaceId)
  const { drafts: allDrafts } = useAllDrafts(workspaceId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const draftCount = allDrafts.length
  const isDraftsPage = splat === "drafts" || window.location.pathname.endsWith("/drafts")
  const isActivityPage = splat === "activity" || window.location.pathname.endsWith("/activity")

  // Build set of streams the user is a member of (for filtering public channels)
  const memberStreamIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of bootstrap?.streamMemberships ?? []) ids.add(m.streamId)
    return ids
  }, [bootstrap?.streamMemberships])

  // Build set of muted streams (for suppressing unread badges)
  const mutedStreamIdSet = useMemo(() => new Set(bootstrap?.mutedStreamIds ?? []), [bootstrap?.mutedStreamIds])

  // Process streams into enriched data with urgency and section
  const processedStreams = useMemo(() => {
    if (!bootstrap?.streams) return []

    return bootstrap.streams
      .filter((stream) => {
        // Non-public streams always appear (bootstrap only includes them if user has access)
        if (stream.visibility !== "public") return true
        // Public channels: only show if user is a member
        return memberStreamIds.has(stream.id)
      })
      .map((stream): StreamItemData => {
        const unreadCount = getUnreadCount(stream.id)
        const mentionCount = getMentionCount(stream.id)
        const isMuted = mutedStreamIdSet.has(stream.id)
        const urgency = calculateUrgency(stream, unreadCount, mentionCount, isMuted)
        const section = categorizeStream(stream, unreadCount, urgency)

        return {
          ...stream,
          urgency,
          section,
        }
      })
  }, [bootstrap?.streams, memberStreamIds, mutedStreamIdSet, getUnreadCount, getMentionCount])

  // System streams are auto-created infrastructure — don't count toward "has content"
  const hasUserStreams = processedStreams.some((s) => s.type !== StreamTypes.SYSTEM)

  // Organize streams by section
  const streamsBySection = useMemo(() => {
    const important: StreamItemData[] = []
    const recentCandidates: StreamItemData[] = [] // All streams that could go in Recent
    const pinned: StreamItemData[] = []
    const other: StreamItemData[] = []

    for (const stream of processedStreams) {
      switch (stream.section) {
        case "important":
          important.push(stream)
          break
        case "recent":
          recentCandidates.push(stream)
          break
        case "pinned":
          pinned.push(stream)
          break
        case "other":
          other.push(stream)
          break
      }
    }

    // Sort each section using configured sort types
    sortStreams(important, SMART_SECTIONS.important.sortType, getUnreadCount)
    sortStreams(pinned, SMART_SECTIONS.pinned.sortType, getUnreadCount)
    sortStreams(other, SMART_SECTIONS.other.sortType, getUnreadCount)

    // Recent section: special filtering logic
    // Show unreads OR up to 5 most recent (excluding items already in Important)
    // - If no unreads: show at most 5 recent streams
    // - If <5 unreads: show unreads + remaining reads up to 5 total
    // - If ≥5 unreads: show all unreads
    sortStreams(recentCandidates, SMART_SECTIONS.recent.sortType, getUnreadCount)

    const recentUnreads = recentCandidates.filter((s) => getUnreadCount(s.id) > 0)
    const recentReads = recentCandidates.filter((s) => getUnreadCount(s.id) === 0)

    let recent: StreamItemData[]
    if (recentUnreads.length >= 5) {
      // Show all unreads when there are 5 or more
      recent = recentUnreads
    } else {
      // Show unreads + fill remaining slots with reads (up to 5 total)
      const remainingSlots = 5 - recentUnreads.length
      recent = [...recentUnreads, ...recentReads.slice(0, remainingSlots)]
    }

    // Limit Important to 10
    return {
      important: important.slice(0, 10),
      recent,
      pinned,
      other,
    }
  }, [processedStreams, getUnreadCount])

  // Organize streams by type for "All" view
  const streamsByType = useMemo(() => {
    const scratchpads: StreamItemData[] = []
    const channels: StreamItemData[] = []
    const dms: StreamItemData[] = []

    for (const stream of processedStreams) {
      if (stream.type === StreamTypes.SCRATCHPAD) {
        scratchpads.push(stream)
      } else if (stream.type === StreamTypes.CHANNEL) {
        channels.push(stream)
      } else if (stream.type === StreamTypes.DM || stream.type === StreamTypes.SYSTEM) {
        dms.push(stream)
      }
      // Note: threads are not shown in All view
    }

    // Sort each section using configured sort types
    sortStreams(scratchpads, ALL_SECTIONS.scratchpads.sortType, getUnreadCount)
    sortStreams(channels, ALL_SECTIONS.channels.sortType, getUnreadCount)
    sortStreams(dms, ALL_SECTIONS.dms.sortType, getUnreadCount)

    return { scratchpads, channels, dms }
  }, [processedStreams, getUnreadCount])

  const isSectionCollapsed = useCallback((section: string) => collapsedSections.includes(section), [collapsedSections])

  // Track sidebar and scroll container dimensions for position calculations
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollContainerRef.current
    const sidebar = sidebarRef.current
    if (!container || !sidebar) return

    const updateDimensions = () => {
      // Get sidebar total height
      setSidebarHeight(sidebar.offsetHeight)

      // Calculate scroll container offset from sidebar top
      // This accounts for header + quick links sections
      const containerRect = container.getBoundingClientRect()
      const sidebarRect = sidebar.getBoundingClientRect()
      setScrollContainerOffset(containerRect.top - sidebarRect.top)
    }

    // Initial measurement
    updateDimensions()

    // Observe size changes on both elements
    const observer = new ResizeObserver(updateDimensions)
    observer.observe(container)
    observer.observe(sidebar)

    return () => observer.disconnect()
  }, [setSidebarHeight, setScrollContainerOffset])

  // During initial coordinated loading, show skeleton
  if (phase !== "ready") {
    return (
      <SidebarShell
        header={<HeaderSkeleton />}
        quickLinks={<QuickLinksSkeleton />}
        streamList={<StreamListSkeleton />}
      />
    )
  }

  // Show error state with retry button
  if (error && !bootstrap) {
    return (
      <SidebarShell
        header={<HeaderSkeleton />}
        quickLinks={null}
        streamList={
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <p className="text-sm text-muted-foreground mb-3">Failed to load workspace</p>
            <Button variant="outline" size="sm" onClick={retryBootstrap} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        }
      />
    )
  }

  const handleCreateScratchpad = async () => {
    const draftId = await createDraft("on")
    navigate(`/w/${workspaceId}/s/${draftId}`)
  }

  const handleCreateChannel = async () => {
    const name = prompt("Channel name:")
    if (!name?.trim()) return
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    if (!slug) return

    const stream = await createStream.mutateAsync({ type: StreamTypes.CHANNEL, slug })
    queryClient.invalidateQueries({ queryKey: workspaceKeys.bootstrap(workspaceId) })
    navigate(`/w/${workspaceId}/s/${stream.id}`)
  }

  return (
    <SidebarShell
      sidebarRef={sidebarRef}
      header={
        <SidebarHeader
          workspaceName={bootstrap?.workspace.name ?? "Loading..."}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          hideViewToggle={!hasUserStreams}
        />
      }
      quickLinks={
        <div className="space-y-1">
          <Link
            to={`/w/${workspaceId}/drafts`}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              isDraftsPage ? "bg-primary/10" : "hover:bg-muted/50",
              !isDraftsPage && draftCount === 0 && "text-muted-foreground"
            )}
          >
            <FileEdit className="h-4 w-4" />
            Drafts
            {draftCount > 0 && <span className="ml-auto text-xs text-muted-foreground">({draftCount})</span>}
          </Link>
          <Link
            to={`/w/${workspaceId}/threads`}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              "hover:bg-muted/50 text-muted-foreground"
            )}
          >
            <MessageSquareText className="h-4 w-4" />
            Threads
          </Link>
          <Link
            to={`/w/${workspaceId}/activity`}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              isActivityPage ? "bg-primary/10" : "hover:bg-muted/50",
              !isActivityPage && unreadActivityCount === 0 && "text-muted-foreground"
            )}
          >
            <Bell className="h-4 w-4" />
            Activity
            {unreadActivityCount > 0 && <UnreadBadge count={unreadActivityCount} className="ml-auto" />}
          </Link>
        </div>
      }
      streamList={
        <ScrollArea className="h-full [&>div>div]:!block [&>div>div]:!w-full">
          <div ref={scrollContainerRef} className="p-2">
            {isLoading ? (
              <p className="px-2 py-4 text-xs text-muted-foreground text-center">Loading...</p>
            ) : error ? (
              <p className="px-2 py-4 text-xs text-destructive text-center">Failed to load</p>
            ) : !hasUserStreams ? (
              /* Empty state - shown in both views when no streams */
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground mb-4">No streams yet</p>
                <Button variant="outline" size="sm" onClick={handleCreateScratchpad} className="mr-2">
                  + New Scratchpad
                </Button>
                <Button variant="outline" size="sm" onClick={handleCreateChannel}>
                  + New Channel
                </Button>
              </div>
            ) : viewMode === "smart" ? (
              <>
                {/* Smart View */}
                <SmartSection
                  section="important"
                  items={streamsBySection.important}
                  allStreams={processedStreams}
                  workspaceId={workspaceId}
                  activeStreamId={activeStreamId}
                  getUnreadCount={getUnreadCount}
                  getMentionCount={getMentionCount}
                  isCollapsed={isSectionCollapsed("important")}
                  onToggle={() => toggleSectionCollapsed("important")}
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
                  isCollapsed={isSectionCollapsed("recent")}
                  onToggle={() => toggleSectionCollapsed("recent")}
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
                  isCollapsed={isSectionCollapsed("pinned")}
                  onToggle={() => toggleSectionCollapsed("pinned")}
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
                  isCollapsed={isSectionCollapsed("other")}
                  onToggle={() => toggleSectionCollapsed("other")}
                  scrollContainerRef={scrollContainerRef}
                />
              </>
            ) : (
              <>
                {/* All View - Always compact (no previews), show section headers with plus buttons */}
                <StreamSection
                  label="Scratchpads"
                  items={streamsByType.scratchpads}
                  allStreams={processedStreams}
                  workspaceId={workspaceId}
                  activeStreamId={activeStreamId}
                  getUnreadCount={getUnreadCount}
                  getMentionCount={getMentionCount}
                  isCollapsed={isSectionCollapsed("scratchpads")}
                  onToggle={() => toggleSectionCollapsed("scratchpads")}
                  scrollContainerRef={scrollContainerRef}
                  onAdd={handleCreateScratchpad}
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
                  isCollapsed={isSectionCollapsed("channels")}
                  onToggle={() => toggleSectionCollapsed("channels")}
                  scrollContainerRef={scrollContainerRef}
                  onAdd={handleCreateChannel}
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
                    isCollapsed={isSectionCollapsed("dms")}
                    onToggle={() => toggleSectionCollapsed("dms")}
                    scrollContainerRef={scrollContainerRef}
                    compact
                    showPreviewOnHover
                  />
                )}
              </>
            )}
          </div>
        </ScrollArea>
      }
      footer={<SidebarFooter workspaceId={workspaceId} />}
    />
  )
}
