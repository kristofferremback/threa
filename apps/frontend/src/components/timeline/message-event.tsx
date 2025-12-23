import { type ReactNode, useRef, useEffect } from "react"
import type { StreamEvent, AttachmentSummary } from "@threa/types"
import { Link } from "react-router-dom"
import { MessageSquareReply } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { usePendingMessages, usePanel } from "@/contexts"
import { cn } from "@/lib/utils"
import { AttachmentList } from "./attachment-list"
import { ThreadIndicator } from "./thread-indicator"

interface MessagePayload {
  messageId: string
  content: string
  contentFormat?: "markdown" | "plaintext"
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
        "group flex gap-3 py-2",
        isPersona && "bg-muted/30 -mx-4 px-4 rounded-lg",
        isHighlighted && "animate-highlight-flash",
        containerClassName
      )}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={cn(isPersona && "bg-primary text-primary-foreground")}>
          {isPersona ? "AI" : getInitials(event.actorId)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-sm">{isPersona ? "AI Companion" : formatActorId(event.actorId)}</span>
          {statusIndicator}
          {actions}
        </div>
        <MarkdownContent content={payload.content} className="mt-0.5 text-sm" />
        {payload.attachments && payload.attachments.length > 0 && (
          <AttachmentList attachments={payload.attachments} workspaceId={workspaceId} />
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
  hideActions?: boolean
  isHighlighted?: boolean
}

function SentMessageEvent({
  event,
  payload,
  workspaceId,
  streamId,
  hideActions,
  isHighlighted,
}: MessageEventInnerProps) {
  const { openPanels, getPanelUrl, openThreadDraft } = usePanel()
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
  const isParentOfCurrentThread = openPanels.some((p) => p.streamId === threadId)

  const handleReplyClick = () => {
    // Only used when no thread exists yet - opens draft UI
    openThreadDraft(streamId, payload.messageId)
  }

  // Thread link or "Reply in thread" text (hidden when hideActions is true)
  const threadFooter =
    !hideActions && threadId ? (
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
    ) : null

  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      statusIndicator={<RelativeTime date={event.createdAt} className="text-xs text-muted-foreground" />}
      actions={
        !hideActions &&
        !isParentOfCurrentThread && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
            {threadId ? (
              <Link
                to={getPanelUrl(threadId)}
                className="inline-flex items-center justify-center h-6 px-2 rounded-md hover:bg-accent"
              >
                <MessageSquareReply className="h-4 w-4" />
              </Link>
            ) : (
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={handleReplyClick}>
                <MessageSquareReply className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      }
      footer={threadFooter}
      containerRef={containerRef}
      isHighlighted={isHighlighted}
    />
  )
}

function PendingMessageEvent({ event, payload, workspaceId }: MessageEventInnerProps) {
  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      containerClassName="opacity-60"
      statusIndicator={
        <span className="text-xs text-muted-foreground opacity-0 animate-fade-in-delayed">Sending...</span>
      }
    />
  )
}

function FailedMessageEvent({ event, payload, workspaceId }: MessageEventInnerProps) {
  const { retryMessage } = usePendingMessages()

  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
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
  const status = getStatus(event.id)

  switch (status) {
    case "pending":
      return <PendingMessageEvent event={event} payload={payload} workspaceId={workspaceId} streamId={streamId} />
    case "failed":
      return <FailedMessageEvent event={event} payload={payload} workspaceId={workspaceId} streamId={streamId} />
    default:
      return (
        <SentMessageEvent
          event={event}
          payload={payload}
          workspaceId={workspaceId}
          streamId={streamId}
          hideActions={hideActions}
          isHighlighted={isHighlighted}
        />
      )
  }
}

function getInitials(actorId: string | null): string {
  if (!actorId) return "?"
  // For now, just use first two chars of the ID
  return actorId.substring(0, 2).toUpperCase()
}

function formatActorId(actorId: string | null): string {
  if (!actorId) return "Unknown"
  // For now, show truncated ID - will be replaced with user lookup
  return actorId.substring(0, 8)
}
