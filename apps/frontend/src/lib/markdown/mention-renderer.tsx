import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useMentionType } from "./mention-context"

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
 * Pattern to match @mentions, #channels, and /commands at start.
 * Command pattern allows optional leading whitespace.
 */
const COMMAND_PATTERN = /^(\s*)(\/)([\w-]+)/
const TRIGGER_PATTERN = /(@|#)([\w-]+)/g

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

  // Process remaining text for mentions and channels
  let lastIndex = 0
  let match

  TRIGGER_PATTERN.lastIndex = 0
  while ((match = TRIGGER_PATTERN.exec(processText)) !== null) {
    if (match.index > lastIndex) {
      result.push(processText.slice(lastIndex, match.index))
    }

    const trigger = match[1] as "@" | "#"
    const slug = match[2]

    result.push(
      <TriggerChip key={`${keyIndex++}-${trigger}${slug}`} type={trigger === "@" ? "mention" : "channel"} text={slug} />
    )

    lastIndex = match.index + match[0].length
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
