import { useMemo, type ReactNode } from "react"
import { Quote, ChevronDown, ChevronRight } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD, type AuthorType } from "@threa/types"
import { useActors } from "@/hooks"
import { useUserProfile } from "@/components/user-profile"
import { PersonaAvatar } from "@/components/persona-avatar"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/contexts/preferences-context"
import { useBlockCollapse } from "./use-block-collapse"
import { extractBlockText, estimateBlockLines } from "./extract-block-text"

interface QuoteReplyBlockProps {
  authorName: string
  authorId: string
  actorType: string
  streamId: string
  messageId: string
  children: ReactNode
}

function usePreferencesOptional() {
  try {
    return usePreferences()
  } catch {
    return null
  }
}

/**
 * Renders a quote-reply block in message display.
 * Clicking the block navigates to the quoted message (INV-40: navigation uses links).
 * Clicking the author name opens the user profile modal.
 * Long quotes start collapsed; the chevron toggles between a summary and the
 * full quote body.
 */
export function QuoteReplyBlock({
  authorName,
  authorId,
  actorType,
  streamId,
  messageId,
  children,
}: QuoteReplyBlockProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  const quotedText = useMemo(() => extractBlockText(children), [children])
  const lineCount = useMemo(() => estimateBlockLines(quotedText), [quotedText])

  const preferencesContext = usePreferencesOptional()
  const threshold =
    preferencesContext?.preferences?.blockquoteCollapseThreshold ?? DEFAULT_BLOCKQUOTE_COLLAPSE_THRESHOLD
  const defaultCollapsed = lineCount > threshold

  const { collapsed, canToggle, toggle } = useBlockCollapse({
    // Quote replies are anchored by the quoted (streamId, messageId) pair, so
    // two quote-replies to the same message in a single container collapse
    // together — which is what users expect.
    kind: "quote-reply",
    hashNamespace: `${streamId}/${messageId}`,
    content: quotedText,
    defaultCollapsed,
  })

  if (!workspaceId) return null

  const url = `/w/${workspaceId}/s/${streamId}?m=${messageId}`

  const handleToggle = (e: React.MouseEvent) => {
    // The wrapper is a <Link>; stop propagation so toggling doesn't navigate.
    e.preventDefault()
    e.stopPropagation()
    toggle()
  }

  const collapseLabel = collapsed ? `Expand ${lineCount} line${lineCount === 1 ? "" : "s"}` : "Collapse quote reply"

  return (
    <Link
      to={url}
      className="my-2 flex items-start gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm no-underline transition-colors hover:bg-muted/50"
    >
      <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <QuoteAuthor
            workspaceId={workspaceId}
            authorName={authorName}
            authorId={authorId}
            actorType={actorType as AuthorType}
          />
          {canToggle && (
            <button
              type="button"
              onClick={handleToggle}
              aria-expanded={!collapsed}
              aria-label={collapseLabel}
              title={collapseLabel}
              className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-foreground"
            >
              {collapsed ? (
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
        {collapsed ? (
          <div className={cn("mt-0.5 truncate text-xs text-muted-foreground/80 italic")}>
            {lineCount > 0
              ? `${lineCount} line${lineCount === 1 ? "" : "s"} — click chevron to expand`
              : "Quoted message"}
          </div>
        ) : (
          <div className="mt-0.5 text-muted-foreground [&_p]:mb-0">{children}</div>
        )}
      </div>
    </Link>
  )
}

function QuoteAuthor({
  workspaceId,
  authorName,
  authorId,
  actorType,
}: {
  workspaceId: string
  authorName: string
  authorId: string
  actorType: AuthorType
}) {
  const { getActorAvatar } = useActors(workspaceId)
  const { openUserProfile } = useUserProfile()
  const { fallback, slug, avatarUrl } = getActorAvatar(authorId || null, actorType)
  const isPersona = actorType === "persona"
  const isBot = actorType === "bot"
  const isSystem = actorType === "system"
  const isUser = actorType === "user"

  const handleAuthorClick = (e: React.MouseEvent) => {
    if (isUser && authorId) {
      e.preventDefault()
      e.stopPropagation()
      openUserProfile(authorId)
    }
  }

  let avatar = null
  if (authorId && isPersona) {
    avatar = <PersonaAvatar slug={slug} fallback={fallback} size="sm" className="h-4 w-4 text-[8px]" />
  } else if (authorId) {
    avatar = (
      <Avatar className="h-4 w-4 rounded-[4px] shrink-0">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={authorName} />}
        <AvatarFallback
          className={cn(
            "text-[8px]",
            isSystem && "bg-blue-500/10 text-blue-500",
            isBot && "bg-emerald-500/10 text-emerald-600",
            !isSystem && !isBot && "bg-muted text-foreground"
          )}
        >
          {fallback}
        </AvatarFallback>
      </Avatar>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {avatar}
      <button
        type="button"
        onClick={handleAuthorClick}
        className={cn(
          "text-xs font-medium",
          isUser && authorId ? "text-muted-foreground hover:underline" : "text-muted-foreground cursor-default",
          isPersona && "text-primary",
          isBot && "text-emerald-600",
          isSystem && "text-blue-500"
        )}
      >
        {authorName}
      </button>
    </span>
  )
}
