import { useState, useRef, useEffect, type ReactNode } from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { MoreHorizontal, Pencil, Archive, Search, CheckCheck, FileEdit, DollarSign, RefreshCw } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
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
import { useQuickSwitcher, useCoordinatedLoading } from "@/contexts"
import { UnreadBadge } from "@/components/unread-badge"
import { RelativeTime } from "@/components/relative-time"
import { StreamTypes, type StreamWithPreview } from "@threa/types"
import { useQueryClient } from "@tanstack/react-query"
import { ThemeDropdown } from "@/components/theme-dropdown"

// ============================================================================
// Shell - defines structural layout, receives content via slots
// ============================================================================

interface SidebarShellProps {
  header: ReactNode
  draftsLink: ReactNode
  streamList: ReactNode
  footer?: ReactNode
}

/**
 * Sidebar structural shell - defines layout without content.
 * Used by both real Sidebar and skeleton to ensure identical structure.
 */
export function SidebarShell({ header, draftsLink, streamList, footer }: SidebarShellProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b px-4">{header}</div>
      <div className="border-b px-2 py-2">{draftsLink}</div>
      <ScrollArea className="flex-1">
        <div className="p-2">{streamList}</div>
      </ScrollArea>
      {footer && <div className="border-t px-2 py-2">{footer}</div>}
    </div>
  )
}

// ============================================================================
// Skeleton content for each slot
// ============================================================================

function HeaderSkeleton() {
  return (
    <>
      <Skeleton className="h-5 w-32" />
      <div className="flex items-center gap-1">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
    </>
  )
}

function DraftsLinkSkeleton() {
  return <Skeleton className="h-9 w-full rounded-md" />
}

function StreamListSkeleton() {
  return (
    <>
      {/* Scratchpads section */}
      <div className="mb-4">
        <Skeleton className="mb-2 h-3 w-20 px-2" />
        <div className="space-y-1">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      </div>

      {/* Separator */}
      <div className="my-2 h-px bg-border" />

      {/* Channels section */}
      <div>
        <Skeleton className="mb-2 h-3 w-16 px-2" />
        <div className="space-y-1">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      </div>
    </>
  )
}

// ============================================================================
// Main Sidebar component
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
  const { openSwitcher } = useQuickSwitcher()
  const { drafts: allDrafts } = useAllDrafts(workspaceId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const totalUnread = getTotalUnreadCount()
  const draftCount = allDrafts.length
  const isDraftsPage = splat === "drafts" || window.location.pathname.endsWith("/drafts")

  // During coordinated loading, show skeleton using the same shell
  if (coordinatedLoading) {
    return (
      <SidebarShell
        header={<HeaderSkeleton />}
        draftsLink={<DraftsLinkSkeleton />}
        streamList={<StreamListSkeleton />}
      />
    )
  }

  // Show error state with retry button when bootstrap fails
  if (error && !bootstrap) {
    return (
      <SidebarShell
        header={
          <Link to="/workspaces" className="font-semibold hover:underline truncate">
            Workspace
          </Link>
        }
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

  const streams = bootstrap?.streams ?? []
  const scratchpads = streams.filter((s) => s.type === StreamTypes.SCRATCHPAD)
  const channels = streams.filter((s) => s.type === StreamTypes.CHANNEL)

  return (
    <SidebarShell
      header={
        <>
          <Link to="/workspaces" className="font-semibold hover:underline truncate">
            {bootstrap?.workspace.name ?? "Loading..."}
          </Link>
          <div className="flex items-center gap-1">
            {totalUnread > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => markAllAsRead()}
                disabled={isMarkingAllAsRead}
                title="Mark all as read"
              >
                <CheckCheck className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => openSwitcher("search")}
              title={`Search (${navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}F)`}
            >
              <Search className="h-4 w-4" />
            </Button>
            <ThemeDropdown />
          </div>
        </>
      }
      draftsLink={
        <Link
          to={`/w/${workspaceId}/drafts`}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            isDraftsPage && "bg-accent text-accent-foreground",
            !isDraftsPage && draftCount === 0 && "text-muted-foreground"
          )}
        >
          <FileEdit className="h-4 w-4" />
          Drafts
        </Link>
      }
      streamList={
        isLoading ? (
          <p className="px-2 py-4 text-xs text-muted-foreground text-center">Loading...</p>
        ) : error ? (
          <p className="px-2 py-4 text-xs text-destructive text-center">Failed to load</p>
        ) : (
          <>
            {/* Scratchpads section - primary for solo users */}
            <SidebarSection title="Scratchpads">
              {scratchpads.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">No scratchpads yet</p>
              ) : (
                scratchpads.map((stream) => (
                  <ScratchpadItem
                    key={stream.id}
                    workspaceId={workspaceId}
                    stream={stream}
                    isActive={stream.id === activeStreamId}
                    unreadCount={getUnreadCount(stream.id)}
                  />
                ))
              )}
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full justify-start text-xs"
                onClick={handleCreateScratchpad}
              >
                + New Scratchpad
              </Button>
            </SidebarSection>

            <Separator className="my-2" />

            {/* Channels section */}
            <SidebarSection title="Channels">
              {channels.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">No channels yet</p>
              ) : (
                channels.map((stream) => (
                  <StreamItem
                    key={stream.id}
                    workspaceId={workspaceId}
                    stream={stream}
                    isActive={stream.id === activeStreamId}
                    unreadCount={getUnreadCount(stream.id)}
                  />
                ))
              )}
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full justify-start text-xs"
                onClick={handleCreateChannel}
                disabled={createStream.isPending}
              >
                + New Channel
              </Button>
            </SidebarSection>
          </>
        )
      }
      footer={
        <Link
          to={`/w/${workspaceId}/admin/ai-usage`}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            "hover:bg-accent hover:text-accent-foreground text-muted-foreground"
          )}
        >
          <DollarSign className="h-4 w-4" />
          AI Usage
        </Link>
      }
    />
  )
}

// ============================================================================
// Helper components
// ============================================================================

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <h3 className="mb-1 px-2 text-xs font-medium uppercase text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

/** Check if activity is recent (within 5 minutes) */
function isRecentActivity(createdAt: string): boolean {
  const diff = Date.now() - new Date(createdAt).getTime()
  return diff < 5 * 60 * 1000 // 5 minutes
}

/** Truncate content for preview display */
function truncateContent(content: string, maxLength: number = 50): string {
  // Strip markdown formatting for cleaner preview
  const stripped = content
    .replace(/[*_~`#]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Links
    .replace(/\n+/g, " ")
    .trim()
  return stripped.length > maxLength ? stripped.slice(0, maxLength) + "..." : stripped
}

interface StreamItemProps {
  workspaceId: string
  stream: StreamWithPreview
  isActive: boolean
  unreadCount: number
}

function StreamItem({ workspaceId, stream, isActive, unreadCount }: StreamItemProps) {
  const { getActorName } = useActors(workspaceId)
  const hasUnread = unreadCount > 0
  const preview = stream.lastMessagePreview
  const isRecent = preview && isRecentActivity(preview.createdAt)
  const name = stream.slug ? `#${stream.slug}` : stream.displayName || "Untitled"

  return (
    <Link
      to={`/w/${workspaceId}/s/${stream.id}`}
      className={cn(
        "group flex flex-col gap-0.5 rounded-md px-2 py-2 text-sm transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        hasUnread && !isActive && "font-medium"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="truncate font-medium">{name}</span>
        <div className="flex items-center gap-1.5">
          {isRecent && <span className="activity-dot recent" />}
          <UnreadBadge count={unreadCount} />
        </div>
      </div>
      {preview && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate flex-1">
            {getActorName(preview.authorId, preview.authorType)}: {truncateContent(preview.content)}
          </span>
          <RelativeTime date={preview.createdAt} className="shrink-0" />
        </div>
      )}
    </Link>
  )
}

interface ScratchpadItemProps {
  workspaceId: string
  stream: StreamWithPreview
  isActive: boolean
  unreadCount: number
}

function ScratchpadItem({ workspaceId, stream: streamWithPreview, isActive, unreadCount }: ScratchpadItemProps) {
  const { stream, isDraft, rename, archive } = useStreamOrDraft(workspaceId, streamWithPreview.id)
  const { getActorName } = useActors(workspaceId)
  const hasUnread = unreadCount > 0
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const name = stream?.displayName || "New scratchpad"
  const preview = streamWithPreview.lastMessagePreview
  const isRecent = preview && isRecentActivity(preview.createdAt)

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
          className="h-7 text-sm"
          placeholder="Scratchpad name"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group flex flex-col gap-0.5 rounded-md px-2 py-2 text-sm transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        hasUnread && !isActive && "font-medium"
      )}
    >
      <div className="flex items-center justify-between">
        <Link to={`/w/${workspaceId}/s/${streamWithPreview.id}`} className="flex-1 truncate font-medium">
          {name}
          {isDraft && <span className="ml-1 text-xs text-muted-foreground font-normal">(draft)</span>}
        </Link>
        <div className="flex items-center gap-1">
          {isRecent && <span className="activity-dot recent" />}
          <UnreadBadge count={unreadCount} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                onClick={(e) => e.preventDefault()}
              >
                <MoreHorizontal className="h-4 w-4" />
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
      {preview && (
        <Link
          to={`/w/${workspaceId}/s/${streamWithPreview.id}`}
          className="flex items-center gap-1 text-xs text-muted-foreground"
        >
          <span className="truncate flex-1">
            {getActorName(preview.authorId, preview.authorType)}: {truncateContent(preview.content)}
          </span>
          <RelativeTime date={preview.createdAt} className="shrink-0" />
        </Link>
      )}
    </div>
  )
}
