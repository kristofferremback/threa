import { useSearchParams, useParams } from "react-router-dom"
import { useMemo, useCallback, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { MessageSquare, ChevronLeft } from "lucide-react"
import {
  SidePanel,
  SidePanelHeader,
  SidePanelTitle,
  SidePanelClose,
  SidePanelContent,
} from "@/components/ui/side-panel"
import { Button } from "@/components/ui/button"
import {
  useStreamBootstrap,
  useDraftComposer,
  getDraftMessageKey,
  createOptimisticBootstrap,
  streamKeys,
  useThreadAncestors,
} from "@/hooks"
import { usePanel, isDraftPanel, parseDraftPanel } from "@/contexts"
import { useStreamService, useMessageService } from "@/contexts"
import { StreamLoadingIndicator } from "@/components/loading"
import { StreamContent } from "@/components/timeline"
import { StreamErrorBoundary } from "@/components/stream-error-boundary"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { MessageComposer } from "@/components/composer"
import { ThreadParentMessage } from "./thread-parent-message"
import { ThreadHeader } from "./thread-header"
import { ResponsiveBreadcrumbs } from "./responsive-breadcrumbs"
import { StreamTypes, type JSONContent, type StreamType } from "@threa/types"
import { getStreamName, streamFallbackLabel } from "@/lib/streams"
import { serializeToMarkdown } from "@threa/prosemirror"

interface StreamPanelProps {
  workspaceId: string
  onClose: () => void
}

export function StreamPanel({ workspaceId, onClose }: StreamPanelProps) {
  const [searchParams] = useSearchParams()
  const highlightMessageId = searchParams.get("m")
  const { panelId, openPanel, getPanelUrl, closePanel } = usePanel()
  const queryClient = useQueryClient()
  const streamService = useStreamService()
  const messageService = useMessageService()
  const { streamId: mainViewStreamId } = useParams<{ streamId: string }>()

  // Get panel stream ID
  if (!panelId) return null

  const isMainViewStream = (streamId: string) => {
    return mainViewStreamId === streamId
  }

  // Check if this is a draft panel
  const isDraft = isDraftPanel(panelId)
  const draftInfo = isDraft ? parseDraftPanel(panelId) : null

  // For real streams, fetch bootstrap
  const {
    data: bootstrap,
    error,
    isLoading: isBootstrapLoading,
  } = useStreamBootstrap(workspaceId, isDraft ? "" : panelId, {
    enabled: !isDraft,
  })
  const stream = bootstrap?.stream
  const isThread = stream?.type === StreamTypes.THREAD

  // Show loading indicator only for real streams (not drafts) and only when actively loading after initial data
  const showLoadingIndicator = !isDraft && isBootstrapLoading && !bootstrap

  // For draft threads, fetch parent stream to get the parent message
  const { data: parentBootstrap } = useStreamBootstrap(workspaceId, draftInfo?.parentStreamId ?? "", {
    enabled: !!draftInfo,
  })

  // For draft threads, fetch parent stream's ancestors to build full breadcrumb trail
  const parentStream = parentBootstrap?.stream
  const { ancestors } = useThreadAncestors(
    workspaceId,
    parentStream?.id ?? "",
    parentStream?.parentStreamId ?? null,
    parentStream?.rootStreamId ?? null
  )

  const parentMessage = useMemo(() => {
    if (!draftInfo || !parentBootstrap?.events) return null
    return parentBootstrap.events.find(
      (e) =>
        e.eventType === "message_created" &&
        (e.payload as { messageId?: string })?.messageId === draftInfo.parentMessageId
    )
  }, [parentBootstrap, draftInfo])

  // Auto-convert draft to real thread when created externally (e.g., agent eager thread creation)
  const externalThreadId = useMemo(() => {
    if (!parentMessage) return null
    return (parentMessage.payload as { threadId?: string }).threadId ?? null
  }, [parentMessage])

  useEffect(() => {
    if (!isDraft || !externalThreadId) return
    openPanel(externalThreadId)
  }, [isDraft, externalThreadId, openPanel])

  // Draft composer
  const draftKey = draftInfo ? getDraftMessageKey({ type: "thread", parentMessageId: draftInfo.parentMessageId }) : ""
  const composer = useDraftComposer({
    workspaceId,
    draftKey,
    scopeId: draftInfo?.parentMessageId ?? "",
  })

  // Handle draft thread submission
  const handleSubmit = useCallback(async () => {
    if (!draftInfo || !composer.canSend) return

    composer.setIsSending(true)

    // Capture content before clearing
    const contentJson = composer.content
    const contentMarkdown = serializeToMarkdown(contentJson)

    // Capture full attachment info BEFORE clearing for optimistic UI
    const attachmentIds = composer.uploadedIds
    const attachments = composer.pendingAttachments
      .filter((a) => a.status === "uploaded" && !a.id.startsWith("temp_"))
      .map(({ id, filename, mimeType, sizeBytes }) => ({ id, filename, mimeType, sizeBytes }))

    // Clear input immediately for responsiveness
    const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }
    composer.setContent(emptyDoc)
    composer.clearDraft()
    composer.clearAttachments()

    try {
      // Create the thread
      const thread = await streamService.create(workspaceId, {
        type: StreamTypes.THREAD,
        parentStreamId: draftInfo.parentStreamId,
        parentMessageId: draftInfo.parentMessageId,
      })

      // Send the first message with attachments
      const message = await messageService.create(workspaceId, thread.id, {
        streamId: thread.id,
        contentJson,
        contentMarkdown,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      })

      // Pre-populate the thread's cache so transition is instant
      queryClient.setQueryData(
        streamKeys.bootstrap(workspaceId, thread.id),
        createOptimisticBootstrap({
          stream: thread,
          message,
          contentMarkdown,
          attachments: attachments.length > 0 ? attachments : undefined,
        })
      )

      // Invalidate parent stream's bootstrap to refetch with updated reply counts
      queryClient.invalidateQueries({
        queryKey: streamKeys.bootstrap(workspaceId, draftInfo.parentStreamId),
      })

      // Transition: open the new thread panel (replaces draft panel)
      openPanel(thread.id)
    } catch (error) {
      console.error("Failed to create thread:", error)
      composer.setIsSending(false)
    }
  }, [draftInfo, composer, streamService, workspaceId, messageService, queryClient, openPanel])

  // Build the full ancestor chain for draft breadcrumbs: hook ancestors + parent stream
  const fullChain = useMemo(() => {
    if (!draftInfo || !parentBootstrap?.stream) return []

    const parentItem = {
      id: draftInfo.parentStreamId,
      displayName: parentBootstrap.stream.displayName,
      slug: parentBootstrap.stream.slug,
      type: parentBootstrap.stream.type,
      parentStreamId: parentBootstrap.stream.parentStreamId,
    }

    return [...ancestors, parentItem]
  }, [ancestors, parentBootstrap?.stream, draftInfo])

  return (
    <SidePanel data-editor-zone="panel">
      <SidePanelHeader className="relative">
        <StreamLoadingIndicator isLoading={showLoadingIndicator} />
        {isDraft && parentBootstrap?.stream ? (
          // Draft thread header with responsive breadcrumbs
          <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden pr-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onClose}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <ResponsiveBreadcrumbs
              ancestors={fullChain}
              currentLabel="New thread"
              isMainViewStream={isMainViewStream}
              onClosePanel={closePanel}
              getNavigationUrl={getPanelUrl}
            />
          </div>
        ) : isThread && stream ? (
          <ThreadHeader workspaceId={workspaceId} stream={stream} inPanel />
        ) : (
          <SidePanelTitle>
            {stream ? (getStreamName(stream) ?? streamFallbackLabel(stream.type as StreamType, "generic")) : "Stream"}
          </SidePanelTitle>
        )}
        <SidePanelClose onClose={onClose} />
      </SidePanelHeader>

      <SidePanelContent className="flex flex-col">
        {isDraft && draftInfo ? (
          // Draft thread UI
          <>
            <div className="flex-1 overflow-y-auto">
              {parentMessage && (
                <ThreadParentMessage
                  event={parentMessage}
                  workspaceId={workspaceId}
                  streamId={draftInfo.parentStreamId}
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
            <div className="border-t">
              <div className="p-6 mx-auto max-w-[800px] w-full min-w-0">
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
                  autoFocus
                />
              </div>
            </div>
          </>
        ) : (
          // Regular stream UI
          <StreamErrorBoundary streamId={panelId} queryError={error}>
            <StreamContent
              workspaceId={workspaceId}
              streamId={panelId}
              highlightMessageId={highlightMessageId}
              stream={stream}
              autoFocus={isThread}
            />
          </StreamErrorBoundary>
        )}
      </SidePanelContent>
    </SidePanel>
  )
}
