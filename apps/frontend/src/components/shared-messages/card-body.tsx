import { Skeleton } from "@/components/ui/skeleton"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { type SharedMessageSource } from "@/hooks/use-shared-message-source"

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
