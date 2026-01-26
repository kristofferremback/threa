import { useSearchParams, useParams } from "react-router-dom"
import { useMemo, useCallback, useRef, useState, useEffect } from "react"
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
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage } from "@/components/ui/breadcrumb"
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
import { AncestorBreadcrumbItem } from "./breadcrumb-helpers"
import { BreadcrumbEllipsisDropdown } from "./breadcrumb-ellipsis-dropdown"
import { StreamTypes, type JSONContent } from "@threa/types"
import { serializeToMarkdown } from "@threa/prosemirror"

/** Breakpoints for progressive breadcrumb reduction */
const BREAKPOINTS = {
  /** Below: only current item */
  MINIMAL: 200,
  /** Below: root > current */
  COMPACT: 300,
  /** Below: root + 1 ancestor > current */
  MEDIUM: 450,
  /** Above: show all or root + 2 ancestors > current */
  FULL: 600,
}

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

  // Measure container for responsive breadcrumbs
  const headerRef = useRef<HTMLElement>(null)
  const [containerWidth, setContainerWidth] = useState(BREAKPOINTS.FULL)

  useEffect(() => {
    const container = headerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })

    observer.observe(container)
    setContainerWidth(container.offsetWidth)

    return () => observer.disconnect()
  }, [])

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
      // This ensures that when navigating back via breadcrumbs, the parent shows
      // the correct reply count for messages that now have nested threads
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

  // Progressive reduction: how many ancestors (including parent) can we show?
  const maxVisibleAncestors = useMemo(() => {
    if (containerWidth < BREAKPOINTS.MINIMAL) return 0
    if (containerWidth < BREAKPOINTS.COMPACT) return 1
    if (containerWidth < BREAKPOINTS.MEDIUM) return 2
    if (containerWidth < BREAKPOINTS.FULL) return 3
    return Infinity
  }, [containerWidth])

  // Width budget: "New thread" gets priority, ancestors share the rest
  const { ancestorMaxWidth, currentMaxWidth } = useMemo(() => {
    // Fixed overhead: back button + close button + flex gaps
    const fixedOverhead = 32 + 32 + 16
    // Each visible ancestor has a separator (">" + spacing) after it
    const separatorWidth = 24

    const totalAncestorCount = ancestors.length + (parentBootstrap?.stream ? 1 : 0)
    const visibleAncestorCount = Math.min(totalAncestorCount, maxVisibleAncestors)

    const totalSeparators = visibleAncestorCount * separatorWidth
    const available = Math.max(0, containerWidth - fixedOverhead - totalSeparators)

    if (visibleAncestorCount === 0) {
      return { ancestorMaxWidth: 0, currentMaxWidth: Math.min(available, 300) }
    }

    // Current item gets ~50% of remaining space (min 80px, max 200px)
    const currentShare = Math.min(200, Math.max(80, Math.floor(available * 0.5)))
    const ancestorBudget = available - currentShare
    const perAncestor = Math.max(40, Math.floor(ancestorBudget / visibleAncestorCount))

    return {
      ancestorMaxWidth: Math.min(perAncestor, 150),
      currentMaxWidth: currentShare,
    }
  }, [containerWidth, ancestors.length, maxVisibleAncestors, parentBootstrap?.stream])

  // Render draft breadcrumbs with progressive ellipsis
  // Chain: ancestors (from hook) + parent stream → then "New thread" is rendered separately
  const renderDraftBreadcrumbs = () => {
    if (!parentBootstrap?.stream || maxVisibleAncestors === 0) return null

    const parentItem = {
      id: draftInfo!.parentStreamId,
      displayName: parentBootstrap.stream.displayName,
      slug: parentBootstrap.stream.slug,
      type: parentBootstrap.stream.type,
      parentStreamId: parentBootstrap.stream.parentStreamId,
    }

    // Build the full ancestor chain: hook ancestors + parent stream
    const fullChain = [...ancestors, parentItem]

    // All fit — show them all
    if (fullChain.length <= maxVisibleAncestors) {
      return fullChain.map((item) => (
        <AncestorBreadcrumbItem
          key={item.id}
          stream={item}
          isMainViewStream={isMainViewStream(item.id)}
          onClosePanel={closePanel}
          getNavigationUrl={getPanelUrl}
          maxWidth={ancestorMaxWidth}
        />
      ))
    }

    // Too many: show first + ellipsis + last N
    const first = fullChain[0]
    const tailCount = Math.max(1, maxVisibleAncestors - 1)
    const hidden = fullChain.slice(1, fullChain.length - tailCount)
    const tail = fullChain.slice(fullChain.length - tailCount)

    return (
      <>
        <AncestorBreadcrumbItem
          stream={first}
          isMainViewStream={isMainViewStream(first.id)}
          onClosePanel={closePanel}
          getNavigationUrl={getPanelUrl}
          maxWidth={ancestorMaxWidth}
        />
        {hidden.length > 0 && (
          <BreadcrumbEllipsisDropdown
            items={hidden}
            getNavigationUrl={getPanelUrl}
            isMainViewStream={isMainViewStream}
            onClosePanel={closePanel}
          />
        )}
        {tail.map((item) => (
          <AncestorBreadcrumbItem
            key={item.id}
            stream={item}
            isMainViewStream={isMainViewStream(item.id)}
            onClosePanel={closePanel}
            getNavigationUrl={getPanelUrl}
            maxWidth={ancestorMaxWidth}
          />
        ))}
      </>
    )
  }

  return (
    <SidePanel>
      <SidePanelHeader ref={headerRef} className="relative">
        <StreamLoadingIndicator isLoading={showLoadingIndicator} />
        {isDraft && parentBootstrap?.stream ? (
          // Draft thread header with responsive breadcrumbs
          <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden pr-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onClose}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
              <BreadcrumbList className="flex-nowrap">
                {renderDraftBreadcrumbs()}
                {/* Current draft — gets priority width */}
                <BreadcrumbItem style={{ maxWidth: currentMaxWidth }}>
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
