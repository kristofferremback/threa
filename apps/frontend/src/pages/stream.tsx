import { useState, useRef, Fragment } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { MoreHorizontal, Pencil, Archive, MessageCircle, X, ArchiveX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { cn } from "@/lib/utils"
import { useStreamOrDraft, useStreamError } from "@/hooks"
import { usePanel } from "@/contexts"
import { TimelineView } from "@/components/timeline"
import { StreamPanel, ThreadDraftPanel, ThreadHeader } from "@/components/thread"
import { ConversationList } from "@/components/conversations"
import { StreamErrorView } from "@/components/stream-error-view"
import { StreamTypes } from "@threa/types"

export function StreamPage() {
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { stream, isDraft, error, rename, archive, unarchive } = useStreamOrDraft(workspaceId!, streamId!)
  const { openPanels, draftReply, closePanel, closeAllPanels, transitionDraftToPanel } = usePanel()

  // Unified error checking - checks both coordinated loading and direct query errors
  const streamError = useStreamError(streamId, error)

  const isConversationViewOpen = searchParams.get("convView") === "open"

  const setConversationViewOpen = (open: boolean) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev)
      if (open) {
        newParams.set("convView", "open")
      } else {
        newParams.delete("convView")
      }
      return newParams
    })
  }

  const isThread = stream?.type === StreamTypes.THREAD
  const isChannel = stream?.type === StreamTypes.CHANNEL

  const handleCloseDraft = () => {
    closeAllPanels() // This also clears draftReply
  }

  const handleThreadCreated = (threadId: string) => {
    transitionDraftToPanel(threadId)
  }

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  if (!workspaceId || !streamId) {
    return null
  }

  // Show error page if stream has error (404/403)
  if (streamError) {
    return <StreamErrorView type={streamError.type} workspaceId={workspaceId} />
  }

  const isScratchpad = isDraft || stream?.type === StreamTypes.SCRATCHPAD
  const isArchived = stream?.archivedAt != null
  const streamName = stream?.displayName || (isDraft ? "New scratchpad" : isThread ? "Thread" : "Stream")

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

  const handleUnarchive = async () => {
    await unarchive?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveRename()
    } else if (e.key === "Escape") {
      setIsEditing(false)
    }
  }

  const mainStreamContent = (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2 flex-1">
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
          ) : isThread && stream ? (
            <ThreadHeader workspaceId={workspaceId} stream={stream} />
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
          {isArchived && (
            <Badge variant="secondary" className="gap-1">
              <ArchiveX className="h-3 w-3" />
              Archived
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isChannel && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Conversations"
              onClick={() => setConversationViewOpen(!isConversationViewOpen)}
            >
              <MessageCircle className="h-4 w-4" />
            </Button>
          )}
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
                {isArchived ? (
                  <DropdownMenuItem onClick={handleUnarchive}>
                    <Archive className="mr-2 h-4 w-4" />
                    Unarchive
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={handleArchive} className="text-destructive">
                    <Archive className="mr-2 h-4 w-4" />
                    {isDraft ? "Delete" : "Archive"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <TimelineView isDraft={isDraft} />
      </main>
    </div>
  )

  const hasSidePanel = openPanels.length > 0 || draftReply !== null

  // Conversation side panel - only shown for channels
  const conversationPanel = isChannel && (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/80 transition-opacity duration-300",
          isConversationViewOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setConversationViewOpen(false)}
      />
      {/* Panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-50 w-80 sm:w-96 bg-background border-l shadow-lg flex flex-col",
          "transition-transform duration-300 ease-out",
          isConversationViewOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Conversations</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setConversationViewOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ConversationList
            workspaceId={workspaceId!}
            streamId={streamId!}
            onMessageClick={() => setConversationViewOpen(false)}
          />
        </div>
      </div>
    </>
  )

  // When no panels open, render just the main stream
  if (!hasSidePanel) {
    return (
      <>
        {mainStreamContent}
        {conversationPanel}
      </>
    )
  }

  // Calculate panel count for sizing
  const totalPanels = 1 + (draftReply ? 1 : 0) + openPanels.length
  const panelSize = Math.floor(100 / totalPanels)

  // When panels are open, use resizable layout
  return (
    <>
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel id="main" defaultSize={panelSize} minSize={20}>
          {mainStreamContent}
        </ResizablePanel>

        {/* Stream panels */}
        {openPanels.map((panel) => (
          <Fragment key={panel.streamId}>
            <ResizableHandle withHandle />
            <ResizablePanel id={panel.streamId} defaultSize={panelSize} minSize={20}>
              <StreamPanel
                workspaceId={workspaceId}
                streamId={panel.streamId}
                onClose={() => closePanel(panel.streamId)}
              />
            </ResizablePanel>
          </Fragment>
        ))}

        {/* Draft panel for creating new threads (appears rightmost) */}
        {draftReply && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="draft" defaultSize={panelSize} minSize={20}>
              <ThreadDraftPanel
                workspaceId={workspaceId}
                parentStreamId={draftReply.parentStreamId}
                parentMessageId={draftReply.parentMessageId}
                initialContent={draftReply.content}
                onClose={handleCloseDraft}
                onThreadCreated={handleThreadCreated}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {conversationPanel}
    </>
  )
}
