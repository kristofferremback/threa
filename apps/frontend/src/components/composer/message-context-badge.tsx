import { MessageSquareReply } from "lucide-react"
import { useStreamContextBag } from "@/hooks/use-stream-context-bag"
import { formatContextRefLabel } from "@/lib/context-bag/format-label"
import { buildContextRefSourceHref } from "@/lib/context-bag/source-link"
import { AttachmentPill } from "./attachment-pill"

interface MessageContextBadgeProps {
  workspaceId: string
  /** Stream the message lives in. Used to fetch the stream's persisted bag. */
  streamId: string
}

/**
 * Renders the stream's context-bag attachment as inline pills anchored to
 * the first message of a bag-attached scratchpad — same visual language as
 * the composer attachment row (`<AttachmentPill>` shared primitive). The
 * pill is a `<Link>` to the source thread, deep-linked to the originating
 * message when `fromMessageId` is set, so users can jump back to "where
 * this discussion came from."
 *
 * The bag is stream-level (`stream_context_attachments`, INV-57) but
 * anchoring it visually to the opening message matches how file-upload
 * pills work (composer pre-send → on the message post-send), so the chip
 * reads as "attached to this message" rather than as a permanent stream
 * banner.
 *
 * Renders synchronously from the bootstrap-hydrated cache for any stream
 * whose bootstrap has already loaded — no fetch wait, no layout shift on
 * first render. Returns null when the stream has no attached bag.
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
          <AttachmentPill
            key={`${ref.kind}|${ref.streamId}|${ref.fromMessageId ?? ""}|${ref.toMessageId ?? ""}`}
            icon={MessageSquareReply}
            label={label}
            tooltip="Click to open the source thread"
            href={buildContextRefSourceHref({
              workspaceId,
              sourceStreamId: ref.streamId,
              fromMessageId: ref.fromMessageId,
            })}
            labelMaxWidth="max-w-[220px]"
          />
        )
      })}
    </div>
  )
}
