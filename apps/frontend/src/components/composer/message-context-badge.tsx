import { MessageSquareReply } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { StreamContextRef } from "@threa/types"
import { useCachedStreamContextBag } from "@/hooks/use-cached-stream-context-bag"
import { formatContextRefLabel } from "@/lib/context-bag/format-label"
import { buildContextRefSourceHref } from "@/lib/context-bag/source-link"

interface MessageContextBadgeProps {
  workspaceId: string
  /** Stream the message lives in. Used to look up the stream's cached bag. */
  streamId: string
}

/**
 * Renders the stream's context-bag attachment as inline pills anchored to
 * the first message of a bag-attached scratchpad. Uses the same `<Button
 * variant="outline" size="sm" h-8>` shape as `<AttachmentList>` file cards
 * so the bag chip + file chips on a sent message read as one row of
 * attachments at identical sizing.
 *
 * Reads synchronously from `useCachedStreamContextBag` (IDB-backed) so the
 * pill is present on first paint — matches how file attachments live on
 * the message payload and render without a fetch.
 *
 * The pill is a `<Link>` to the source thread, deep-linked to the
 * originating message via `?m=<messageId>` when set.
 */
export function MessageContextBadge({ workspaceId, streamId }: MessageContextBadgeProps) {
  const data = useCachedStreamContextBag(workspaceId, streamId)
  const refs = data.refs
  if (refs.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {refs.map((ref: StreamContextRef) => {
        const label = formatContextRefLabel({
          slug: ref.source.slug,
          displayName: ref.source.displayName,
          streamType: ref.source.type,
          itemCount: ref.source.itemCount,
          fromMessageId: ref.fromMessageId,
          toMessageId: ref.toMessageId,
        })
        const href = buildContextRefSourceHref({
          workspaceId,
          sourceStreamId: ref.streamId,
          originMessageId: ref.originMessageId,
        })
        return (
          <TooltipProvider
            key={`${ref.kind}|${ref.streamId}|${ref.fromMessageId ?? ""}|${ref.toMessageId ?? ""}`}
            delayDuration={300}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="outline" size="sm" className={cn("h-8 gap-2 text-xs")}>
                  <Link to={href}>
                    <MessageSquareReply className="h-3.5 w-3.5" />
                    <span className="max-w-[220px] truncate">{label}</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px]">
                <p className="text-sm">Click to open the source thread</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      })}
    </div>
  )
}
