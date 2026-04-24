import { Share2 } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { useSharedMessageSource, type SharedMessageSource } from "@/hooks/use-shared-message-source"

interface SharedMessagePointerBlockProps {
  streamId: string
  messageId: string
  /** Author name parsed from the markdown link text; used as a pre-hydration fallback. */
  authorName: string
}

/**
 * Renders the inline pointer card for a sharedMessage node when a message body
 * passes through markdown rendering (i.e. the timeline, thread panel, and any
 * other surface that consumes `contentMarkdown`). The in-composer card lives
 * in `SharedMessageView` (a TipTap NodeView); both route through the shared
 * resolver hook so cache behavior matches.
 */
export function SharedMessagePointerBlock({ streamId, messageId, authorName }: SharedMessagePointerBlockProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const source = useSharedMessageSource(messageId, streamId)

  const card = (
    <div
      className={cn(
        "my-1 flex items-start gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm",
        "hover:bg-muted/50 transition-colors"
      )}
      data-type="shared-message"
    >
      <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">{renderBody(authorName, source)}</div>
    </div>
  )

  if (!workspaceId) return card

  return (
    <Link to={`/w/${workspaceId}/s/${streamId}?m=${messageId}`} className="block no-underline">
      {card}
    </Link>
  )
}

function renderBody(fallbackAuthor: string, source: SharedMessageSource) {
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
        {source.showSkeleton ? <Skeleton className="mt-1 h-3 w-48" /> : <p className="mt-0.5 h-3" aria-hidden="true" />}
      </>
    )
  }

  const snippet = source.contentMarkdown
  const lines = snippet.split("\n")
  const isLong = lines.length > 3 || snippet.length > 200
  const display = isLong ? lines.slice(0, 3).join("\n").slice(0, 200) + "…" : snippet

  return (
    <>
      <AuthorLabel name={source.authorName || fallbackAuthor || "—"} />
      <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{display}</p>
    </>
  )
}

function AuthorLabel({ name }: { name: string }) {
  return <span className="text-xs font-medium text-muted-foreground">{name}</span>
}
