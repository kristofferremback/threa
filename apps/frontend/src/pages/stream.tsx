import { useState, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useLiveQuery } from "dexie-react-hooks"
import { MoreHorizontal, Pencil, Archive } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  useStreamBootstrap,
  useDraftScratchpads,
  useUpdateStream,
  useDeleteStream,
  isDraftId,
} from "@/hooks"
import { TimelineView } from "@/components/timeline"
import { StreamTypes } from "@/types/domain"
import { db } from "@/db"

export function StreamPage() {
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId: string }>()
  const isDraft = streamId ? isDraftId(streamId) : false
  const { data: bootstrap } = useStreamBootstrap(workspaceId!, streamId!, { enabled: !isDraft })
  const { updateDraft, deleteDraft } = useDraftScratchpads(workspaceId!)
  const updateStream = useUpdateStream(workspaceId!, streamId!)
  const deleteStream = useDeleteStream(workspaceId!)
  const navigate = useNavigate()

  // Direct subscription to the specific draft record for reactivity
  const draft = useLiveQuery(
    () => (isDraft && streamId ? db.draftScratchpads.get(streamId) : undefined),
    [isDraft, streamId]
  )

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  if (!workspaceId || !streamId) {
    return null
  }

  const stream = bootstrap?.stream
  const isScratchpad = isDraft || stream?.type === StreamTypes.SCRATCHPAD

  const streamName = isDraft
    ? draft?.displayName || "New scratchpad"
    : stream?.displayName || stream?.slug || "Stream"

  const handleStartRename = () => {
    setEditValue(isDraft ? draft?.displayName || "" : stream?.displayName || "")
    setIsEditing(true)
  }

  const handleSaveRename = async () => {
    const trimmed = editValue.trim()
    setIsEditing(false)

    const currentName = isDraft ? draft?.displayName : stream?.displayName
    if (!trimmed || trimmed === currentName) return

    if (isDraft) {
      await updateDraft(streamId, { displayName: trimmed })
    } else {
      await updateStream.mutateAsync({ displayName: trimmed })
    }
  }

  const handleArchive = async () => {
    if (isDraft) {
      await deleteDraft(streamId)
    } else {
      await deleteStream.mutateAsync(streamId)
    }
    navigate(`/w/${workspaceId}`)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveRename()
    } else if (e.key === "Escape") {
      setIsEditing(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex-1">
          {isEditing ? (
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSaveRename}
              onKeyDown={handleKeyDown}
              className="h-8 max-w-xs font-semibold"
              placeholder="Scratchpad name"
              autoFocus
            />
          ) : isScratchpad ? (
            <div className="group inline-flex items-center gap-1 rounded-md px-2 py-1 -ml-2 hover:bg-accent/50 hover:outline hover:outline-1 hover:outline-border cursor-pointer transition-colors">
              <h1 className="font-semibold">
                {streamName}
                {isDraft && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">(draft)</span>
                )}
              </h1>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleStartRename}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <h1 className="font-semibold">{streamName}</h1>
          )}
        </div>
        {isScratchpad && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
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
        )}
      </header>
      <main className="flex-1 overflow-hidden">
        <TimelineView isDraft={isDraft} />
      </main>
    </div>
  )
}
