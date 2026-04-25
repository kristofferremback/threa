import { Loader2, MessageSquareReply, AlertCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useStreamContextBag } from "@/hooks/use-stream-context-bag"
import { formatContextRefLabel } from "@/lib/context-bag/format-label"
import type { DraftContextRef } from "@/lib/context-bag/types"

interface ContextRefStripProps {
  workspaceId: string
  /**
   * Stream the strip lives in. The server bag is fetched for this stream;
   * its refs point at the source streams the bag references.
   */
  streamId: string
  /**
   * Optional draft sidecar refs. When non-empty, takes precedence over the
   * server bag — lets the strip reflect in-flight precompute status while
   * the user composes their first message. Once the draft clears (after
   * send), the strip falls through to the server bag and stays visible
   * across reloads.
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
 * Inline strip rendered above the composer that surfaces any context refs
 * attached to the current stream. Handles two data sources:
 *
 * 1. **Draft sidecar** (pre-send) — `draftRefs` from `DraftMessage.contextRefs`.
 *    Takes precedence when non-empty so live precompute status (pending →
 *    ready) is reflected without waiting on the server fetch.
 * 2. **Server bag** (post-send / persistent) — `useStreamContextBag` queries
 *    `GET /streams/:id/context-bag`. Survives draft clear, page reload, and
 *    cross-device navigation.
 *
 * Renders nothing when neither source has refs — bag-free streams pay no
 * visual cost.
 */
export function ContextRefStrip({ workspaceId, streamId, draftRefs }: ContextRefStripProps) {
  const { data } = useStreamContextBag(workspaceId, streamId)

  // Draft sidecar takes precedence — labels still come from server source
  // metadata when available so the chip says "12 messages in #intro" even
  // mid-precompute. We index server refs by streamId for the lookup.
  if (draftRefs && draftRefs.length > 0) {
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

  const serverRefs = data?.refs ?? []
  if (serverRefs.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
      {serverRefs.map((ref) => {
        const label = formatContextRefLabel({
          slug: ref.source.slug,
          displayName: ref.source.displayName,
          streamType: ref.source.type,
          itemCount: ref.source.itemCount,
          fromMessageId: ref.fromMessageId,
          toMessageId: ref.toMessageId,
        })
        return (
          <ContextRefPill
            key={`${ref.kind}|${ref.streamId}|${ref.fromMessageId ?? ""}|${ref.toMessageId ?? ""}`}
            label={label}
            status="ready"
          />
        )
      })}
    </div>
  )
}
