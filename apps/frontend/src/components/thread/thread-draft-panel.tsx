import { useState, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { X, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { RichEditor } from "@/components/editor"
import { useStreamService, useMessageService } from "@/contexts"
import { useAttachments, streamKeys } from "@/hooks"
import { PendingAttachments } from "@/components/timeline/pending-attachments"
import { EventItem } from "@/components/timeline"
import { StreamTypes, type StreamEvent } from "@threa/types"

interface ThreadDraftPanelProps {
  workspaceId: string
  parentStreamId: string
  parentMessageId: string
  initialContent?: string
  onClose: () => void
  onThreadCreated: (threadId: string) => void
}

interface ParentBootstrap {
  events: StreamEvent[]
}

export function ThreadDraftPanel({
  workspaceId,
  parentStreamId,
  parentMessageId,
  initialContent = "",
  onClose,
  onThreadCreated,
}: ThreadDraftPanelProps) {
  const [content, setContent] = useState(initialContent)
  const [isCreating, setIsCreating] = useState(false)
  const streamService = useStreamService()
  const messageService = useMessageService()
  const queryClient = useQueryClient()

  // Get parent message from parent stream's cached bootstrap
  const parentMessage = useMemo(() => {
    const parentBootstrap = queryClient.getQueryData<ParentBootstrap>(streamKeys.bootstrap(workspaceId, parentStreamId))
    if (!parentBootstrap?.events) return null

    return parentBootstrap.events.find(
      (e) => e.eventType === "message_created" && (e.payload as { messageId?: string })?.messageId === parentMessageId
    )
  }, [workspaceId, parentStreamId, parentMessageId, queryClient])

  const { pendingAttachments, fileInputRef, handleFileSelect, removeAttachment, uploadedIds, isUploading, hasFailed } =
    useAttachments(workspaceId)

  const canSend = (content.trim() || uploadedIds.length > 0) && !isCreating && !isUploading && !hasFailed

  const handleSubmit = async () => {
    if (!canSend) return

    const trimmed = content.trim()
    setIsCreating(true)

    try {
      // Create the thread
      const thread = await streamService.create(workspaceId, {
        type: StreamTypes.THREAD,
        parentStreamId,
        parentMessageId,
      })

      // Send the first message with attachments
      await messageService.create(workspaceId, thread.id, {
        streamId: thread.id,
        content: trimmed || " ", // Backend requires content
        contentFormat: "markdown",
        attachmentIds: uploadedIds.length > 0 ? uploadedIds : undefined,
      })

      // Transition to the real thread panel
      onThreadCreated(thread.id)
    } catch (error) {
      console.error("Failed to create thread:", error)
      setIsCreating(false)
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col border-l bg-background">
        <header className="flex h-14 items-center justify-between border-b px-4">
          <h2 className="font-semibold">New thread</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {/* Parent message at the top */}
            {parentMessage && (
              <div className="border-b">
                <div className="p-4">
                  <EventItem event={parentMessage} workspaceId={workspaceId} streamId={parentStreamId} hideActions />
                </div>
                <Separator />
                <div className="py-2 px-4 text-xs text-muted-foreground bg-muted/30">0 replies</div>
              </div>
            )}
          </div>
          <div className="p-4 border-t">
            <PendingAttachments attachments={pendingAttachments} onRemove={removeAttachment} />

            <div className="flex items-end gap-2">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
                disabled={isCreating}
              />

              {/* Upload button */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={isCreating}
                title="Attach files"
              >
                <Paperclip className="h-4 w-4" />
              </Button>

              <RichEditor
                value={content}
                onChange={setContent}
                onSubmit={handleSubmit}
                placeholder="Write your reply..."
                disabled={isCreating}
              />

              {hasFailed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button disabled size="sm" className="shrink-0 pointer-events-none">
                        Reply
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Remove failed uploads before sending</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button onClick={handleSubmit} disabled={!canSend} size="sm" className="shrink-0">
                  {isCreating ? "Creating..." : "Reply"}
                </Button>
              )}
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}
