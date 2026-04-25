import { Loader2, MessageSquareReply, AlertCircle } from "lucide-react"
import { useStreamContextBag } from "@/hooks/use-stream-context-bag"
import { formatContextRefLabel } from "@/lib/context-bag/format-label"
import { buildContextRefSourceHref } from "@/lib/context-bag/source-link"
import type { DraftContextRef } from "@/lib/context-bag/types"
import { AttachmentPill, type AttachmentPillStatus } from "./attachment-pill"

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

const STATUS_MAP: Record<DraftContextRef["status"], AttachmentPillStatus> = {
  pending: "pending",
  ready: "default",
  inline: "default",
  error: "error",
}

const STATUS_ICON: Record<DraftContextRef["status"], typeof MessageSquareReply> = {
  pending: Loader2,
  ready: MessageSquareReply,
  inline: MessageSquareReply,
  error: AlertCircle,
}

/**
 * Inline strip rendered above the composer for any context refs attached
 * to the active draft. Uses the same `<AttachmentPill>` primitive as
 * `<PendingAttachments>` so context refs and uploaded files read as one
 * type of "thing attached to this message."
 *
 * Renders nothing when the draft has no refs — the post-send case where
 * the chip migrates to the timeline as `<MessageContextBadge>` on the
 * first message is intentionally separate.
 *
 * Each pill is a `<Link>` to the source thread, deep-linked to the
 * specific message when `fromMessageId` is set, so users can jump back to
 * "where this discussion came from" with a single click.
 */
export function ContextRefStrip({ workspaceId, streamId, draftRefs }: ContextRefStripProps) {
  const hasDraftRefs = Boolean(draftRefs && draftRefs.length > 0)
  // Bootstrap-hydrated, so this is synchronous for any stream whose
  // bootstrap has already loaded — no fetch wait, no layout shift.
  const { data } = useStreamContextBag(workspaceId, hasDraftRefs ? streamId : null)

  if (!hasDraftRefs || !draftRefs) return null

  // Composite key matches the pill identity tuple — bag refs may share a
  // streamId with different `fromMessageId` / `toMessageId` anchors, so a
  // streamId-only Map would silently drop one of them.
  const refKey = (r: {
    refKind?: string
    kind?: string
    streamId: string
    fromMessageId?: string | null
    toMessageId?: string | null
  }) => `${r.refKind ?? r.kind}|${r.streamId}|${r.fromMessageId ?? ""}|${r.toMessageId ?? ""}`
  const serverByKey = new Map((data?.refs ?? []).map((r) => [refKey(r), r]))

  return (
    <>
      {draftRefs.map((ref) => {
        const server = serverByKey.get(refKey(ref))
        const label = formatContextRefLabel({
          slug: server?.source.slug ?? null,
          displayName: server?.source.displayName ?? null,
          streamType: server?.source.type ?? null,
          itemCount: server?.source.itemCount ?? null,
          fromMessageId: ref.fromMessageId,
          toMessageId: ref.toMessageId,
        })
        const tooltip =
          ref.errorMessage ?? (ref.status === "pending" ? "Preparing context…" : "Click to open the source thread")
        return (
          <AttachmentPill
            key={`${ref.refKind}|${ref.streamId}|${ref.fromMessageId ?? ""}|${ref.toMessageId ?? ""}`}
            icon={STATUS_ICON[ref.status]}
            label={label}
            status={STATUS_MAP[ref.status]}
            tooltip={tooltip}
            href={
              ref.status === "pending"
                ? undefined
                : buildContextRefSourceHref({
                    workspaceId,
                    sourceStreamId: ref.streamId,
                    originMessageId: ref.originMessageId,
                  })
            }
            labelMaxWidth="max-w-[200px]"
          />
        )
      })}
    </>
  )
}
