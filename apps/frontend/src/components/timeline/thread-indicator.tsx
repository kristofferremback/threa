import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"

interface ThreadIndicatorProps {
  replyCount: number
  href: string
  className?: string
}

export function ThreadIndicator({ replyCount, href, className }: ThreadIndicatorProps) {
  if (replyCount === 0) return null

  const text = replyCount === 1 ? "1 reply" : `${replyCount} replies`

  return (
    <Link to={href} className={cn("text-xs text-muted-foreground hover:text-foreground hover:underline", className)}>
      {text}
    </Link>
  )
}
