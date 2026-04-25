import { Loader2, MessageSquareReply, AlertCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useStreamContextBag } from "@/hooks/use-stream-context-bag"
import { formatContextRefLabel } from "@/lib/context-bag/format-label"
import type { DraftContextRef } from "@/lib/context-bag/types"

interface ContextRefStripProps {
  workspaceId: string
  /** Stream the strip lives in. Used to look up source-stream metadata for label rendering. */
  streamId: string
  /**
   * Sidecar refs from the live draft. The strip renders only when this list
   * is non-empty — once the user sends their first message and the draft is
   * cleared, the strip disappears and the chip "moves" into the timeline as
   * a `<MessageContextBadge>` on the first message (matches the
   * attachment-on-message UX every other chat app uses).
   */
  draftRefs?: DraftContextRef[]
}

interface PillProps {
  label: string
  status: "pending" | "ready" | "inline" | "error"
  errorMessage?: string | null
}

function ContextRefPill({ label, status, errorMessage }: PillProps) {
  let Icon = MessageSquareReply
  if (status === "pending") Icon = Loader2
  else if (status === "error") Icon = AlertCircle

  const baseStyles = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
    "select-none transition-colors"
  )

  const statusStyles: Record<PillProps["status"], string> = {
    pending: "border-muted-foreground/20 bg-muted/40 text-muted-foreground animate-pulse",
    ready: "border-primary/20 bg-primary/10 text-primary",
    inline: "border-primary/20 bg-primary/10 text-primary",
    error: "border-destructive/30 bg-destructive/10 text-destructive",
  }

  const tooltip = errorMessage ?? (status === "pending" ? "Preparing context…" : null)

  const content = (
    <span className={cn(baseStyles, statusStyles[status])}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", status === "pending" && "animate-spin")} />
      <span className="truncate max-w-[220px]">{label}</span>
    </span>
  )

  if (!tooltip) return content

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Inline strip rendered above the composer for any context refs attached to
 * the active draft. Renders nothing when the draft has no refs — including
 * the post-send case where the draft has cleared and the chip has migrated
 * to the timeline (`<MessageContextBadge>` on the first message). Same
 * lifecycle as a file upload pill: visible while composing, "moves" onto
 * the message at send.
 *
 * Labels still come from server source metadata via `useStreamContextBag`
 * so the chip says "12 messages in #intro" even mid-precompute. The query
 * is cheap (cached) and a no-op when the strip wouldn't render anyway.
 */
export function ContextRefStrip({ workspaceId, streamId, draftRefs }: ContextRefStripProps) {
  const hasDraftRefs = Boolean(draftRefs && draftRefs.length > 0)
  const { data } = useStreamContextBag(workspaceId, hasDraftRefs ? streamId : null)

  if (!hasDraftRefs || !draftRefs) return null

  const serverByStreamId = new Map((data?.refs ?? []).map((r) => [r.streamId, r]))

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
      {draftRefs.map((ref) => {
        const server = serverByStreamId.get(ref.streamId)
        const label = formatContextRefLabel({
          slug: server?.source.slug ?? null,
          displayName: server?.source.displayName ?? null,
          streamType: server?.source.type ?? null,
          itemCount: server?.source.itemCount ?? null,
          fromMessageId: ref.fromMessageId,
          toMessageId: ref.toMessageId,
        })
        return (
          <ContextRefPill
            key={`${ref.refKind}|${ref.streamId}|${ref.fromMessageId ?? ""}|${ref.toMessageId ?? ""}`}
            label={label}
            status={ref.status}
            errorMessage={ref.errorMessage}
          />
        )
      })}
    </div>
  )
}
