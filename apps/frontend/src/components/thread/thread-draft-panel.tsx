import { useMemo, useCallback } from "react"
import {
  SidePanel,
  SidePanelHeader,
  SidePanelTitle,
  SidePanelClose,
  SidePanelContent,
} from "@/components/ui/side-panel"
import { useStreamService, useMessageService } from "@/contexts"
import { useDraftComposer, useStreamBootstrap, getDraftMessageKey } from "@/hooks"
import { MessageComposer } from "@/components/composer"
import { ThreadParentMessage } from "./thread-parent-message"
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
    <SidePanel>
      <SidePanelHeader>
        <SidePanelTitle>New thread</SidePanelTitle>
        <SidePanelClose onClose={onClose} />
      </SidePanelHeader>
      <SidePanelContent className="flex flex-col">
        <div className="flex-1 overflow-y-auto">
          {parentMessage && (
            <ThreadParentMessage
              event={parentMessage}
              workspaceId={workspaceId}
              streamId={parentStreamId}
              replyCount={0}
            />
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
      </SidePanelContent>
    </SidePanel>
  )
}
