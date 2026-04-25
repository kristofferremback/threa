import { MessageSquareReply } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useStreamContextBag } from "@/hooks/use-stream-context-bag"
import { formatContextRefLabel } from "@/lib/context-bag/format-label"

interface MessageContextBadgeProps {
  workspaceId: string
  /** Stream the message lives in. Used to fetch the stream's persisted bag. */
  streamId: string
}

/**
 * Renders the context-bag attachment as a small inline pill anchored to the
 * first message of a bag-attached scratchpad — same UX pattern as a file
 * upload chip on a sent message. The bag is stream-level
 * (`stream_context_attachments`, INV-57) but we anchor it visually to the
 * opening message so the affordance "moves" with the conversation start
 * rather than living permanently above the composer.
 *
 * Pill styling intentionally matches `<PendingAttachments>` and the
 * pre-send `<ContextRefStrip>` so users see one visual language across the
 * composer-to-timeline lifecycle (chip moves onto the message at send).
 *
 * Renders nothing when the stream has no attached bag, so the per-message
 * cost of including this on every potentially-first message is one cached
 * fetch per stream.
 */
export function MessageContextBadge({ workspaceId, streamId }: MessageContextBadgeProps) {
  const { data } = useStreamContextBag(workspaceId, streamId)
  const refs = data?.refs ?? []
  if (refs.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {refs.map((ref) => {
        const label = formatContextRefLabel({
          slug: ref.source.slug,
          displayName: ref.source.displayName,
          streamType: ref.source.type,
          itemCount: ref.source.itemCount,
          fromMessageId: ref.fromMessageId,
          toMessageId: ref.toMessageId,
        })
        return (
          <TooltipProvider
            key={`${ref.kind}|${ref.streamId}|${ref.fromMessageId ?? ""}|${ref.toMessageId ?? ""}`}
            delayDuration={300}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium select-none",
                    "border border-primary/30 bg-primary/10 text-primary"
                  )}
                >
                  <MessageSquareReply className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate max-w-[220px]">{label}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px]">
                <p className="text-sm">Context attached to this conversation</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      })}
    </div>
  )
}
