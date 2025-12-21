import type { ReactNode } from "react"
import type { StreamEvent } from "@threa/types"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { usePendingMessages } from "@/contexts"
import { cn } from "@/lib/utils"

interface MessagePayload {
  messageId: string
  content: string
  contentFormat?: "markdown" | "plaintext"
}

interface MessageEventProps {
  event: StreamEvent
  workspaceId: string
  streamId: string
}

interface MessageLayoutProps {
  event: StreamEvent
  payload: MessagePayload
  statusIndicator: ReactNode
  actions?: ReactNode
  containerClassName?: string
}

function MessageLayout({ event, payload, statusIndicator, actions, containerClassName }: MessageLayoutProps) {
  const isPersona = event.actorType === "persona"

  return (
    <div className={cn("group flex gap-3 py-2", isPersona && "bg-muted/30 -mx-4 px-4 rounded-lg", containerClassName)}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={cn(isPersona && "bg-primary text-primary-foreground")}>
          {isPersona ? "AI" : getInitials(event.actorId)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-sm">{isPersona ? "AI Companion" : formatActorId(event.actorId)}</span>
          {statusIndicator}
        </div>
        <MarkdownContent content={payload.content} className="mt-0.5 text-sm" />
        {actions}
      </div>
    </div>
  )
}

function SentMessageEvent({ event, payload }: { event: StreamEvent; payload: MessagePayload }) {
  return (
    <MessageLayout
      event={event}
      payload={payload}
      statusIndicator={<RelativeTime date={event.createdAt} className="text-xs text-muted-foreground" />}
    />
  )
}

function PendingMessageEvent({ event, payload }: { event: StreamEvent; payload: MessagePayload }) {
  return (
    <MessageLayout
      event={event}
      payload={payload}
      containerClassName="opacity-60"
      statusIndicator={
        <span className="text-xs text-muted-foreground opacity-0 animate-fade-in-delayed">Sending...</span>
      }
    />
  )
}

function FailedMessageEvent({ event, payload }: { event: StreamEvent; payload: MessagePayload }) {
  const { retryMessage } = usePendingMessages()

  return (
    <MessageLayout
      event={event}
      payload={payload}
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

export function MessageEvent({ event }: MessageEventProps) {
  const payload = event.payload as MessagePayload
  const { getStatus } = usePendingMessages()
  const status = getStatus(event.id)

  switch (status) {
    case "pending":
      return <PendingMessageEvent event={event} payload={payload} />
    case "failed":
      return <FailedMessageEvent event={event} payload={payload} />
    default:
      return <SentMessageEvent event={event} payload={payload} />
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
