import { type ReactNode, useRef, useEffect, useState, useMemo, useCallback } from "react"
import type { StreamEvent, AttachmentSummary, JSONContent } from "@threa/types"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { MarkdownContent, AttachmentProvider } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { PersonaAvatar } from "@/components/persona-avatar"
import { usePendingMessages, usePanel, createDraftPanelId, useTrace, useMessageService } from "@/contexts"
import { useEditLastMessage } from "./edit-last-message-context"
import { useInlineEdit } from "./inline-edit-context"
import { useActors, useWorkspaceUserId, getStepLabel, focusAtEnd, type MessageAgentActivity } from "@/hooks"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { useLongPress } from "@/hooks/use-long-press"
import { AttachmentList } from "./attachment-list"
import { MessageContextMenu } from "./message-context-menu"
import { MessageActionDrawer } from "./message-action-drawer"
import { ThreadIndicator } from "./thread-indicator"
import { DeleteMessageDialog } from "./delete-message-dialog"
import { MessageEditForm } from "./message-edit-form"
import { EditedIndicator } from "./edited-indicator"
import { MessageHistoryDialog } from "./message-history-dialog"

interface MessagePayload {
  messageId: string
  contentMarkdown: string
  contentJson?: JSONContent
  attachments?: AttachmentSummary[]
  replyCount?: number
  threadId?: string
  sessionId?: string
  editedAt?: string
}

interface MessageEventProps {
  event: StreamEvent
  workspaceId: string
  streamId: string
  /** This message is the thread parent shown at the top of the thread panel */
  isThreadParent?: boolean
  /** Whether to highlight this message (scroll into view and flash) */
  isHighlighted?: boolean
  /** Active agent session triggered by this message */
  activity?: MessageAgentActivity
}

interface MessageLayoutProps {
  event: StreamEvent
  payload: MessagePayload
  workspaceId: string
  actorName: string
  actorInitials: string
  /** Persona slug for SVG icon support (e.g., "ariadne") */
  personaSlug?: string
  /** User avatar image URL */
  actorAvatarUrl?: string
  statusIndicator: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  containerClassName?: string
  isHighlighted?: boolean
  isEditing?: boolean
  containerRef?: React.RefObject<HTMLDivElement | null>
  /** Whether this message was sent by the current user */
  isCurrentUser?: boolean
  /** Touch event handlers for mobile long-press */
  touchHandlers?: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchEnd: () => void
    onTouchMove: (e: React.TouchEvent) => void
    onContextMenu: (e: React.MouseEvent) => void
  }
}

function MessageLayout({
  event,
  payload,
  workspaceId,
  actorName,
  actorInitials,
  personaSlug,
  actorAvatarUrl,
  statusIndicator,
  actions,
  footer,
  children,
  containerClassName,
  isHighlighted,
  isEditing,
  containerRef,
  isCurrentUser,
  touchHandlers,
}: MessageLayoutProps) {
  const isPersona = event.actorType === "persona"
  const isSystem = event.actorType === "system"

  return (
    <div
      ref={containerRef}
      {...touchHandlers}
      className={cn(
        "message-item group relative flex gap-[14px] mb-5",
        // AI/Persona messages get full-width gradient with gold accent
        isPersona &&
          "bg-gradient-to-r from-primary/[0.06] to-transparent -mx-3 px-3 sm:-mx-6 sm:px-6 py-4 shadow-[inset_3px_0_0_hsl(var(--primary))]",
        // System messages get a subtle info-toned accent
        isSystem &&
          "bg-gradient-to-r from-blue-500/[0.04] to-transparent -mx-3 px-3 sm:-mx-6 sm:px-6 py-4 shadow-[inset_3px_0_0_hsl(210_100%_55%)]",
        // Current user's messages get a subtle tint for at-a-glance identification
        !isPersona && !isSystem && isCurrentUser && "bg-foreground/[0.03] -mx-3 px-3 sm:-mx-6 sm:px-6 py-3 rounded-sm",
        // Edit mode: pseudo-element background so no layout shift — zero padding/margin changes
        isEditing &&
          !isPersona &&
          !isSystem &&
          "before:content-[''] before:absolute before:-top-4 before:-bottom-4 before:-left-3 before:-right-3 sm:before:-left-6 sm:before:-right-6 before:bg-primary/[0.04] before:-z-10",
        isHighlighted && "animate-highlight-flash",
        containerClassName
      )}
    >
      {isPersona ? (
        <PersonaAvatar slug={personaSlug} fallback={actorInitials} size="md" className="message-avatar" />
      ) : (
        <Avatar className="message-avatar h-9 w-9 rounded-[10px] shrink-0">
          {actorAvatarUrl && <AvatarImage src={actorAvatarUrl} alt={actorName} />}
          <AvatarFallback className={cn("text-foreground", isSystem ? "bg-blue-500/10 text-blue-500" : "bg-muted")}>
            {actorInitials}
          </AvatarFallback>
        </Avatar>
      )}
      <div className="message-content flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className={cn("font-semibold text-sm", isPersona && "text-primary", isSystem && "text-blue-500")}>
            {actorName}
          </span>
          {statusIndicator}
          {actions}
        </div>
        {children ?? (
          <AttachmentProvider workspaceId={workspaceId} attachments={payload.attachments ?? []}>
            <MarkdownContent content={payload.contentMarkdown} className="text-sm leading-relaxed" />
            {payload.attachments && payload.attachments.length > 0 && (
              <AttachmentList attachments={payload.attachments} workspaceId={workspaceId} />
            )}
          </AttachmentProvider>
        )}
        {footer}
      </div>
    </div>
  )
}

interface MessageEventInnerProps {
  event: StreamEvent
  payload: MessagePayload
  workspaceId: string
  streamId: string
  actorName: string
  actorInitials: string
  personaSlug?: string
  actorAvatarUrl?: string
  isThreadParent?: boolean
  isHighlighted?: boolean
  activity?: MessageAgentActivity
}

function SentMessageEvent({
  event,
  payload,
  workspaceId,
  streamId,
  actorName,
  actorInitials,
  personaSlug,
  actorAvatarUrl,
  isThreadParent: isThreadParentProp,
  isHighlighted,
  activity,
}: MessageEventInnerProps) {
  const { panelId, getPanelUrl } = usePanel()
  const messageService = useMessageService()
  const currentUserId = useWorkspaceUserId(workspaceId)
  const { getTraceUrl } = useTrace()
  const replyCount = payload.replyCount ?? 0
  const threadId = payload.threadId
  const containerRef = useRef<HTMLDivElement>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Mobile: long-press opens action drawer instead of dropdown
  const isMobile = useIsMobile()
  const inlineEdit = useInlineEdit()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const longPress = useLongPress({
    onLongPress: openDrawer,
    enabled: isMobile && !isEditing,
  })

  const startEditing = useCallback(() => {
    setIsEditing(true)
    if (isMobile) {
      inlineEdit?.setEditingInline(true)
    }
  }, [isMobile, inlineEdit])

  // Reset inline edit context if the message unmounts while being edited
  // (e.g., message deleted by another user mid-edit)
  useEffect(() => {
    return () => {
      if (isEditing && isMobile) {
        inlineEdit?.setEditingInline(false)
      }
    }
  }, [isEditing, isMobile, inlineEdit])

  // Restore focus to the zone's editor after exiting inline edit mode
  const stopEditing = useCallback(() => {
    setIsEditing(false)
    if (isMobile) {
      inlineEdit?.setEditingInline(false)
      return
    }
    requestAnimationFrame(() => {
      const zone = containerRef.current?.closest<HTMLElement>("[data-editor-zone]")
      const editor = zone?.querySelector<HTMLElement>('[contenteditable="true"]')
      if (editor) focusAtEnd(editor)
    })
  }, [isMobile, inlineEdit])

  // Register this message's edit handler with the context so the composer's ArrowUp trigger
  // can imperatively open edit mode and scroll into view. Unregistered on unmount.
  const { registerMessage } = useEditLastMessage() ?? {}
  useEffect(() => {
    if (!registerMessage) return
    return registerMessage(payload.messageId, () => {
      containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      startEditing()
    })
  }, [payload.messageId, registerMessage, startEditing])

  // Scroll to this message when highlighted
  useEffect(() => {
    if (isHighlighted && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [isHighlighted])

  // Create draft panel URL for messages that don't have a thread yet
  const draftPanelId = createDraftPanelId(streamId, payload.messageId)
  const draftPanelUrl = getPanelUrl(draftPanelId)

  // Activity label for inline display in the footer
  const activityLabel = activity
    ? `${activity.personaName} is ${getStepLabel(activity.currentStepType).toLowerCase()}`
    : null

  // Thread link or "Reply in thread" text (hidden when hideActions is true)
  // Shows on hover when no thread exists yet, or always when thread exists
  // When agent activity is present, the activity text is always visible on the same line
  // When activity.threadStreamId is present, use it for the thread link (allows immediate
  // navigation to the real thread before the slower stream:created event updates threadId)
  const effectiveThreadId = threadId ?? activity?.threadStreamId
  let replyLink = (
    <Link
      to={draftPanelUrl}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:underline transition-opacity",
        !activityLabel && "opacity-0 group-hover:opacity-100 max-sm:opacity-100"
      )}
    >
      Reply in thread
    </Link>
  )

  if (effectiveThreadId) {
    replyLink =
      replyCount > 0 ? (
        <ThreadIndicator replyCount={replyCount} href={getPanelUrl(effectiveThreadId)} />
      ) : (
        <Link
          to={getPanelUrl(effectiveThreadId)}
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          Reply in thread
        </Link>
      )
  }

  const threadFooter = !isThreadParentProp ? (
    <div className="mt-1 flex items-center gap-1.5 text-xs">
      {replyLink}
      {activityLabel && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <Link
            to={getTraceUrl(activity!.sessionId)}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            {activityLabel}
          </Link>
        </>
      )}
    </div>
  ) : null

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await messageService.delete(workspaceId, payload.messageId)
      setDeleteDialogOpen(false)
    } catch {
      toast.error("Failed to delete message")
    } finally {
      setIsDeleting(false)
    }
  }

  // Shared action context for both desktop dropdown and mobile drawer
  const actionContext = useMemo(
    () => ({
      contentMarkdown: payload.contentMarkdown,
      actorType: event.actorType,
      sessionId: payload.sessionId,
      isThreadParent: panelId === threadId || isThreadParentProp,
      replyUrl: effectiveThreadId ? getPanelUrl(effectiveThreadId) : draftPanelUrl,
      traceUrl:
        event.actorType === "persona" && payload.sessionId
          ? getTraceUrl(payload.sessionId, payload.messageId)
          : undefined,
      messageId: payload.messageId,
      authorId: event.actorId ?? undefined,
      currentUserId: currentUserId ?? undefined,
      editedAt: payload.editedAt,
      onEdit: startEditing,
      onDelete: () => setDeleteDialogOpen(true),
      // Deferred to next tick so the DropdownMenu/ActionDrawer fully unmounts
      // before the Dialog opens — Radix emits synthetic pointer events on menu
      // close that trigger the Dialog's "click outside" handler otherwise.
      onShowHistory: () => setTimeout(() => setHistoryOpen(true), 0),
    }),
    [
      payload.contentMarkdown,
      payload.sessionId,
      payload.messageId,
      payload.editedAt,
      event.actorType,
      event.actorId,
      panelId,
      threadId,
      isThreadParentProp,
      effectiveThreadId,
      getPanelUrl,
      draftPanelUrl,
      getTraceUrl,
      currentUserId,
      startEditing,
    ]
  )

  return (
    <>
      <MessageLayout
        event={event}
        payload={payload}
        workspaceId={workspaceId}
        actorName={actorName}
        actorInitials={actorInitials}
        personaSlug={personaSlug}
        actorAvatarUrl={actorAvatarUrl}
        isCurrentUser={currentUserId !== null && event.actorId === currentUserId}
        statusIndicator={
          <>
            <RelativeTime date={event.createdAt} className="text-xs text-muted-foreground" />
            {payload.editedAt && (
              <EditedIndicator editedAt={payload.editedAt} onShowHistory={() => setHistoryOpen(true)} />
            )}
          </>
        }
        isEditing={isEditing && !isMobile}
        actions={
          // Desktop: hover-reveal dropdown menu. Mobile: hidden (long-press opens drawer instead).
          <div
            className={cn(
              "opacity-0 group-hover:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity ml-auto hidden sm:flex items-center gap-1",
              isEditing && "!opacity-0 pointer-events-none"
            )}
          >
            <MessageContextMenu context={actionContext} />
          </div>
        }
        footer={isEditing && !isMobile ? undefined : threadFooter}
        containerRef={containerRef}
        isHighlighted={isHighlighted}
        containerClassName={cn(
          "scroll-mt-12",
          isMobile && !isEditing && "select-none",
          longPress.isPressed && "opacity-70 transition-opacity duration-100"
        )}
        touchHandlers={isMobile ? longPress.handlers : undefined}
      >
        {/* Desktop: inline edit replaces message content. Mobile: drawer handles editing. */}
        {isEditing && !isMobile ? (
          <MessageEditForm
            messageId={payload.messageId}
            workspaceId={workspaceId}
            initialContentJson={payload.contentJson}
            onSave={stopEditing}
            onCancel={stopEditing}
          />
        ) : undefined}
      </MessageLayout>
      {/* Mobile: edit in a bottom-sheet drawer (avoids scroll/keyboard issues) */}
      {isEditing && isMobile && (
        <MessageEditForm
          messageId={payload.messageId}
          workspaceId={workspaceId}
          initialContentJson={payload.contentJson}
          onSave={stopEditing}
          onCancel={stopEditing}
          authorName={actorName}
        />
      )}
      {deleteDialogOpen && (
        <DeleteMessageDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
        />
      )}
      {historyOpen && (
        <MessageHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          messageId={payload.messageId}
          workspaceId={workspaceId}
          messageCreatedAt={event.createdAt}
          currentContent={{
            contentMarkdown: payload.contentMarkdown,
            editedAt: payload.editedAt,
          }}
        />
      )}
      {isMobile && (
        <MessageActionDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          context={actionContext}
          authorName={actorName}
        />
      )}
    </>
  )
}

function PendingMessageEvent({
  event,
  payload,
  workspaceId,
  actorName,
  actorInitials,
  personaSlug,
  actorAvatarUrl,
}: MessageEventInnerProps) {
  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      actorName={actorName}
      actorInitials={actorInitials}
      personaSlug={personaSlug}
      actorAvatarUrl={actorAvatarUrl}
      isCurrentUser
      containerClassName="opacity-60"
      statusIndicator={
        <span className="text-xs text-muted-foreground opacity-0 animate-fade-in-delayed">Sending...</span>
      }
    />
  )
}

function FailedMessageEvent({
  event,
  payload,
  workspaceId,
  actorName,
  actorInitials,
  personaSlug,
  actorAvatarUrl,
}: MessageEventInnerProps) {
  const { retryMessage } = usePendingMessages()

  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      actorName={actorName}
      actorInitials={actorInitials}
      personaSlug={personaSlug}
      actorAvatarUrl={actorAvatarUrl}
      containerClassName="border-l-2 border-destructive pl-2"
      statusIndicator={<span className="text-xs text-destructive">Failed to send</span>}
      actions={
        <Button variant="ghost" size="sm" className="mt-1 h-6 px-2 text-xs" onClick={() => retryMessage(event.id)}>
          Retry
        </Button>
      }
    />
  )
}

export function MessageEvent({
  event,
  workspaceId,
  streamId,
  isThreadParent,
  isHighlighted,
  activity,
}: MessageEventProps) {
  const payload = event.payload as MessagePayload
  const { getStatus } = usePendingMessages()
  const { getActorName, getActorAvatar } = useActors(workspaceId)
  const status = getStatus(event.id)

  const actorName = getActorName(event.actorId, event.actorType)
  const {
    fallback: actorInitials,
    slug: personaSlug,
    avatarUrl: actorAvatarUrl,
  } = getActorAvatar(event.actorId, event.actorType)

  switch (status) {
    case "pending":
      return (
        <PendingMessageEvent
          event={event}
          payload={payload}
          workspaceId={workspaceId}
          streamId={streamId}
          actorName={actorName}
          actorInitials={actorInitials}
          personaSlug={personaSlug}
          actorAvatarUrl={actorAvatarUrl}
        />
      )
    case "failed":
      return (
        <FailedMessageEvent
          event={event}
          payload={payload}
          workspaceId={workspaceId}
          streamId={streamId}
          actorName={actorName}
          actorInitials={actorInitials}
          personaSlug={personaSlug}
          actorAvatarUrl={actorAvatarUrl}
        />
      )
    default:
      return (
        <SentMessageEvent
          event={event}
          payload={payload}
          workspaceId={workspaceId}
          streamId={streamId}
          actorName={actorName}
          actorInitials={actorInitials}
          personaSlug={personaSlug}
          actorAvatarUrl={actorAvatarUrl}
          isThreadParent={isThreadParent}
          isHighlighted={isHighlighted}
          activity={activity}
        />
      )
  }
}
