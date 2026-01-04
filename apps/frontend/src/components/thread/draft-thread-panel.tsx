import { useMemo, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { MessageSquare } from "lucide-react"
import { useStreamService, useMessageService } from "@/contexts"
import {
  useDraftComposer,
  useStreamBootstrap,
  getDraftMessageKey,
  createOptimisticBootstrap,
  streamKeys,
} from "@/hooks"
import {
  SidePanel,
  SidePanelHeader,
  SidePanelTitle,
  SidePanelClose,
  SidePanelContent,
} from "@/components/ui/side-panel"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { MessageComposer } from "@/components/composer"
import { ThreadParentMessage } from "./thread-parent-message"
import { StreamTypes } from "@threa/types"

interface DraftThreadPanelProps {
  workspaceId: string
  parentStreamId: string
  parentMessageId: string
  initialContent?: string
  onClose: () => void
  onThreadCreated: (threadId: string) => void
}

export function DraftThreadPanel({
  workspaceId,
  parentStreamId,
  parentMessageId,
  initialContent = "",
  onClose,
  onThreadCreated,
}: DraftThreadPanelProps) {
  const queryClient = useQueryClient()
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

    // Capture full attachment info BEFORE clearing for optimistic UI
    const attachmentIds = composer.uploadedIds
    const attachments = composer.pendingAttachments
      .filter((a) => a.status === "uploaded" && !a.id.startsWith("temp_"))
      .map(({ id, filename, mimeType, sizeBytes }) => ({ id, filename, mimeType, sizeBytes }))

    // Clear input immediately for responsiveness
    composer.setContent("")
    composer.clearDraft()
    composer.clearAttachments()

    try {
      // Create the thread
      const thread = await streamService.create(workspaceId, {
        type: StreamTypes.THREAD,
        parentStreamId,
        parentMessageId,
      })

      // Send the first message with attachments
      const message = await messageService.create(workspaceId, thread.id, {
        streamId: thread.id,
        content: trimmed || " ", // Backend requires content
        contentFormat: "markdown",
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      })

      // Pre-populate the thread's cache so transition is instant
      queryClient.setQueryData(
        streamKeys.bootstrap(workspaceId, thread.id),
        createOptimisticBootstrap({
          stream: thread,
          message,
          content: trimmed || " ",
          contentFormat: "markdown",
          attachments: attachments.length > 0 ? attachments : undefined,
        })
      )

      // Transition to the real thread panel
      onThreadCreated(thread.id)
    } catch (error) {
      console.error("Failed to create thread:", error)
      composer.setIsSending(false)
    }
  }, [
    composer,
    streamService,
    workspaceId,
    parentStreamId,
    parentMessageId,
    messageService,
    queryClient,
    onThreadCreated,
  ])

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
          <Empty className="h-full border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquare />
              </EmptyMedia>
              <EmptyTitle>Start a new thread</EmptyTitle>
              <EmptyDescription>Write your reply below to create this thread.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
        <div className="p-4 border-t">
          <MessageComposer
            content={composer.content}
            onContentChange={composer.handleContentChange}
            pendingAttachments={composer.pendingAttachments}
            onRemoveAttachment={composer.handleRemoveAttachment}
            fileInputRef={composer.fileInputRef}
            onFileSelect={composer.handleFileSelect}
            onFileUpload={composer.uploadFile}
            imageCount={composer.imageCount}
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
