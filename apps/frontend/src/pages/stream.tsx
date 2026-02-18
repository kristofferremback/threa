import { useState, useRef } from "react"
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
import { cn } from "@/lib/utils"
import { useStreamOrDraft, useStreamError, usePanelLayout, isDmDraftId } from "@/hooks"
import { usePanel } from "@/contexts"
import { TimelineView } from "@/components/timeline"
import { StreamPanel, ThreadHeader } from "@/components/thread"
import { ThreadPanelSlot } from "@/components/layout"
import { ConversationList } from "@/components/conversations"
import { StreamErrorView } from "@/components/stream-error-view"
import { StreamTypes, type StreamType } from "@threa/types"
import { getStreamName, streamFallbackLabel } from "@/lib/streams"

function getStreamTypeLabel(type: StreamType): string {
  switch (type) {
    case StreamTypes.SCRATCHPAD:
      return "Scratchpad"
    case StreamTypes.CHANNEL:
      return "Channel"
    case StreamTypes.DM:
      return "DM"
    case StreamTypes.THREAD:
      return "Thread"
    default:
      return type
  }
}

export function StreamPage() {
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { stream, isDraft, error, rename, archive, unarchive } = useStreamOrDraft(workspaceId!, streamId!)
  const { panelId, isPanelOpen, closePanel } = usePanel()
  const {
    containerRef,
    panelWidth,
    maxWidth,
    minWidth,
    displayWidth,
    shouldAnimate,
    isResizing,
    showContent,
    handleResizeStart,
    handleResizeKeyDown,
    handleTransitionEnd,
  } = usePanelLayout(isPanelOpen)

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

  const isScratchpad = stream?.type === StreamTypes.SCRATCHPAD
  const isArchived = stream?.archivedAt != null
  const isDmDraft = isDraft && isDmDraftId(streamId)
  const streamName = stream
    ? (getStreamName(stream) ?? streamFallbackLabel(stream.type, "generic"))
    : isDraft
      ? streamFallbackLabel(isDmDraft ? "dm" : "scratchpad", "sidebar")
      : "Stream"
  const isUnnamedScratchpad = isScratchpad && !stream?.displayName

  const handleStartRename = () => {
    setEditValue(stream?.displayName ?? "")
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
      <header className="flex h-11 items-center justify-between border-b px-4">
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
          {stream && !isThread && !isDraft && !isChannel && !isUnnamedScratchpad && (
            <Badge variant="secondary">{getStreamTypeLabel(stream.type)}</Badge>
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

  return (
    <>
      <div ref={containerRef} className="flex h-full">
        <div className="flex-1 min-w-0 overflow-hidden">{mainStreamContent}</div>

        <ThreadPanelSlot
          displayWidth={displayWidth}
          panelWidth={panelWidth}
          shouldAnimate={shouldAnimate}
          showContent={showContent}
          isResizing={isResizing}
          maxWidth={maxWidth}
          minWidth={minWidth}
          onTransitionEnd={handleTransitionEnd}
          onResizeStart={handleResizeStart}
          onResizeKeyDown={handleResizeKeyDown}
        >
          <StreamPanel key={panelId} workspaceId={workspaceId} onClose={closePanel} />
        </ThreadPanelSlot>
      </div>
      {conversationPanel}
    </>
  )
}
