import { useState, useRef, useEffect } from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { MoreHorizontal, Pencil, Archive } from "lucide-react"
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
  useUpdateStream,
  useDeleteStream,
  useDraftScratchpads,
  workspaceKeys,
} from "@/hooks"
import { StreamTypes } from "@/types/domain"
import { useQueryClient } from "@tanstack/react-query"

interface SidebarProps {
  workspaceId: string
}

export function Sidebar({ workspaceId }: SidebarProps) {
  const { streamId: activeStreamId } = useParams<{ streamId: string }>()
  const { data: bootstrap, isLoading, error } = useWorkspaceBootstrap(workspaceId)
  const createStream = useCreateStream(workspaceId)
  const { drafts, createDraft, updateDraft, deleteDraft } = useDraftScratchpads(workspaceId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

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
  const allScratchpads: Array<{ id: string; displayName: string | null; isDraft: boolean }> = [
    ...sortedDrafts.map((d) => ({ id: d.id, displayName: d.displayName, isDraft: true })),
    ...realScratchpads.map((s) => ({ id: s.id, displayName: s.displayName, isDraft: false })),
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Workspace header */}
      <div className="flex h-14 items-center border-b px-4">
        <Link to="/workspaces" className="font-semibold hover:underline truncate">
          {bootstrap?.workspace.name ?? "Loading..."}
        </Link>
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
                {allScratchpads.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No scratchpads yet</p>
                ) : (
                  allScratchpads.map((item) => (
                    <ScratchpadItem
                      key={item.id}
                      workspaceId={workspaceId}
                      id={item.id}
                      displayName={item.displayName}
                      isDraft={item.isDraft}
                      isActive={item.id === activeStreamId}
                      onRename={(newName) =>
                        item.isDraft ? updateDraft(item.id, { displayName: newName }) : undefined
                      }
                      onArchive={() => (item.isDraft ? deleteDraft(item.id) : undefined)}
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
}

function StreamItem({ workspaceId, streamId, name, isActive }: StreamItemProps) {
  return (
    <Link
      to={`/w/${workspaceId}/s/${streamId}`}
      className={cn(
        "block rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      )}
    >
      {name}
    </Link>
  )
}

interface ScratchpadItemProps {
  workspaceId: string
  id: string
  displayName: string | null
  isDraft: boolean
  isActive: boolean
  onRename: (newName: string) => void
  onArchive: () => void
}

function ScratchpadItem({ workspaceId, id, displayName, isDraft, isActive, onRename, onArchive }: ScratchpadItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const updateStream = useUpdateStream(workspaceId, id)
  const deleteStream = useDeleteStream(workspaceId)

  const name = displayName || "New scratchpad"

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartRename = () => {
    setEditValue(displayName || "")
    setIsEditing(true)
  }

  const handleSaveRename = async () => {
    const trimmed = editValue.trim()
    setIsEditing(false)
    if (!trimmed || trimmed === displayName) return

    if (isDraft) {
      onRename(trimmed)
    } else {
      await updateStream.mutateAsync({ displayName: trimmed })
    }
  }

  const handleArchive = async () => {
    if (isDraft) {
      onArchive()
    } else {
      await deleteStream.mutateAsync(id)
    }
    if (isActive) {
      navigate(`/w/${workspaceId}`)
    }
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
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      )}
    >
      <Link to={`/w/${workspaceId}/s/${id}`} className="flex-1 truncate">
        {name}
        {isDraft && <span className="ml-1 text-xs text-muted-foreground">(draft)</span>}
      </Link>
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
  )
}
