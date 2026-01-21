import { useState, useRef, useEffect, useMemo, type ReactNode } from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import {
  MoreHorizontal,
  Pencil,
  Archive,
  Search as SearchIcon,
  CheckCheck,
  FileEdit,
  DollarSign,
  RefreshCw,
  Hash,
  User,
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
import {
  useWorkspaceBootstrap,
  useCreateStream,
  useDraftScratchpads,
  useStreamOrDraft,
  useUnreadCounts,
  useAllDrafts,
  workspaceKeys,
  useActors,
} from "@/hooks"
import { useQuickSwitcher, useCoordinatedLoading, useSidebar } from "@/contexts"
import { UnreadBadge } from "@/components/unread-badge"
import { RelativeTime } from "@/components/relative-time"
import { StreamTypes, type StreamWithPreview } from "@threa/types"
import { useQueryClient } from "@tanstack/react-query"
import { ThemeDropdown } from "@/components/theme-dropdown"

// ============================================================================
// Types & Constants
// ============================================================================

type ViewMode = "smart" | "all"
type UrgencyLevel = "mentions" | "activity" | "quiet" | "ai"

interface StreamItemData extends StreamWithPreview {
  urgency: UrgencyLevel
  section: "important" | "recent" | "pinned" | "other"
}

const URGENCY_COLORS = {
  mentions: "hsl(0 84% 60%)", // Red
  activity: "hsl(200 70% 50%)", // Blue
  quiet: "hsl(var(--muted-foreground) / 0.2)", // Gray
  ai: "hsl(var(--primary))", // Gold
} as const

const SECTION_ICONS = {
  important: "⚡",
  recent: "🕐",
  pinned: "📌",
  other: "📂",
} as const

const SECTION_LABELS = {
  important: "Important",
  recent: "Recent",
  pinned: "Pinned",
  other: "Everything Else",
} as const

// ============================================================================
// Helper Functions
// ============================================================================

/** Calculate urgency level for a stream */
function calculateUrgency(stream: StreamWithPreview, unreadCount: number): UrgencyLevel {
  // TODO: Check for mentions - for now use unread count as proxy
  if (unreadCount > 5) return "mentions"

  // Check for recent activity (within 5 minutes)
  if (stream.lastMessagePreview) {
    const diff = Date.now() - new Date(stream.lastMessagePreview.createdAt).getTime()
    if (diff < 5 * 60 * 1000) {
      // For scratchpads, assume AI activity
      if (stream.type === StreamTypes.SCRATCHPAD) return "ai"
      return "activity"
    }
  }

  return "quiet"
}

/** Categorize stream into smart section */
function categorizeStream(
  stream: StreamWithPreview,
  unreadCount: number,
  urgency: UrgencyLevel
): "important" | "recent" | "pinned" | "other" {
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

/** Truncate content for preview display */
function truncateContent(content: JSONContent, maxLength: number = 50): string {
  const markdown = serializeToMarkdown(content)
  const stripped = markdown
    .replace(/[*_~`#]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim()
  return stripped.length > maxLength ? stripped.slice(0, maxLength) + "..." : stripped
}

// ============================================================================
// Urgency Strip Component
// ============================================================================

interface UrgencyStripProps {
  items: StreamItemData[]
}

/**
 * Dynamic urgency strip that scrolls with sidebar content.
 * Each segment's height matches its corresponding stream item.
 */
function UrgencyStrip({ items }: UrgencyStripProps) {
  return (
    <div className="w-1.5 flex-shrink-0 flex flex-col">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex-shrink-0"
          style={{
            height: "40px", // Matches stream item height in comfortable mode
            backgroundColor: URGENCY_COLORS[item.urgency],
          }}
        />
      ))}
    </div>
  )
}

// ============================================================================
// Header Component
// ============================================================================

interface SidebarHeaderProps {
  workspaceName: string
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  totalUnread: number
  onMarkAllAsRead: () => void
  isMarkingAllAsRead: boolean
}

function SidebarHeader({
  workspaceName,
  viewMode,
  onViewModeChange,
  totalUnread,
  onMarkAllAsRead,
  isMarkingAllAsRead,
}: SidebarHeaderProps) {
  const { openSwitcher } = useQuickSwitcher()

  return (
    <div className="flex-shrink-0 border-b px-4 py-3">
      {/* Workspace name + actions */}
      <div className="flex items-center justify-between mb-3">
        <Link to="/workspaces" className="font-semibold hover:underline truncate text-sm">
          {workspaceName}
        </Link>
        <div className="flex items-center gap-1">
          {totalUnread > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onMarkAllAsRead}
              disabled={isMarkingAllAsRead}
              title="Mark all as read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
            </Button>
          )}
          <ThemeDropdown />
        </div>
      </div>

      {/* Search box */}
      <button
        onClick={() => openSwitcher("search")}
        className="w-full flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <SearchIcon className="h-3.5 w-3.5" />
        <span>Search or ⌘K</span>
      </button>

      {/* View toggle */}
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
        {totalUnread > 0 && (
          <div className="flex-1 text-right text-xs text-muted-foreground">Unread: {totalUnread}</div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Section Component
// ============================================================================

interface SmartSectionProps {
  section: "important" | "recent" | "pinned" | "other"
  items: StreamItemData[]
  workspaceId: string
  activeStreamId?: string
  getUnreadCount: (streamId: string) => number
  isCollapsed?: boolean
  onToggle?: () => void
}

function SmartSection({
  section,
  items,
  workspaceId,
  activeStreamId,
  getUnreadCount,
  isCollapsed = false,
  onToggle,
}: SmartSectionProps) {
  if (items.length === 0 && section !== "other") return null

  const icon = SECTION_ICONS[section]
  const label = SECTION_LABELS[section]

  return (
    <div className="mb-4">
      {/* Section header */}
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md",
          "text-xs font-semibold uppercase tracking-wide text-muted-foreground",
          "hover:bg-muted/50 transition-colors"
        )}
      >
        <span>
          {icon} {label}
        </span>
        <span className="px-2 py-0.5 bg-muted rounded-full text-[10px]">{items.length}</span>
      </button>

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
              urgency={stream.urgency}
            />
          ))}
        </div>
      )}

      {/* Everything Else collapsed state */}
      {section === "other" && isCollapsed && items.length > 0 && (
        <p className="text-center text-xs text-muted-foreground italic px-4 py-2">Click to expand or use search</p>
      )}
    </div>
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
  urgency: UrgencyLevel
}

function StreamItem({ workspaceId, stream, isActive, unreadCount, urgency }: StreamItemProps) {
  const { getActorName } = useActors(workspaceId)
  const hasUnread = unreadCount > 0
  const preview = stream.lastMessagePreview

  // Determine avatar content based on stream type
  const getAvatar = () => {
    if (stream.type === StreamTypes.CHANNEL) {
      return {
        icon: <Hash className="h-3.5 w-3.5" />,
        className: "bg-[hsl(200_60%_50%)]/10 text-[hsl(200_60%_50%)]",
      }
    }
    if (stream.type === StreamTypes.SCRATCHPAD) {
      return {
        icon: <FileEdit className="h-3.5 w-3.5" />,
        className: "bg-primary/10 text-primary",
      }
    }
    // DM
    return {
      icon: <User className="h-3.5 w-3.5" />,
      className: "bg-muted text-muted-foreground",
    }
  }

  const avatar = getAvatar()
  const name = stream.slug ? `#${stream.slug}` : stream.displayName || "Untitled"

  // For scratchpads, support renaming
  if (stream.type === StreamTypes.SCRATCHPAD) {
    return (
      <ScratchpadItem
        workspaceId={workspaceId}
        stream={stream}
        isActive={isActive}
        unreadCount={unreadCount}
        urgency={urgency}
      />
    )
  }

  return (
    <Link
      to={`/w/${workspaceId}/s/${stream.id}`}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        isActive ? "bg-primary/10" : "hover:bg-muted/50",
        hasUnread && !isActive && "font-medium"
      )}
    >
      {/* Avatar */}
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", avatar.className)}>
        {avatar.icon}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium text-sm">{name}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Activity dot */}
            {urgency !== "quiet" && (
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: URGENCY_COLORS[urgency] }} />
            )}
            <UnreadBadge count={unreadCount} />
          </div>
        </div>
        {preview && preview.content && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate flex-1">
              {getActorName(preview.authorId, preview.authorType)}: {truncateContent(preview.content as JSONContent)}
            </span>
            <RelativeTime date={preview.createdAt} className="flex-shrink-0" />
          </div>
        )}
      </div>
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
  urgency: UrgencyLevel
}

function ScratchpadItem({
  workspaceId,
  stream: streamWithPreview,
  isActive,
  unreadCount,
  urgency,
}: ScratchpadItemProps) {
  const { stream, isDraft, rename, archive } = useStreamOrDraft(workspaceId, streamWithPreview.id)
  const { getActorName } = useActors(workspaceId)
  const hasUnread = unreadCount > 0
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const name = stream?.displayName || "New scratchpad"
  const preview = streamWithPreview.lastMessagePreview

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartRename = () => {
    setEditValue(stream?.displayName || "")
    setIsEditing(true)
  }

  const handleSaveRename = async () => {
    const trimmed = editValue.trim()
    setIsEditing(false)
    if (!trimmed || trimmed === stream?.displayName) return
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
    <div
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        isActive ? "bg-primary/10" : "hover:bg-muted/50",
        hasUnread && !isActive && "font-medium"
      )}
    >
      {/* Avatar */}
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10 text-primary">
        <FileEdit className="h-3.5 w-3.5" />
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <Link to={`/w/${workspaceId}/s/${streamWithPreview.id}`} className="flex-1 truncate font-medium text-sm">
            {name}
            {isDraft && <span className="ml-1.5 text-xs text-muted-foreground font-normal">(draft)</span>}
          </Link>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Activity dot */}
            {urgency !== "quiet" && (
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: URGENCY_COLORS[urgency] }} />
            )}
            <UnreadBadge count={unreadCount} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                  onClick={(e) => e.preventDefault()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={handleStartRename}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleArchive} className="text-destructive">
                  <Archive className="mr-2 h-4 w-4" />
                  {isDraft ? "Delete" : "Archive"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {preview && preview.content && (
          <Link
            to={`/w/${workspaceId}/s/${streamWithPreview.id}`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span className="truncate flex-1">
              {getActorName(preview.authorId, preview.authorType)}: {truncateContent(preview.content as JSONContent)}
            </span>
            <RelativeTime date={preview.createdAt} className="flex-shrink-0" />
          </Link>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Shell - defines structural layout
// ============================================================================

interface SidebarShellProps {
  header: ReactNode
  draftsLink: ReactNode
  streamList: ReactNode
  footer?: ReactNode
}

/**
 * Sidebar structural shell with dynamic urgency strip.
 * Content fades in/out based on sidebar state.
 */
export function SidebarShell({ header, draftsLink, streamList, footer }: SidebarShellProps) {
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"

  return (
    <div className="flex h-full flex-col">
      {/* Header - fades out when collapsed */}
      <div
        className={cn(
          "transition-opacity duration-150",
          isCollapsed && "pointer-events-none opacity-0",
          !isCollapsed && "pointer-events-auto opacity-100"
        )}
      >
        {header}
      </div>

      {/* Drafts link - fades out when collapsed */}
      <div
        className={cn(
          "border-b px-2 py-2 transition-opacity duration-150",
          isCollapsed && "pointer-events-none opacity-0 h-0 overflow-hidden py-0",
          !isCollapsed && "pointer-events-auto opacity-100"
        )}
      >
        {draftsLink}
      </div>

      {/* Body with scrollable content + urgency strip */}
      <div className="flex-1 flex overflow-hidden">{streamList}</div>

      {/* Footer - fades out when collapsed */}
      {footer && (
        <div
          className={cn(
            "border-t px-2 py-2 transition-opacity duration-150",
            isCollapsed && "pointer-events-none opacity-0 h-0 overflow-hidden py-0",
            !isCollapsed && "pointer-events-auto opacity-100"
          )}
        >
          {footer}
        </div>
      )}
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

function DraftsLinkSkeleton() {
  return <Skeleton className="h-9 w-full rounded-md" />
}

function StreamListSkeleton() {
  return (
    <div className="flex flex-1">
      {/* Urgency strip */}
      <div className="w-1.5 flex-shrink-0 bg-muted" />
      {/* Content */}
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
  const { isLoading: coordinatedLoading } = useCoordinatedLoading()
  const { streamId: activeStreamId, "*": splat } = useParams<{ streamId: string; "*": string }>()
  const { data: bootstrap, isLoading, error, retryBootstrap } = useWorkspaceBootstrap(workspaceId)
  const createStream = useCreateStream(workspaceId)
  const { createDraft } = useDraftScratchpads(workspaceId)
  const { getUnreadCount, getTotalUnreadCount, markAllAsRead, isMarkingAllAsRead } = useUnreadCounts(workspaceId)
  const { drafts: allDrafts } = useAllDrafts(workspaceId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [viewMode, setViewMode] = useState<ViewMode>("smart")
  const [everythingElseCollapsed, setEverythingElseCollapsed] = useState(true)

  const totalUnread = getTotalUnreadCount()
  const draftCount = allDrafts.length
  const isDraftsPage = splat === "drafts" || window.location.pathname.endsWith("/drafts")

  // Process streams into enriched data with urgency and section
  const processedStreams = useMemo(() => {
    if (!bootstrap?.streams) return []

    return bootstrap.streams.map((stream): StreamItemData => {
      const unreadCount = getUnreadCount(stream.id)
      const urgency = calculateUrgency(stream, unreadCount)
      const section = categorizeStream(stream, unreadCount, urgency)

      return {
        ...stream,
        urgency,
        section,
      }
    })
  }, [bootstrap?.streams, getUnreadCount])

  // Organize streams by section
  const streamsBySection = useMemo(() => {
    const important: StreamItemData[] = []
    const recent: StreamItemData[] = []
    const pinned: StreamItemData[] = []
    const other: StreamItemData[] = []

    for (const stream of processedStreams) {
      switch (stream.section) {
        case "important":
          important.push(stream)
          break
        case "recent":
          recent.push(stream)
          break
        case "pinned":
          pinned.push(stream)
          break
        case "other":
          other.push(stream)
          break
      }
    }

    // Sort each section
    important.sort((a, b) => {
      // Mentions first, then AI, then by unread count
      if (a.urgency === "mentions" && b.urgency !== "mentions") return -1
      if (a.urgency !== "mentions" && b.urgency === "mentions") return 1
      return getUnreadCount(b.id) - getUnreadCount(a.id)
    })

    recent.sort((a, b) => {
      // Most recent first
      const aTime = a.lastMessagePreview?.createdAt || a.createdAt
      const bTime = b.lastMessagePreview?.createdAt || b.createdAt
      return new Date(bTime).getTime() - new Date(aTime).getTime()
    })

    // Limit Important to 10, Recent to 15
    return {
      important: important.slice(0, 10),
      recent: recent.slice(0, 15),
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
      } else {
        dms.push(stream)
      }
    }

    return { scratchpads, channels, dms }
  }, [processedStreams])

  // During coordinated loading, show skeleton
  if (coordinatedLoading) {
    return (
      <SidebarShell
        header={<HeaderSkeleton />}
        draftsLink={<DraftsLinkSkeleton />}
        streamList={<StreamListSkeleton />}
      />
    )
  }

  // Show error state with retry button
  if (error && !bootstrap) {
    return (
      <SidebarShell
        header={<HeaderSkeleton />}
        draftsLink={null}
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

  // Get the ordered list of items for urgency strip (visible items only)
  const visibleItems = useMemo(() => {
    if (viewMode === "smart") {
      const items = [...streamsBySection.important, ...streamsBySection.recent, ...streamsBySection.pinned]
      if (!everythingElseCollapsed) {
        items.push(...streamsBySection.other)
      }
      return items
    } else {
      // All view
      return [...streamsByType.scratchpads, ...streamsByType.channels, ...streamsByType.dms]
    }
  }, [viewMode, streamsBySection, streamsByType, everythingElseCollapsed])

  return (
    <SidebarShell
      header={
        <SidebarHeader
          workspaceName={bootstrap?.workspace.name ?? "Loading..."}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          totalUnread={totalUnread}
          onMarkAllAsRead={markAllAsRead}
          isMarkingAllAsRead={isMarkingAllAsRead}
        />
      }
      draftsLink={
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
      }
      streamList={
        <div className="flex flex-1 overflow-hidden">
          {/* Urgency strip - scrolls with content */}
          <UrgencyStrip items={visibleItems} />

          {/* Streams content - scrollable */}
          <ScrollArea className="flex-1">
            <div className="p-2">
              {isLoading ? (
                <p className="px-2 py-4 text-xs text-muted-foreground text-center">Loading...</p>
              ) : error ? (
                <p className="px-2 py-4 text-xs text-destructive text-center">Failed to load</p>
              ) : viewMode === "smart" ? (
                <>
                  {/* Smart View */}
                  <SmartSection
                    section="important"
                    items={streamsBySection.important}
                    workspaceId={workspaceId}
                    activeStreamId={activeStreamId}
                    getUnreadCount={getUnreadCount}
                  />
                  <SmartSection
                    section="recent"
                    items={streamsBySection.recent}
                    workspaceId={workspaceId}
                    activeStreamId={activeStreamId}
                    getUnreadCount={getUnreadCount}
                  />
                  <SmartSection
                    section="pinned"
                    items={streamsBySection.pinned}
                    workspaceId={workspaceId}
                    activeStreamId={activeStreamId}
                    getUnreadCount={getUnreadCount}
                  />
                  <SmartSection
                    section="other"
                    items={streamsBySection.other}
                    workspaceId={workspaceId}
                    activeStreamId={activeStreamId}
                    getUnreadCount={getUnreadCount}
                    isCollapsed={everythingElseCollapsed}
                    onToggle={() => setEverythingElseCollapsed(!everythingElseCollapsed)}
                  />
                </>
              ) : (
                <>
                  {/* All View - Type-based sections */}
                  {streamsByType.scratchpads.length > 0 && (
                    <div className="mb-4">
                      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Scratchpads
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {streamsByType.scratchpads.map((stream) => (
                          <StreamItem
                            key={stream.id}
                            workspaceId={workspaceId}
                            stream={stream}
                            isActive={stream.id === activeStreamId}
                            unreadCount={getUnreadCount(stream.id)}
                            urgency={stream.urgency}
                          />
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 w-full justify-start text-xs"
                        onClick={handleCreateScratchpad}
                      >
                        + New Scratchpad
                      </Button>
                    </div>
                  )}

                  {streamsByType.channels.length > 0 && (
                    <div className="mb-4">
                      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Channels
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {streamsByType.channels.map((stream) => (
                          <StreamItem
                            key={stream.id}
                            workspaceId={workspaceId}
                            stream={stream}
                            isActive={stream.id === activeStreamId}
                            unreadCount={getUnreadCount(stream.id)}
                            urgency={stream.urgency}
                          />
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 w-full justify-start text-xs"
                        onClick={handleCreateChannel}
                        disabled={createStream.isPending}
                      >
                        + New Channel
                      </Button>
                    </div>
                  )}

                  {streamsByType.scratchpads.length === 0 && streamsByType.channels.length === 0 && (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-muted-foreground mb-4">No streams yet</p>
                      <Button variant="outline" size="sm" onClick={handleCreateScratchpad} className="mr-2">
                        New Scratchpad
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleCreateChannel}>
                        New Channel
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      }
      footer={
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
      }
    />
  )
}
