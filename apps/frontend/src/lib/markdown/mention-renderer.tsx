import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useMentionType } from "./mention-context"
import { useEmojiLookup } from "./emoji-context"
import { MENTION_PATTERN, isValidSlug } from "@threa/types"

/**
 * Styles for different trigger types.
 * Colors match the design system kitchen sink.
 */
const triggerStyles = {
  user: "bg-[hsl(200_70%_50%/0.1)] text-[hsl(200_70%_50%)]",
  persona: "bg-primary/10 text-primary",
  broadcast: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  channel: "bg-muted text-foreground",
  command: "bg-[hsl(280_60%_55%/0.15)] text-[hsl(280_60%_55%)] font-mono",
  me: "bg-[hsl(200_70%_50%/0.15)] text-primary font-semibold",
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
    <span className={cn("inline px-1 py-px rounded font-medium cursor-pointer", style)}>
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
 * - Emojis: :shortcode: (converted to emoji character)
 */
const COMMAND_PATTERN = /^(\s*)(\/)([\w-]+)/

// Channel pattern uses same slug rules as mentions
const CHANNEL_PATTERN = /(?<![a-z0-9])#([a-z][a-z0-9-]*[a-z0-9]|[a-z])(?![a-z0-9_.-])/g

// Emoji shortcode pattern: :shortcode:
const EMOJI_PATTERN = /:([a-z0-9_+-]+):/g

type ToEmoji = (shortcode: string) => string | null

/**
 * Parse text and render triggers as styled chips, emojis as characters.
 * Returns an array of React nodes.
 */
export function renderMentions(text: string, toEmoji: ToEmoji): ReactNode[] {
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
  type TriggerMatch =
    | { index: number; length: number; type: "mention" | "channel"; slug: string }
    | { index: number; length: number; type: "emoji"; shortcode: string; emoji: string }
  const triggers: TriggerMatch[] = []

  // Find mentions using shared pattern
  const mentionPattern = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags)
  let match
  while ((match = mentionPattern.exec(processText)) !== null) {
    if (isValidSlug(match[1])) {
      triggers.push({ index: match.index, length: match[0].length, type: "mention", slug: match[1] })
    }
  }

  // Find channels using cloned pattern (avoid global state issues)
  const channelPattern = new RegExp(CHANNEL_PATTERN.source, CHANNEL_PATTERN.flags)
  while ((match = channelPattern.exec(processText)) !== null) {
    if (isValidSlug(match[1])) {
      triggers.push({ index: match.index, length: match[0].length, type: "channel", slug: match[1] })
    }
  }

  // Find emoji shortcodes
  const emojiPattern = new RegExp(EMOJI_PATTERN.source, EMOJI_PATTERN.flags)
  while ((match = emojiPattern.exec(processText)) !== null) {
    const shortcode = match[1]
    const emoji = toEmoji(shortcode)
    if (emoji) {
      triggers.push({ index: match.index, length: match[0].length, type: "emoji", shortcode, emoji })
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

    if (trigger.type === "emoji") {
      // Render emoji as character with tooltip
      result.push(
        <span key={`${keyIndex++}-emoji-${trigger.shortcode}`} title={`:${trigger.shortcode}:`}>
          {trigger.emoji}
        </span>
      )
    } else {
      result.push(
        <TriggerChip key={`${keyIndex++}-${trigger.type}-${trigger.slug}`} type={trigger.type} text={trigger.slug} />
      )
    }
    lastIndex = trigger.index + trigger.length
  }

  if (lastIndex < processText.length) {
    result.push(processText.slice(lastIndex))
  }

  return result.length > 0 ? result : [text]
}

/**
 * Hook-based component to process children with mentions and emojis.
 * Must be used within a component (uses hooks).
 */
export function ProcessedChildren({ children }: { children: ReactNode }): ReactNode {
  const toEmoji = useEmojiLookup()
  return processChildrenForMentions(children, toEmoji)
}

/**
 * Process React children and render mentions/emojis in text nodes.
 * Preserves non-text children (like <strong>, <em>, etc).
 */
export function processChildrenForMentions(children: ReactNode, toEmoji: ToEmoji): ReactNode {
  if (typeof children === "string") {
    const rendered = renderMentions(children, toEmoji)
    return rendered.length === 1 && typeof rendered[0] === "string" ? rendered[0] : <>{rendered}</>
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => <span key={index}>{processChildrenForMentions(child, toEmoji)}</span>)
  }

  return children
}
