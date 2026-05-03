import { useMemo } from "react"
import { Link } from "react-router-dom"
import { AlertCircle, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react"
import type { ScheduledMessageView } from "@threa/types"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { stripMarkdownToInline } from "@/lib/markdown"
import { formatFutureTime } from "@/lib/dates"
import { usePreferences } from "@/contexts"
import { useWorkspaceStreams } from "@/stores/workspace-store"

interface ScheduledItemProps {
  scheduled: ScheduledMessageView
  workspaceId: string
  onEdit?: (id: string) => void
  onCancel?: (id: string) => void
  onSendNow?: (id: string) => void
}

export function ScheduledItem({ scheduled, workspaceId, onEdit, onCancel, onSendNow }: ScheduledItemProps) {
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  // Stream name comes from the workspace store (sourced from IDB via the
  // workspace bootstrap pipeline). Fallback covers streams the user is no
  // longer a member of — the scheduled row may briefly outlive the
  // membership before the failure path catches it.
  const streams = useWorkspaceStreams(workspaceId)
  const streamName = streams.find((s) => s.id === scheduled.streamId)?.displayName ?? "stream"

  const preview = useMemo(() => stripMarkdownToInline(scheduled.contentMarkdown), [scheduled.contentMarkdown])

  const scheduledFor = useMemo(() => new Date(scheduled.scheduledFor), [scheduled.scheduledFor])
  const isPast = scheduledFor.getTime() <= Date.now()
  const timeLabel = scheduled.status === "pending" ? formatFutureTime(scheduledFor, new Date(), { timezone }) : null
  // Sub-1m = "Sending soon" so we don't render a stressful 0m countdown.
  // We rely on formatFutureTime returning "0m" / "1m" near zero; both surface
  // as "Sending soon" until the worker actually fires.
  const labelOrSoon =
    timeLabel && /^\d+m$/.test(timeLabel) && Number(timeLabel.replace("m", "")) <= 1 ? "Sending soon" : timeLabel

  const isFailed = scheduled.status === "failed"
  const isSent = scheduled.status === "sent"

  return (
    <div className={`flex items-start gap-3 border-b px-4 py-3 ${isFailed ? "border-l-4 border-l-destructive" : ""}`}>
      <div className="flex w-24 shrink-0 flex-col items-start gap-1 text-xs">
        {isPast && scheduled.status === "pending" ? (
          <Badge variant="outline" className="text-[10px]">
            Sending soon
          </Badge>
        ) : (
          <span className="font-medium tabular-nums text-muted-foreground">{labelOrSoon ?? "—"}</span>
        )}
        <Link
          to={`/w/${workspaceId}/s/${scheduled.streamId}`}
          className="truncate text-[11px] text-muted-foreground hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          #{streamName}
        </Link>
      </div>

      <div className="flex-1 min-w-0">
        <p className="line-clamp-2 text-sm">
          {preview || <span className="italic text-muted-foreground">(empty)</span>}
        </p>
        {scheduled.attachmentIds.length > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {scheduled.attachmentIds.length} attachment{scheduled.attachmentIds.length === 1 ? "" : "s"}
          </p>
        )}
        {isFailed && scheduled.lastError && (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-destructive">
            <AlertCircle className="h-3 w-3" />
            {scheduled.lastError}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {isSent && scheduled.sentMessageId ? (
          <Link
            to={`/w/${workspaceId}/s/${scheduled.streamId}?messageId=${scheduled.sentMessageId}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            View →
          </Link>
        ) : (
          <>
            {onEdit && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onEdit(scheduled.id)}
                disabled={!onEdit || scheduled.status !== "pending"}
                aria-label="Edit"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="ghost" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onSendNow && scheduled.status === "pending" && (
                  <DropdownMenuItem onSelect={() => onSendNow(scheduled.id)}>
                    <Send className="mr-2 h-4 w-4" /> Send now
                  </DropdownMenuItem>
                )}
                {onCancel && scheduled.status === "pending" && (
                  <DropdownMenuItem className="text-destructive" onSelect={() => onCancel(scheduled.id)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Cancel
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  )
}
