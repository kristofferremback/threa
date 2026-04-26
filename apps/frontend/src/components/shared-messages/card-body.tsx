import { Link, useParams } from "react-router-dom"
import { Skeleton } from "@/components/ui/skeleton"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { type SharedMessageSource } from "@/hooks/use-shared-message-source"
import type { StreamType, Visibility } from "@threa/types"

/**
 * Body renderer shared between the two pointer-card surfaces:
 *
 *   - `SharedMessageView` — TipTap NodeView mounted inside the composer.
 *   - `SharedMessagePointerBlock` — paragraph swap inside the markdown
 *     renderer, used in the timeline / thread panel / activity feed.
 *
 * Both surfaces want the same byline + body for each `SharedMessageSource`
 * status, with the same fallback-author + author-label semantics. Keeping
 * the rendering in one place avoids the two surfaces drifting apart on
 * styling changes.
 *
 * `fallbackAuthor` is the pre-hydration label: the NodeView passes
 * `attrs.authorName` (stamped on the node at share time), the markdown
 * block passes the link-text the markdown serializer emitted.
 */
export function SharedMessageCardBody({
  source,
  fallbackAuthor,
}: {
  source: SharedMessageSource
  fallbackAuthor: string
}) {
  if (source.status === "deleted") {
    return (
      <>
        <AuthorLabel name={fallbackAuthor || "—"} />
        <p className="mt-0.5 italic text-muted-foreground">Message deleted by author</p>
      </>
    )
  }

  if (source.status === "missing") {
    return (
      <>
        <AuthorLabel name={fallbackAuthor || "—"} />
        <p className="mt-0.5 italic text-muted-foreground">Message no longer available</p>
      </>
    )
  }

  if (source.status === "private") {
    return <PrivatePlaceholder kind={source.sourceStreamKind} visibility={source.sourceVisibility} />
  }

  if (source.status === "truncated") {
    return <TruncatedPlaceholder streamId={source.streamId} messageId={source.messageId} />
  }

  if (source.status === "pending") {
    return (
      <>
        <AuthorLabel name={fallbackAuthor || "—"} />
        {source.showSkeleton ? (
          <Skeleton className="mt-1 h-3 w-48" />
        ) : (
          // Before the staggered-skeleton threshold, leave the body blank so
          // the common fast-path (content resolves within 300ms) doesn't flash
          // a loading state. The row still shows the author for layout
          // stability.
          <p className="mt-0.5 h-3" aria-hidden="true" />
        )}
      </>
    )
  }

  return (
    <>
      <AuthorLabel name={source.authorName || fallbackAuthor || "—"} />
      {/* The card is the live inline rendering of the source message, not a
          single-line preview, so it gets full markdown (emoji, mentions,
          formatting) rather than the strip-to-inline used by sidebar
          surfaces. INV-60 doesn't apply here. */}
      <div className="mt-0.5">
        <MarkdownContent content={source.contentMarkdown} className="text-sm leading-relaxed" />
      </div>
    </>
  )
}

function AuthorLabel({ name }: { name: string }) {
  return <span className="text-xs font-medium text-foreground/80">{name}</span>
}

/**
 * Privacy-preserving placeholder shown when the viewer hit an inner pointer
 * in a re-share chain that they have no read path to. Reveals only the
 * source stream's kind + visibility — never content, author, or stream
 * name. Plan D8 is explicit about minimizing the leak surface here so a
 * downstream re-share can't be used to exfiltrate metadata about a deeply
 * private source.
 */
function PrivatePlaceholder({ kind, visibility }: { kind: StreamType; visibility: Visibility }) {
  return (
    <>
      <AuthorLabel name="Private message" />
      <p className="mt-0.5 italic text-muted-foreground">
        This message references content in a {visibility} {streamKindLabel(kind)} you don't have access to.
      </p>
    </>
  )
}

/**
 * Placeholder for pointers past the recursive-hydration depth cap. The
 * viewer has access (the chain only truncates on accessible paths), so
 * the body is a navigation link rather than a privacy stub.
 */
function TruncatedPlaceholder({ streamId, messageId }: { streamId: string; messageId: string }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const href = workspaceId ? `/w/${workspaceId}/s/${streamId}?m=${messageId}` : `#`
  return (
    <>
      <AuthorLabel name="Nested share" />
      <p className="mt-0.5 italic text-muted-foreground">
        This message references a deeper share —{" "}
        <Link to={href} className="underline underline-offset-2 hover:text-foreground">
          open in source stream
        </Link>
        .
      </p>
    </>
  )
}

/**
 * Friendly noun for the privacy placeholder. Threads resolve to their
 * parent kind on the backend (plan D8), so this only ever runs against
 * top-level kinds in practice; the `thread`/`system` arms are defensive.
 */
function streamKindLabel(kind: StreamType): string {
  switch (kind) {
    case "channel":
      return "channel"
    case "dm":
      return "DM"
    case "scratchpad":
      return "scratchpad"
    case "thread":
      return "thread"
    case "system":
      return "system stream"
  }
}
