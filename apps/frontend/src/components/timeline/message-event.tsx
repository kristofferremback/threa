import type { StreamEvent } from "@/types/domain"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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

  return (
    <div className={cn("group flex gap-3 py-2", isPersona && "bg-muted/30 -mx-4 px-4 rounded-lg")}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={cn(isPersona && "bg-primary text-primary-foreground")}>
          {isPersona ? "AI" : getInitials(event.actorId)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-sm">
            {isPersona ? "AI Companion" : formatActorId(event.actorId)}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTime(event.createdAt)}
          </span>
        </div>
        <div className="mt-0.5 text-sm whitespace-pre-wrap break-words">
          {payload.content}
        </div>
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

function formatTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
