import type { ReactNode } from "react"
import { Quote } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"

interface QuoteReplyBlockProps {
  authorName: string
  streamId: string
  messageId: string
  children: ReactNode
}

/**
 * Renders a quote-reply block in message display.
 * Clicking the block navigates to the quoted message.
 */
export function QuoteReplyBlock({ authorName, streamId, messageId, children }: QuoteReplyBlockProps) {
  const navigate = useNavigate()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  const handleClick = () => {
    if (!workspaceId) return
    const url = `/w/${workspaceId}/s/${streamId}?m=${messageId}`
    navigate(url)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick()
      }}
      className="my-2 flex items-start gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm cursor-pointer transition-colors hover:bg-muted/50"
    >
      <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-muted-foreground">{authorName}</span>
        <div className="mt-0.5 text-muted-foreground [&_p]:mb-0">{children}</div>
      </div>
    </div>
  )
}
