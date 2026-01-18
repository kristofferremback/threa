import { useSearchParams, Link, useParams } from "react-router-dom"
import { useMemo, useCallback } from "react"
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
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
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
import { StreamContent } from "@/components/timeline"
import { StreamErrorBoundary } from "@/components/stream-error-boundary"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { MessageComposer } from "@/components/composer"
import { ThreadParentMessage } from "./thread-parent-message"
import { ThreadHeader } from "./thread-header"
import { StreamTypes } from "@threa/types"

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

  // Check if a stream is the main view stream (to avoid duplicating it in panel)
  const isMainViewStream = (streamId: string) => {
    return mainViewStreamId === streamId
  }

  // Check if this is a draft panel
  const isDraft = isDraftPanel(panelId)
  const draftInfo = isDraft ? parseDraftPanel(panelId) : null

  // For real streams, fetch bootstrap
  const { data: bootstrap, error } = useStreamBootstrap(workspaceId, isDraft ? "" : panelId, {
    enabled: !isDraft,
  })
  const stream = bootstrap?.stream
  const isThread = stream?.type === StreamTypes.THREAD

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

  // Draft composer
  const draftKey = draftInfo ? getDraftMessageKey({ type: "thread", parentMessageId: draftInfo.parentMessageId }) : ""
  const composer = useDraftComposer({
    workspaceId,
    draftKey,
    scopeId: draftInfo?.parentMessageId ?? "",
    initialContent: "",
  })

  // Handle draft thread submission
  const handleSubmit = useCallback(async () => {
    if (!draftInfo || !composer.canSend) return

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
        parentStreamId: draftInfo.parentStreamId,
        parentMessageId: draftInfo.parentMessageId,
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

      // Transition: open the new thread panel (replaces draft panel)
      openPanel(thread.id)
    } catch (error) {
      console.error("Failed to create thread:", error)
      composer.setIsSending(false)
    }
  }, [draftInfo, composer, streamService, workspaceId, messageService, queryClient, openPanel])

  return (
    <SidePanel>
      <SidePanelHeader>
        {isDraft && parentBootstrap?.stream ? (
          // Draft thread header with breadcrumbs
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="flex-nowrap">
                {/* Ancestor breadcrumb items */}
                {ancestors.map((ancestor) => {
                  const displayName =
                    ancestor.type === "thread"
                      ? ancestor.displayName || "Thread"
                      : ancestor.slug
                        ? `#${ancestor.slug}`
                        : ancestor.displayName || "..."

                  // If this ancestor is the main view stream, close panel instead of navigating
                  if (isMainViewStream(ancestor.id)) {
                    return (
                      <div key={ancestor.id} className="contents">
                        <BreadcrumbItem className="max-w-[120px]">
                          <BreadcrumbLink asChild>
                            <button
                              onClick={closePanel}
                              className="truncate block text-left hover:underline cursor-pointer bg-transparent border-0 p-0 font-inherit"
                            >
                              {displayName}
                            </button>
                          </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                      </div>
                    )
                  }

                  return (
                    <div key={ancestor.id} className="contents">
                      <BreadcrumbItem className="max-w-[120px]">
                        <BreadcrumbLink asChild>
                          <Link to={getPanelUrl(ancestor.id)} className="truncate block">
                            {displayName}
                          </Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                    </div>
                  )
                })}
                {/* Parent stream */}
                <BreadcrumbItem className="max-w-[120px]">
                  <BreadcrumbLink asChild>
                    {isMainViewStream(draftInfo!.parentStreamId) ? (
                      <button
                        onClick={closePanel}
                        className="truncate block text-left hover:underline cursor-pointer bg-transparent border-0 p-0 font-inherit"
                      >
                        {parentBootstrap.stream.slug
                          ? `#${parentBootstrap.stream.slug}`
                          : parentBootstrap.stream.displayName || "Thread"}
                      </button>
                    ) : (
                      <Link to={getPanelUrl(draftInfo!.parentStreamId)} className="truncate block">
                        {parentBootstrap.stream.slug
                          ? `#${parentBootstrap.stream.slug}`
                          : parentBootstrap.stream.displayName || "Thread"}
                      </Link>
                    )}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                {/* Current draft */}
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate">New thread</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        ) : isThread && stream ? (
          <ThreadHeader workspaceId={workspaceId} stream={stream} onBack={onClose} inPanel />
        ) : (
          <SidePanelTitle>{stream?.displayName || "Stream"}</SidePanelTitle>
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
