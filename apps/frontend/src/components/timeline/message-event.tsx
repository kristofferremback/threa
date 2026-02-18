import { type ReactNode, useRef, useEffect, useState, useMemo } from "react"
import type { StreamEvent, AttachmentSummary, JSONContent } from "@threa/types"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { MarkdownContent, AttachmentProvider } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { PersonaAvatar } from "@/components/persona-avatar"
import { usePendingMessages, usePanel, createDraftPanelId, useTrace } from "@/contexts"
import { useActors, useWorkspaceBootstrap, getStepLabel, type MessageAgentActivity } from "@/hooks"
import { useUser } from "@/auth"
import { messagesApi } from "@/api/messages"
import { cn } from "@/lib/utils"
import { AttachmentList } from "./attachment-list"
import { MessageContextMenu } from "./message-context-menu"
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
  /** Hide action buttons and thread footer - used when showing parent message in thread view */
  hideActions?: boolean
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
  /** Member avatar image URL */
  actorAvatarUrl?: string
  statusIndicator: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  containerClassName?: string
  isHighlighted?: boolean
  isEditing?: boolean
  containerRef?: React.RefObject<HTMLDivElement | null>
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
}: MessageLayoutProps) {
  const isPersona = event.actorType === "persona"
  const isSystem = event.actorType === "system"

  return (
    <div
      ref={containerRef}
      className={cn(
        "message-item group relative flex gap-[14px] mb-5",
        // AI/Persona messages get full-width gradient with gold accent
        isPersona &&
          "bg-gradient-to-r from-primary/[0.06] to-transparent -mx-6 px-6 py-4 shadow-[inset_3px_0_0_hsl(var(--primary))]",
        // System messages get a subtle info-toned accent
        isSystem &&
          "bg-gradient-to-r from-blue-500/[0.04] to-transparent -mx-6 px-6 py-4 shadow-[inset_3px_0_0_hsl(210_100%_55%)]",
        // Edit mode: pseudo-element background so no layout shift — zero padding/margin changes
        isEditing &&
          !isPersona &&
          !isSystem &&
          "before:content-[''] before:absolute before:-top-4 before:-bottom-4 before:-left-6 before:-right-6 before:bg-primary/[0.04] before:-z-10",
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
  hideActions?: boolean
  isHighlighted?: boolean
  activity?: MessageAgentActivity
  currentMemberId: string | null
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
  hideActions,
  isHighlighted,
  activity,
  currentMemberId,
}: MessageEventInnerProps) {
  const { panelId, getPanelUrl } = usePanel()
  const { getTraceUrl } = useTrace()
  const replyCount = payload.replyCount ?? 0
  const threadId = payload.threadId
  const containerRef = useRef<HTMLDivElement>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

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
  const threadFooter = !hideActions ? (
    <div className="mt-1 flex items-center gap-1.5 text-xs">
      {effectiveThreadId ? (
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
      ) : (
        <Link
          to={draftPanelUrl}
          className={cn(
            "text-muted-foreground hover:text-foreground hover:underline transition-opacity",
            !activityLabel && "opacity-0 group-hover:opacity-100"
          )}
        >
          Reply in thread
        </Link>
      )}
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
      await messagesApi.delete(workspaceId, payload.messageId)
      setDeleteDialogOpen(false)
    } catch {
      toast.error("Failed to delete message")
    } finally {
      setIsDeleting(false)
    }
  }

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
        statusIndicator={
          <>
            <RelativeTime date={event.createdAt} className="text-xs text-muted-foreground" />
            {payload.editedAt && (
              <EditedIndicator editedAt={payload.editedAt} onShowHistory={() => setHistoryOpen(true)} />
            )}
          </>
        }
        isEditing={isEditing}
        actions={
          !hideActions && (
            <div
              className={cn(
                "opacity-0 group-hover:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity ml-auto flex items-center gap-1",
                isEditing && "!opacity-0 pointer-events-none"
              )}
            >
              <MessageContextMenu
                context={{
                  contentMarkdown: payload.contentMarkdown,
                  actorType: event.actorType,
                  sessionId: payload.sessionId,
                  isThreadParent: panelId === threadId,
                  replyUrl: effectiveThreadId ? getPanelUrl(effectiveThreadId) : draftPanelUrl,
                  traceUrl:
                    event.actorType === "persona" && payload.sessionId
                      ? getTraceUrl(payload.sessionId, payload.messageId)
                      : undefined,
                  messageId: payload.messageId,
                  authorId: event.actorId ?? undefined,
                  currentMemberId: currentMemberId ?? undefined,
                  onEdit: () => setIsEditing(true),
                  onDelete: () => setDeleteDialogOpen(true),
                }}
              />
            </div>
          )
        }
        footer={isEditing ? undefined : threadFooter}
        containerRef={containerRef}
        isHighlighted={isHighlighted}
      >
        {isEditing ? (
          <MessageEditForm
            messageId={payload.messageId}
            workspaceId={workspaceId}
            initialContentJson={payload.contentJson}
            onSave={() => setIsEditing(false)}
            onCancel={() => setIsEditing(false)}
          />
        ) : undefined}
      </MessageLayout>
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
          currentContent={{
            contentMarkdown: payload.contentMarkdown,
            editedAt: payload.editedAt,
          }}
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
  hideActions,
  isHighlighted,
  activity,
}: MessageEventProps) {
  const payload = event.payload as MessagePayload
  const { getStatus } = usePendingMessages()
  const { getActorName, getActorAvatar } = useActors(workspaceId)
  const status = getStatus(event.id)

  const user = useUser()
  const { data: wsBootstrap } = useWorkspaceBootstrap(workspaceId)
  const currentMemberId = useMemo(
    () => wsBootstrap?.members?.find((m) => m.userId === user?.id)?.id ?? null,
    [wsBootstrap?.members, user?.id]
  )

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
          currentMemberId={currentMemberId}
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
          currentMemberId={currentMemberId}
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
          hideActions={hideActions}
          isHighlighted={isHighlighted}
          activity={activity}
          currentMemberId={currentMemberId}
        />
      )
  }
}
