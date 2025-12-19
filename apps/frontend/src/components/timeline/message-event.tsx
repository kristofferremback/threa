import type { StreamEvent } from "@threa/types"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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

export function MessageEvent({ event }: MessageEventProps) {
  const payload = event.payload as MessagePayload
  const isPersona = event.actorType === "persona"
  const { getStatus, retryMessage } = usePendingMessages()

  const status = getStatus(event.id)
  const isPending = status === "pending"
  const isFailed = status === "failed"

  return (
    <div
      className={cn(
        "group flex gap-3 py-2",
        isPersona && "bg-muted/30 -mx-4 px-4 rounded-lg",
        isPending && "opacity-60",
        isFailed && "border-l-2 border-destructive pl-2"
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
          {!isPending && !isFailed && <RelativeTime date={event.createdAt} className="text-xs text-muted-foreground" />}
          {isPending && (
            <span className="text-xs text-muted-foreground opacity-0 animate-fade-in-delayed">Sending...</span>
          )}
          {isFailed && <span className="text-xs text-destructive">Failed to send</span>}
        </div>
        <div className="mt-0.5 text-sm whitespace-pre-wrap break-words">{payload.content}</div>
        {isFailed && (
          <Button variant="ghost" size="sm" className="mt-1 h-6 px-2 text-xs" onClick={() => retryMessage(event.id)}>
            Retry
          </Button>
        )}
      </div>
    </div>
  )
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
