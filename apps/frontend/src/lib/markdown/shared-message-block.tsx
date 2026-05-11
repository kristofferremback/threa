import { Share2 } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useSharedMessageSource } from "@/hooks/use-shared-message-source"
import { SharedMessageCardBody } from "@/components/shared-messages/card-body"

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
 * resolver hook + `SharedMessageCardBody` so cache + render behavior matches.
 */
export function SharedMessagePointerBlock({ streamId, messageId, authorName }: SharedMessagePointerBlockProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const source = useSharedMessageSource(messageId, streamId)

  const card = (
    <div
      className={cn(
        "my-1 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm",
        "hover:bg-accent/30 transition-colors"
      )}
      data-type="shared-message"
    >
      <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <SharedMessageCardBody source={source} fallbackAuthor={authorName} />
      </div>
    </div>
  )

  if (!workspaceId) return card

  return (
    <Link to={`/w/${workspaceId}/s/${streamId}?m=${messageId}`} className="block no-underline">
      {card}
    </Link>
  )
}
