import { Link } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import type { ThreadSummary } from "@threa/types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { RelativeTime } from "@/components/relative-time"
import { useActors } from "@/hooks"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { truncateContent } from "@/components/layout/sidebar/utils"
import { cn } from "@/lib/utils"

interface ThreadCardProps {
  replyCount: number
  href: string
  workspaceId: string
  summary?: ThreadSummary
  /**
   * Render a pulsing gold dot next to the reply count when a session is
   * actively producing content in this thread. Lets the card stay mounted
   * across the session lifecycle instead of being swapped in and out with a
   * separate activity pill (which caused layout shift when a thread was
   * created mid-session).
   */
  isActive?: boolean
  /**
   * When rendered inside `ThreadSlot`, the slot owns the gold left-line so
   * that it can persist across pill→card transitions and animate growth.
   * The card suppresses its own `before:` line in that case.
   */
  ownsLeftLine?: boolean
  className?: string
}

/**
 * Compact thread preview card with a gold "Ariadne's thread" left-line,
 * participant avatar stack, and latest-reply snippet. Acts as the thread
 * entry tap target on both desktop and mobile.
 *
 * Preview text routes through `truncateContent()` (→ `stripMarkdownToInline`)
 * so raw markdown from `contentMarkdown` never ships as literal syntax to
 * users (INV-60).
 */
export function ThreadCard({
  replyCount,
  href,
  workspaceId,
  summary,
  isActive,
  ownsLeftLine = true,
  className,
}: ThreadCardProps) {
  const { getActorName, getActorAvatar } = useActors(workspaceId)
  const { toEmoji } = useWorkspaceEmoji(workspaceId)

  if (replyCount === 0) return null

  const replyLabel = replyCount === 1 ? "1 reply" : `${replyCount} replies`
  const participantIds = summary?.participantUserIds ?? []

  return (
    <Link
      to={href}
      className={cn(
        "group/thread relative flex flex-col gap-1 rounded-md py-1.5 pl-3 pr-2",
        ownsLeftLine && "mt-2",
        // 2px gold thread line that extends up into the message gap — Ariadne's literal thread.
        // Suppressed when ThreadSlot owns the line so there's no double-draw.
        ownsLeftLine &&
          "before:content-[''] before:absolute before:left-0 before:top-[-4px] before:bottom-1 before:w-[2px] before:rounded-full before:bg-primary/70 hover:before:bg-primary",
        "hover:bg-primary/[0.04] transition-colors",
        className
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        {participantIds.length > 0 && (
          <div className="flex gap-0.5">
            {participantIds.map((userId) => {
              const { fallback, avatarUrl } = getActorAvatar(userId, "user")
              return (
                <Avatar key={userId} className="h-5 w-5 rounded-[5px]">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
                  <AvatarFallback className="bg-muted text-[9px] font-medium text-foreground">
                    {fallback}
                  </AvatarFallback>
                </Avatar>
              )
            })}
          </div>
        )}
        <span className="font-medium text-primary group-hover/thread:underline">{replyLabel}</span>
        {isActive && (
          <span className="relative flex h-1.5 w-1.5" aria-label="Session active">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
        )}
        {summary && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <RelativeTime date={summary.lastReplyAt} terse className="text-muted-foreground" />
          </>
        )}
        <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/50 transition-transform group-hover/thread:translate-x-0.5 group-hover/thread:text-muted-foreground" />
      </div>
      {summary && (
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {getActorName(summary.latestReply.actorId, summary.latestReply.actorType)}
          </span>
          <span className="text-muted-foreground/60"> — </span>
          {truncateContent(summary.latestReply.contentMarkdown, 120, toEmoji)}
        </p>
      )}
    </Link>
  )
}
