import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { RelativeTime } from "@/components/relative-time"
import type { ConversationWithStaleness } from "@threa/types"

interface ConversationItemProps {
  conversation: ConversationWithStaleness
  onClick?: () => void
  className?: string
}

export function ConversationItem({ conversation, onClick, className }: ConversationItemProps) {
  const { topicSummary, messageIds, status, lastActivityAt, effectiveCompleteness, temporalStaleness } = conversation

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors",
        temporalStaleness >= 3 && "opacity-60",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{topicSummary || "Untitled conversation"}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">{messageIds.length} messages</span>
            <StatusBadge status={status} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <CompletenessIndicator score={effectiveCompleteness} />
          <RelativeTime date={lastActivityAt} className="text-xs text-muted-foreground" />
        </div>
      </div>
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return (
        <Badge variant="outline" className="text-xs py-0 px-1.5 h-5 bg-green-500/10 text-green-600 border-green-500/20">
          Active
        </Badge>
      )
    case "stalled":
      return (
        <Badge
          variant="outline"
          className="text-xs py-0 px-1.5 h-5 bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
        >
          Stalled
        </Badge>
      )
    case "resolved":
      return (
        <Badge variant="outline" className="text-xs py-0 px-1.5 h-5 bg-blue-500/10 text-blue-600 border-blue-500/20">
          Resolved
        </Badge>
      )
    default:
      return null
  }
}

function CompletenessIndicator({ score }: { score: number }) {
  const clampedScore = Math.max(1, Math.min(7, score))
  const segments = 7

  return (
    <div className="flex gap-0.5" title={`Completeness: ${clampedScore}/7`}>
      {Array.from({ length: segments }).map((_, i) => (
        <div key={i} className={cn("w-1.5 h-3 rounded-sm", i < clampedScore ? "bg-primary" : "bg-muted")} />
      ))}
    </div>
  )
}
