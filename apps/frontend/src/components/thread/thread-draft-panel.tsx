import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { X, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { RichEditor } from "@/components/editor"
import { useStreamService, useMessageService } from "@/contexts"
import { useAttachments, useStreamBootstrap, useDraftMessage, getDraftMessageKey } from "@/hooks"
import { PendingAttachments } from "@/components/timeline/pending-attachments"
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
  const {
    isLoaded: isDraftLoaded,
    content: savedDraft,
    attachments: savedAttachments,
    saveDraftDebounced,
    addAttachment: addDraftAttachment,
    removeAttachment: removeDraftAttachment,
    clearDraft,
  } = useDraftMessage(workspaceId, draftKey)

  // Attachment handling
  const {
    pendingAttachments,
    fileInputRef,
    handleFileSelect,
    removeAttachment,
    uploadedIds,
    isUploading,
    hasFailed,
    clear: clearAttachments,
    restore: restoreAttachments,
  } = useAttachments(workspaceId)

  // Local state for immediate UI updates
  const [content, setContent] = useState(initialContent)
  const [isCreating, setIsCreating] = useState(false)
  const hasInitialized = useRef(false)
  const prevParentMessageIdRef = useRef<string | null>(null)

  // Fetch parent stream's bootstrap to get the parent message
  const { data: parentBootstrap } = useStreamBootstrap(workspaceId, parentStreamId)

  const parentMessage = useMemo(() => {
    if (!parentBootstrap?.events) return null

    return parentBootstrap.events.find(
      (e) => e.eventType === "message_created" && (e.payload as { messageId?: string })?.messageId === parentMessageId
    )
  }, [parentBootstrap, parentMessageId])

  // Initialize content and attachments from saved draft, reset on parent message change
  useEffect(() => {
    const isParentChange = prevParentMessageIdRef.current !== null && prevParentMessageIdRef.current !== parentMessageId

    // On parent message change, reset state
    if (isParentChange) {
      hasInitialized.current = false
      setContent("")
      clearAttachments()
    }

    // Track parent message changes
    if (prevParentMessageIdRef.current !== parentMessageId) {
      prevParentMessageIdRef.current = parentMessageId
    }

    // Wait for Dexie to finish loading before initializing
    if (!isDraftLoaded) {
      return
    }

    // Restore saved draft content and attachments
    if (!hasInitialized.current) {
      if (savedDraft) {
        setContent(savedDraft)
      }
      if (savedAttachments.length > 0) {
        restoreAttachments(savedAttachments)
      }
      hasInitialized.current = true
    }
  }, [parentMessageId, isDraftLoaded, savedDraft, savedAttachments, restoreAttachments, clearAttachments])

  // When attachments change, persist to draft
  useEffect(() => {
    const uploaded = pendingAttachments.filter((a) => a.status === "uploaded" && !a.id.startsWith("temp_"))
    // Only update draft if we have uploaded attachments and we're past initialization
    if (hasInitialized.current && uploaded.length > 0) {
      // Sync each attachment to draft storage
      for (const a of uploaded) {
        addDraftAttachment({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })
      }
    }
  }, [pendingAttachments, addDraftAttachment])

  // Handle attachment removal from both UI and draft storage
  const handleRemoveAttachment = useCallback(
    (id: string) => {
      removeAttachment(id)
      removeDraftAttachment(id)
    },
    [removeAttachment, removeDraftAttachment]
  )

  // Handle content change with draft persistence
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent)
      saveDraftDebounced(newContent)
    },
    [saveDraftDebounced]
  )

  const canSend = (content.trim() || uploadedIds.length > 0) && !isCreating && !isUploading && !hasFailed

  const handleSubmit = useCallback(async () => {
    if (!canSend) return

    const trimmed = content.trim()
    setIsCreating(true)

    // Clear input immediately for responsiveness
    setContent("")
    clearDraft()
    const attachmentIds = uploadedIds
    clearAttachments()

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
      setIsCreating(false)
    }
  }, [
    canSend,
    content,
    clearDraft,
    uploadedIds,
    clearAttachments,
    streamService,
    workspaceId,
    parentStreamId,
    parentMessageId,
    messageService,
    onThreadCreated,
  ])

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
            <PendingAttachments attachments={pendingAttachments} onRemove={handleRemoveAttachment} />

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
                onChange={handleContentChange}
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
