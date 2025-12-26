import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Styles for different mention types.
 */
const mentionStyles = {
  user: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
  persona: "bg-primary/10 text-primary",
  broadcast: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200",
  channel: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200",
}

/**
 * Reserved broadcast slugs.
 */
const BROADCAST_SLUGS = new Set(["channel", "here"])

/**
 * Determine the type of mention based on slug.
 * This is a simple heuristic - in a real implementation,
 * you'd look up the slug against workspace users/personas.
 */
function getMentionType(slug: string): keyof typeof mentionStyles {
  if (BROADCAST_SLUGS.has(slug)) {
    return "broadcast"
  }
  // Default to user - we'd need context to distinguish user vs persona
  return "user"
}

interface MentionChipProps {
  type: "mention" | "channel"
  slug: string
}

/**
 * Styled chip for rendered mentions and channels.
 */
function MentionChip({ type, slug }: MentionChipProps) {
  const style = type === "channel" ? mentionStyles.channel : mentionStyles[getMentionType(slug)]

  return (
    <span className={cn("inline-flex items-center rounded px-1 py-0.5 text-sm font-medium", style)}>
      {type === "channel" ? "#" : "@"}
      {slug}
    </span>
  )
}

/**
 * Pattern to match @mentions and #channels in text.
 * Matches:
 * - @word (mention)
 * - #word (channel)
 * Word characters are letters, numbers, hyphens, and underscores.
 */
const TRIGGER_PATTERN = /(@|#)([\w-]+)/g

/**
 * Parse text and render mentions/channels as styled chips.
 * Returns an array of React nodes (strings and MentionChip components).
 */
export function renderMentions(text: string): ReactNode[] {
  const result: ReactNode[] = []
  let lastIndex = 0
  let match

  // Reset regex state
  TRIGGER_PATTERN.lastIndex = 0

  while ((match = TRIGGER_PATTERN.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index))
    }

    const trigger = match[1] as "@" | "#"
    const slug = match[2]

    result.push(
      <MentionChip
        key={`${match.index}-${trigger}${slug}`}
        type={trigger === "@" ? "mention" : "channel"}
        slug={slug}
      />
    )

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }

  return result.length > 0 ? result : [text]
}

/**
 * Process React children and render mentions in text nodes.
 * Preserves non-text children (like <strong>, <em>, etc).
 */
export function processChildrenForMentions(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    const rendered = renderMentions(children)
    return rendered.length === 1 && typeof rendered[0] === "string" ? rendered[0] : <>{rendered}</>
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => <span key={index}>{processChildrenForMentions(child)}</span>)
  }

  return children
}
