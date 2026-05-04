import { useMemo } from "react"
import { Link } from "react-router-dom"
import { AlertCircle, Pencil, Send, Trash2 } from "lucide-react"
import type { ScheduledMessageView } from "@threa/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
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

/**
 * List row for the /scheduled page. Mirrors the SavedItem 3-line layout —
 * stream chip header, message preview, time-until footer — and the
 * hover-reveal action cluster on desktop / always-visible on mobile so the
 * page reads consistently with /saved and /drafts.
 *
 * Sent rows behave as links to the live message in its stream; pending and
 * failed rows expose Edit / Send now / Cancel as siblings (not nested under
 * the link) so action clicks don't bubble into navigation.
 */
export function ScheduledItem({ scheduled, workspaceId, onEdit, onCancel, onSendNow }: ScheduledItemProps) {
  const { preferences } = usePreferences()
  const timezone = preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  // Stream name comes from the workspace store. Fallback covers streams the
  // user is no longer a member of — the scheduled row may briefly outlive
  // the membership before the failure path catches it.
  const streams = useWorkspaceStreams(workspaceId)
  const streamName = streams.find((s) => s.id === scheduled.streamId)?.displayName ?? "stream"

  const preview = useMemo(
    () => stripMarkdownToInline(scheduled.contentMarkdown).trim() || "(empty)",
    [scheduled.contentMarkdown]
  )

  const scheduledFor = useMemo(() => new Date(scheduled.scheduledFor), [scheduled.scheduledFor])
  const rawLabel = formatFutureTime(scheduledFor, new Date(), { timezone })
  // Sub-1m falls through to "Sending soon" so we don't render a stressful 0m
  // countdown. formatFutureTime returns "0m" / "1m" near zero; both surface
  // as "Sending soon" until the worker actually fires.
  const labelOrSoon = /^\d+m$/.test(rawLabel) && Number(rawLabel.replace("m", "")) <= 1 ? "Sending soon" : rawLabel

  const isPending = scheduled.status === "pending"
  const isFailed = scheduled.status === "failed"
  const isSent = scheduled.status === "sent"
  const isCancelled = scheduled.status === "cancelled"

  const sentLink =
    isSent && scheduled.sentMessageId ? `/w/${workspaceId}/s/${scheduled.streamId}?m=${scheduled.sentMessageId}` : null

  let verbPrefix = "Sending to"
  if (isSent) verbPrefix = "Sent to"
  else if (isCancelled) verbPrefix = "Cancelled for"

  let timeLabel: string | null = null
  if (isPending) {
    timeLabel = labelOrSoon
  } else if (isSent) {
    timeLabel = `Sent ${formatFutureTime(new Date(scheduled.statusChangedAt), new Date(), { timezone })}`.replace(
      "Sent in ",
      "Sent "
    )
  }

  const Content = (
    <>
      <div className="flex items-baseline gap-1.5 text-sm">
        <span className="text-muted-foreground">{verbPrefix}</span>
        <span className="truncate font-medium">#{streamName}</span>
        {isFailed && (
          <span className="ml-1 inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-destructive">
            <AlertCircle className="h-3 w-3" />
            failed
          </span>
        )}
      </div>

      <p className={cn("mt-0.5 truncate text-xs text-muted-foreground", isFailed && "italic")}>
        {isFailed && scheduled.lastError ? scheduled.lastError : preview}
      </p>

      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground/60">
        {timeLabel && <span className="tabular-nums">{timeLabel}</span>}
        {scheduled.attachmentIds.length > 0 && (
          <span>
            {scheduled.attachmentIds.length} attachment{scheduled.attachmentIds.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </>
  )

  return (
    <div
      className={cn(
        "group flex items-start gap-3 border-b border-border/50 px-4 py-3 hover:bg-muted/40",
        isFailed && "border-l-4 border-l-destructive"
      )}
    >
      {sentLink ? (
        <Link to={sentLink} className="min-w-0 flex-1">
          {Content}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{Content}</div>
      )}

      <ScheduledRowActions scheduled={scheduled} onEdit={onEdit} onCancel={onCancel} onSendNow={onSendNow} />
    </div>
  )
}

interface ScheduledRowActionsProps {
  scheduled: ScheduledMessageView
  onEdit?: (id: string) => void
  onCancel?: (id: string) => void
  onSendNow?: (id: string) => void
}

/**
 * Hover-reveal on desktop, always-visible on mobile — same affordance shape as
 * SavedItem so the row reads consistently across pages. Only `pending` rows
 * expose the action cluster; sent/cancelled rows are link-only.
 */
function ScheduledRowActions({ scheduled, onEdit, onCancel, onSendNow }: ScheduledRowActionsProps) {
  if (scheduled.status !== "pending" && scheduled.status !== "failed") return null

  const canEdit = scheduled.status === "pending" && !!onEdit
  const canSendNow = scheduled.status === "pending" && !!onSendNow

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1",
        "sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100"
      )}
    >
      {canSendNow && (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => onSendNow!(scheduled.id)}
          title="Send now"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      )}
      {canEdit && (
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit!(scheduled.id)} title="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {onCancel && (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onCancel(scheduled.id)}
          title={scheduled.status === "failed" ? "Remove" : "Cancel"}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
