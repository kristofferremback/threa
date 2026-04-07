import type { ReactNode } from "react"
import { Quote } from "lucide-react"
import { Link, useParams } from "react-router-dom"

interface QuoteReplyBlockProps {
  authorName: string
  streamId: string
  messageId: string
  children: ReactNode
}

/**
 * Renders a quote-reply block in message display.
 * Clicking the block navigates to the quoted message (INV-40: navigation uses links).
 */
export function QuoteReplyBlock({ authorName, streamId, messageId, children }: QuoteReplyBlockProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  if (!workspaceId) return null

  const url = `/w/${workspaceId}/s/${streamId}?m=${messageId}`

  return (
    <Link
      to={url}
      className="my-2 flex items-start gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm no-underline transition-colors hover:bg-muted/50"
    >
      <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-muted-foreground">{authorName}</span>
        <div className="mt-0.5 text-muted-foreground [&_p]:mb-0">{children}</div>
      </div>
    </Link>
  )
}
