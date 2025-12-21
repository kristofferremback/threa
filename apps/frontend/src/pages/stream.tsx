import { useState, useRef } from "react"
import { useParams } from "react-router-dom"
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
import { useStreamOrDraft } from "@/hooks"
import { TimelineView } from "@/components/timeline"
import { StreamTypes } from "@threa/types"

export function StreamPage() {
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId: string }>()
  const { stream, isDraft, rename, archive } = useStreamOrDraft(workspaceId!, streamId!)

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  if (!workspaceId || !streamId) {
    return null
  }

  const isScratchpad = isDraft || stream?.type === StreamTypes.SCRATCHPAD
  const streamName = stream?.displayName || (isDraft ? "New scratchpad" : "Stream")

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
            <div
              className="group inline-flex items-center gap-1 rounded-md px-2 py-1 -ml-2 hover:bg-accent/50 hover:outline hover:outline-1 hover:outline-border cursor-pointer transition-colors"
              onClick={handleStartRename}
            >
              <h1 className="font-semibold">
                {streamName}
                {isDraft && <span className="ml-2 text-xs font-normal text-muted-foreground">(draft)</span>}
              </h1>
              <Pencil className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
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
