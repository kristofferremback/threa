import { useState, useRef, useEffect } from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { MoreHorizontal, Pencil, Archive, Search, CheckCheck } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  workspaceKeys,
} from "@/hooks"
import { UnreadBadge } from "@/components/unread-badge"
import { StreamTypes } from "@threa/types"
import { useQueryClient } from "@tanstack/react-query"
import { ThemeDropdown } from "@/components/theme-dropdown"

interface SidebarProps {
  workspaceId: string
}

export function Sidebar({ workspaceId }: SidebarProps) {
  const { streamId: activeStreamId } = useParams<{ streamId: string }>()
  const { data: bootstrap, isLoading, error } = useWorkspaceBootstrap(workspaceId)
  const createStream = useCreateStream(workspaceId)
  const { drafts, createDraft } = useDraftScratchpads(workspaceId)
  const { getUnreadCount, getTotalUnreadCount, markAllAsRead, isMarkingAllAsRead } = useUnreadCounts(workspaceId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const totalUnread = getTotalUnreadCount()

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
  const realScratchpads = streams.filter((s) => s.type === StreamTypes.SCRATCHPAD)
  const channels = streams.filter((s) => s.type === StreamTypes.CHANNEL)

  // Combine drafts and real scratchpads, drafts first (newest first)
  const sortedDrafts = [...drafts].sort((a, b) => b.createdAt - a.createdAt)
  const allScratchpadIds: Array<{ id: string; isDraft: boolean }> = [
    ...sortedDrafts.map((d) => ({ id: d.id, isDraft: true })),
    ...realScratchpads.map((s) => ({ id: s.id, isDraft: false })),
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Workspace header */}
      <div className="flex h-14 items-center justify-between border-b px-4">
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
            onClick={() => {
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, ctrlKey: true }))
            }}
            title={`Search (${navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}F)`}
          >
            <Search className="h-4 w-4" />
          </Button>
          <ThemeDropdown />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading ? (
            <p className="px-2 py-4 text-xs text-muted-foreground text-center">Loading...</p>
          ) : error ? (
            <p className="px-2 py-4 text-xs text-destructive text-center">Failed to load</p>
          ) : (
            <>
              {/* Scratchpads section - primary for solo users */}
              <SidebarSection title="Scratchpads">
                {allScratchpadIds.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No scratchpads yet</p>
                ) : (
                  allScratchpadIds.map((item) => (
                    <ScratchpadItem
                      key={item.id}
                      workspaceId={workspaceId}
                      streamId={item.id}
                      isActive={item.id === activeStreamId}
                      unreadCount={getUnreadCount(item.id)}
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
                      streamId={stream.id}
                      name={stream.slug ? `#${stream.slug}` : stream.displayName || "Untitled"}
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
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <h3 className="mb-1 px-2 text-xs font-medium uppercase text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

interface StreamItemProps {
  workspaceId: string
  streamId: string
  name: string
  isActive: boolean
  unreadCount: number
}

function StreamItem({ workspaceId, streamId, name, isActive, unreadCount }: StreamItemProps) {
  const hasUnread = unreadCount > 0

  return (
    <Link
      to={`/w/${workspaceId}/s/${streamId}`}
      className={cn(
        "flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        hasUnread && !isActive && "font-medium"
      )}
    >
      <span className="truncate">{name}</span>
      <UnreadBadge count={unreadCount} />
    </Link>
  )
}

interface ScratchpadItemProps {
  workspaceId: string
  streamId: string
  isActive: boolean
  unreadCount: number
}

function ScratchpadItem({ workspaceId, streamId, isActive, unreadCount }: ScratchpadItemProps) {
  const { stream, isDraft, rename, archive } = useStreamOrDraft(workspaceId, streamId)
  const hasUnread = unreadCount > 0
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const name = stream?.displayName || "New scratchpad"

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
        "group flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        hasUnread && !isActive && "font-medium"
      )}
    >
      <Link to={`/w/${workspaceId}/s/${streamId}`} className="flex-1 truncate">
        {name}
        {isDraft && <span className="ml-1 text-xs text-muted-foreground font-normal">(draft)</span>}
      </Link>
      <div className="flex items-center gap-1">
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
  )
}
