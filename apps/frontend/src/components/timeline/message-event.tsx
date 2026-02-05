import { type ReactNode, useRef, useEffect } from "react"
import type { StreamEvent, AttachmentSummary } from "@threa/types"
import { Link } from "react-router-dom"
import { MessageSquareReply, Sparkles } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { MarkdownContent, AttachmentProvider } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { PersonaAvatar } from "@/components/persona-avatar"
import { usePendingMessages, usePanel, createDraftPanelId, useTrace } from "@/contexts"
import { useActors, getStepLabel, type MessageAgentActivity } from "@/hooks"
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
  sessionId?: string
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
  personaSlug,
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
          "bg-gradient-to-r from-primary/[0.06] to-transparent -mx-6 px-6 py-4 shadow-[inset_3px_0_0_hsl(var(--primary))]",
        isHighlighted && "animate-highlight-flash",
        containerClassName
      )}
    >
      {isPersona ? (
        <PersonaAvatar slug={personaSlug} fallback={actorInitials} size="md" className="message-avatar" />
      ) : (
        <Avatar className="message-avatar h-9 w-9 rounded-[10px] shrink-0">
          <AvatarFallback className="bg-muted text-foreground">{actorInitials}</AvatarFallback>
        </Avatar>
      )}
      <div className="message-content flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className={cn("font-semibold text-sm", isPersona && "text-primary")}>{actorName}</span>
          {statusIndicator}
          {actions}
        </div>
        <AttachmentProvider workspaceId={workspaceId} attachments={payload.attachments ?? []}>
          <MarkdownContent content={payload.contentMarkdown} className="text-sm leading-relaxed" />
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
  personaSlug?: string
  hideActions?: boolean
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
  hideActions,
  isHighlighted,
  activity,
}: MessageEventInnerProps) {
  const { panelId, getPanelUrl } = usePanel()
  const { getTraceUrl } = useTrace()
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

  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      actorName={actorName}
      actorInitials={actorInitials}
      personaSlug={personaSlug}
      statusIndicator={<RelativeTime date={event.createdAt} className="text-xs text-muted-foreground" />}
      actions={
        !hideActions && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex items-center gap-1">
            {/* Trace link for AI messages with sessionId */}
            {event.actorType === "persona" && payload.sessionId && (
              <Link
                to={getTraceUrl(payload.sessionId, payload.messageId)}
                className="inline-flex items-center justify-center h-6 px-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                title="View agent trace"
              >
                <Sparkles className="h-4 w-4" />
              </Link>
            )}
            {/* Reply in thread button (only when thread exists or agent activity has threadStreamId) */}
            {!isParentOfCurrentThread && effectiveThreadId && (
              <Link
                to={getPanelUrl(effectiveThreadId)}
                className="inline-flex items-center justify-center h-6 px-2 rounded-md hover:bg-accent"
              >
                <MessageSquareReply className="h-4 w-4" />
              </Link>
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

function PendingMessageEvent({
  event,
  payload,
  workspaceId,
  actorName,
  actorInitials,
  personaSlug,
}: MessageEventInnerProps) {
  return (
    <MessageLayout
      event={event}
      payload={payload}
      workspaceId={workspaceId}
      actorName={actorName}
      actorInitials={actorInitials}
      personaSlug={personaSlug}
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

  const actorName = getActorName(event.actorId, event.actorType)
  const { fallback: actorInitials, slug: personaSlug } = getActorAvatar(event.actorId, event.actorType)

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
          hideActions={hideActions}
          isHighlighted={isHighlighted}
          activity={activity}
        />
      )
  }
}
