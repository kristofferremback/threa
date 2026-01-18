import { type ReactNode, useRef, useEffect } from "react"
import type { StreamEvent, AttachmentSummary } from "@threa/types"
import { Link } from "react-router-dom"
import { MessageSquareReply } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { MarkdownContent, AttachmentProvider } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { usePendingMessages, usePanel, createDraftPanelId } from "@/contexts"
import { useActors } from "@/hooks"
import { cn } from "@/lib/utils"
import { AttachmentList } from "./attachment-list"
import { ThreadIndicator } from "./thread-indicator"

interface MessagePayload {
  messageId: string
  contentMarkdown: string
  contentJson?: unknown
  attachments?: AttachmentSummary[]
  replyCount?: number
  threadId?: string
}

interface MessageEventProps {
  event: StreamEvent
  workspaceId: string
  streamId: string
  /** Hide action buttons and thread footer - used when showing parent message in thread view */
  hideActions?: boolean
  /** Whether to highlight this message (scroll into view and flash) */
  isHighlighted?: boolean
}

interface MessageLayoutProps {
  event: StreamEvent
  payload: MessagePayload
  workspaceId: string
  actorName: string
  actorInitials: string
  statusIndicator: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  containerClassName?: string
  isHighlighted?: boolean
  containerRef?: React.RefObject<HTMLDivElement | null>
}

function MessageLayout({
  event,
  payload,
  workspaceId,
  actorName,
  actorInitials,
  statusIndicator,
  actions,
  footer,
  containerClassName,
  isHighlighted,
  containerRef,
}: MessageLayoutProps) {
  const isPersona = event.actorType === "persona"

  return (
    <div
      ref={containerRef}
      className={cn(
        "message-item group flex gap-[14px] mb-5",
        // AI/Persona messages get full-width gradient with gold accent
        isPersona &&
          "bg-gradient-to-r from-primary/[0.06] to-transparent -mx-6 px-6 py-4 border-l-[3px] border-l-primary",
        isHighlighted && "animate-highlight-flash",
        containerClassName
      )}
    >
      <Avatar className="message-avatar h-9 w-9 rounded-[10px] shrink-0">
        <AvatarFallback className={cn("bg-muted text-foreground", isPersona && "bg-primary text-primary-foreground")}>
          {actorInitials}
        </AvatarFallback>
      </Avatar>
      <div className="message-content flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className={cn("font-semibold text-sm", isPersona && "text-primary")}>{actorName}</span>
          {statusIndicator}
          {actions}
        </div>
        <AttachmentProvider workspaceId={workspaceId} attachments={payload.attachments ?? []}>
          <MarkdownContent content={payload.content} className="text-sm leading-relaxed" />
          {payload.attachments && payload.attachments.length > 0 && (
            <AttachmentList attachments={payload.attachments} workspaceId={workspaceId} />
          )}
        </AttachmentProvider>
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
  hideActions?: boolean
  isHighlighted?: boolean
}

function SentMessageEvent({
  event,
  payload,
  workspaceId,
  streamId,
  actorName,
  actorInitials,
  hideActions,
  isHighlighted,
}: MessageEventInnerProps) {
  const { panelId, getPanelUrl } = usePanel()
  const replyCount = payload.replyCount ?? 0
  const threadId = payload.threadId
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll to this message when highlighted
  useEffect(() => {
    if (isHighlighted && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [isHighlighted])

  // Don't show reply button if we're viewing this message as the thread parent
  const isParentOfCurrentThread = panelId === threadId

  // Create draft panel URL for messages that don't have a thread yet
  const draftPanelId = createDraftPanelId(streamId, payload.messageId)
  const draftPanelUrl = getPanelUrl(draftPanelId)

  // Thread link or "Reply in thread" text (hidden when hideActions is true)
  // Shows on hover when no thread exists yet, or always when thread exists
  const threadFooter = !hideActions ? (
    threadId ? (
      replyCount > 0 ? (
        <ThreadIndicator replyCount={replyCount} href={getPanelUrl(threadId)} className="mt-1" />
      ) : (
        <Link
          to={getPanelUrl(threadId)}
          className="mt-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Reply in thread
        </Link>
      )
    ) : (
      // Show "Reply in thread" on hover when no thread exists - opens draft panel
      <Link
        to={draftPanelUrl}
        className="mt-1 text-xs text-muted-foreground hover:text-foreground hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
      >
        Reply in thread
      </Link>
    )
  ) : null

  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      actorName={actorName}
      actorInitials={actorInitials}
      statusIndicator={<RelativeTime date={event.createdAt} className="text-xs text-muted-foreground" />}
      actions={
        // Only show the icon button when thread exists (to open it)
        // For messages without threads, we show "Reply in thread" text in footer on hover
        !hideActions &&
        !isParentOfCurrentThread &&
        threadId && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
            <Link
              to={getPanelUrl(threadId)}
              className="inline-flex items-center justify-center h-6 px-2 rounded-md hover:bg-accent"
            >
              <MessageSquareReply className="h-4 w-4" />
            </Link>
          </div>
        )
      }
      footer={threadFooter}
      containerRef={containerRef}
      isHighlighted={isHighlighted}
    />
  )
}

function PendingMessageEvent({ event, payload, workspaceId, actorName, actorInitials }: MessageEventInnerProps) {
  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      actorName={actorName}
      actorInitials={actorInitials}
      containerClassName="opacity-60"
      statusIndicator={
        <span className="text-xs text-muted-foreground opacity-0 animate-fade-in-delayed">Sending...</span>
      }
    />
  )
}

function FailedMessageEvent({ event, payload, workspaceId, actorName, actorInitials }: MessageEventInnerProps) {
  const { retryMessage } = usePendingMessages()

  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      actorName={actorName}
      actorInitials={actorInitials}
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

export function MessageEvent({ event, workspaceId, streamId, hideActions, isHighlighted }: MessageEventProps) {
  const payload = event.payload as MessagePayload
  const { getStatus } = usePendingMessages()
  const { getActorName, getActorInitials } = useActors(workspaceId)
  const status = getStatus(event.id)

  const actorName = getActorName(event.actorId, event.actorType)
  const actorInitials = getActorInitials(event.actorId, event.actorType)

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
          hideActions={hideActions}
          isHighlighted={isHighlighted}
        />
      )
  }
}
