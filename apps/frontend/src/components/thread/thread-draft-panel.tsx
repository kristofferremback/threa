import { useMemo, useCallback } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useStreamService, useMessageService } from "@/contexts"
import { useDraftComposer, useStreamBootstrap, getDraftMessageKey } from "@/hooks"
import { MessageComposer } from "@/components/composer"
import { EventItem } from "@/components/timeline"
import { StreamTypes } from "@threa/types"

interface ThreadDraftPanelProps {
  workspaceId: string
  parentStreamId: string
  parentMessageId: string
  initialContent?: string
  onClose: () => void
  onThreadCreated: (threadId: string) => void
}

export function ThreadDraftPanel({
  workspaceId,
  parentStreamId,
  parentMessageId,
  initialContent = "",
  onClose,
  onThreadCreated,
}: ThreadDraftPanelProps) {
  const streamService = useStreamService()
  const messageService = useMessageService()

  // Draft message persistence
  const draftKey = getDraftMessageKey({ type: "thread", parentMessageId })
  const composer = useDraftComposer({
    workspaceId,
    draftKey,
    scopeId: parentMessageId,
    initialContent,
  })

  // Fetch parent stream's bootstrap to get the parent message
  const { data: parentBootstrap } = useStreamBootstrap(workspaceId, parentStreamId)

  const parentMessage = useMemo(() => {
    if (!parentBootstrap?.events) return null

    return parentBootstrap.events.find(
      (e) => e.eventType === "message_created" && (e.payload as { messageId?: string })?.messageId === parentMessageId
    )
  }, [parentBootstrap, parentMessageId])

  const handleSubmit = useCallback(async () => {
    if (!composer.canSend) return

    const trimmed = composer.content.trim()
    composer.setIsSending(true)

    // Clear input immediately for responsiveness
    composer.setContent("")
    composer.clearDraft()
    const attachmentIds = composer.uploadedIds
    composer.clearAttachments()

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
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      })

      // Transition to the real thread panel
      onThreadCreated(thread.id)
    } catch (error) {
      console.error("Failed to create thread:", error)
      composer.setIsSending(false)
    }
  }, [composer, streamService, workspaceId, parentStreamId, parentMessageId, messageService, onThreadCreated])

  return (
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
          <MessageComposer
            content={composer.content}
            onContentChange={composer.handleContentChange}
            pendingAttachments={composer.pendingAttachments}
            onRemoveAttachment={composer.handleRemoveAttachment}
            fileInputRef={composer.fileInputRef}
            onFileSelect={composer.handleFileSelect}
            onSubmit={handleSubmit}
            canSubmit={composer.canSend}
            isSubmitting={composer.isSending}
            hasFailed={composer.hasFailed}
            submitLabel="Reply"
            submittingLabel="Creating..."
            placeholder="Write your reply..."
          />
        </div>
      </main>
    </div>
  )
}
