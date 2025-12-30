import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useMentionType } from "./mention-context"
import { MENTION_PATTERN, isValidSlug } from "@threa/types"

/**
 * Styles for different trigger types.
 */
const triggerStyles = {
  user: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
  persona: "bg-primary/10 text-primary",
  broadcast: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200",
  channel: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200",
  command: "bg-muted text-primary font-mono font-bold",
  me: "bg-blue-100 text-primary dark:bg-blue-900/50 dark:text-primary",
}

interface TriggerChipProps {
  type: "mention" | "channel" | "command"
  text: string
}

/**
 * Styled chip for rendered triggers (mentions, channels, commands).
 * Uses MentionContext for correct mention type styling.
 */
function TriggerChip({ type, text }: TriggerChipProps) {
  const getMentionType = useMentionType()
  let style: string
  let prefix: string

  switch (type) {
    case "channel":
      style = triggerStyles.channel
      prefix = "#"
      break
    case "command":
      style = triggerStyles.command
      prefix = "/"
      break
    default:
      style = triggerStyles[getMentionType(text)]
      prefix = "@"
  }

  return (
    <span className={cn("inline-flex items-center rounded px-1 py-0.5", style)}>
      {prefix}
      {text}
    </span>
  )
}

/**
 * Patterns for triggers.
 * - Commands: /command at start of text
 * - Channels: #channel-name (uses same rules as slugs)
 * - Mentions: @slug (uses shared MENTION_PATTERN from @threa/types)
 */
const COMMAND_PATTERN = /^(\s*)(\/)([\w-]+)/

// Channel pattern uses same slug rules as mentions
const CHANNEL_PATTERN = /(?<![a-z0-9])#([a-z][a-z0-9-]*[a-z0-9]|[a-z])(?![a-z0-9_.-])/g

/**
 * Parse text and render triggers as styled chips.
 * Returns an array of React nodes.
 */
export function renderMentions(text: string): ReactNode[] {
  const result: ReactNode[] = []
  let processText = text
  let keyIndex = 0

  // Check for command at start of text (allowing leading whitespace)
  const commandMatch = processText.match(COMMAND_PATTERN)
  if (commandMatch) {
    // Preserve any leading whitespace
    if (commandMatch[1]) {
      result.push(commandMatch[1])
    }
    result.push(<TriggerChip key={`cmd-${keyIndex++}`} type="command" text={commandMatch[3]} />)
    processText = processText.slice(commandMatch[0].length)
  }

  // Collect all trigger matches with their positions
  type TriggerMatch = { index: number; length: number; type: "mention" | "channel"; slug: string }
  const triggers: TriggerMatch[] = []

  // Find mentions using shared pattern
  const mentionPattern = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags)
  let match
  while ((match = mentionPattern.exec(processText)) !== null) {
    if (isValidSlug(match[1])) {
      triggers.push({ index: match.index, length: match[0].length, type: "mention", slug: match[1] })
    }
  }

  // Find channels
  CHANNEL_PATTERN.lastIndex = 0
  while ((match = CHANNEL_PATTERN.exec(processText)) !== null) {
    if (isValidSlug(match[1])) {
      triggers.push({ index: match.index, length: match[0].length, type: "channel", slug: match[1] })
    }
  }

  // Sort by position
  triggers.sort((a, b) => a.index - b.index)

  // Build result
  let lastIndex = 0
  for (const trigger of triggers) {
    // Skip if overlapping with previous
    if (trigger.index < lastIndex) continue

    if (trigger.index > lastIndex) {
      result.push(processText.slice(lastIndex, trigger.index))
    }

    result.push(
      <TriggerChip key={`${keyIndex++}-${trigger.type}-${trigger.slug}`} type={trigger.type} text={trigger.slug} />
    )
    lastIndex = trigger.index + trigger.length
  }

  if (lastIndex < processText.length) {
    result.push(processText.slice(lastIndex))
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
