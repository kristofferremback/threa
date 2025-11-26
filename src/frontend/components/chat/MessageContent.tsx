import { useMemo, Fragment } from "react"
import { Hash } from "lucide-react"
import type { MessageMention } from "../../types"

interface MessageContentProps {
  content: string
  mentions?: MessageMention[]
  onUserMentionClick?: (userId: string) => void
  onChannelClick?: (channelSlug: string) => void
}

export type { MessageMention }

// Parse markdown into blocks first, then handle inline formatting
function parseMarkdown(text: string, mentions: MessageMention[], onUserMentionClick?: (id: string) => void, onChannelClick?: (slug: string) => void): React.ReactNode[] {
  const lines = text.split("\n")
  const blocks: React.ReactNode[] = []
  let key = 0
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block (```language\ncode```)
    if (line.startsWith("```")) {
      const language = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      blocks.push(
        <pre
          key={key++}
          className="p-3 rounded-lg text-sm font-mono my-2 overflow-x-auto"
          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-subtle)" }}
        >
          {language && (
            <div className="text-xs mb-2 pb-2" style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)" }}>
              {language}
            </div>
          )}
          <code style={{ color: "var(--text-primary)" }}>{codeLines.join("\n")}</code>
        </pre>
      )
      continue
    }

    // Blockquote (> text)
    if (line.startsWith("> ")) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2))
        i++
      }
      blocks.push(
        <blockquote
          key={key++}
          className="pl-3 my-2 italic"
          style={{ borderLeft: "2px solid var(--border-emphasis)", color: "var(--text-secondary)" }}
        >
          {quoteLines.map((ql, idx) => (
            <div key={idx}>{parseInlineWithMentions(ql, mentions, onUserMentionClick, onChannelClick)}</div>
          ))}
        </blockquote>
      )
      continue
    }

    // Unordered list (- item or * item)
    if (line.match(/^[-*] /)) {
      const listItems: string[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        listItems.push(lines[i].slice(2))
        i++
      }
      blocks.push(
        <ul key={key++} className="list-disc list-inside my-2 space-y-1" style={{ color: "var(--text-primary)" }}>
          {listItems.map((item, idx) => (
            <li key={idx}>
              {parseInlineWithMentions(item, mentions, onUserMentionClick, onChannelClick)}
            </li>
          ))}
        </ul>
      )
      continue
    }

    // Ordered list (1. item)
    if (line.match(/^\d+\. /)) {
      const listItems: string[] = []
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        listItems.push(lines[i].replace(/^\d+\. /, ""))
        i++
      }
      blocks.push(
        <ol key={key++} className="list-decimal list-inside my-2 space-y-1" style={{ color: "var(--text-primary)" }}>
          {listItems.map((item, idx) => (
            <li key={idx}>
              {parseInlineWithMentions(item, mentions, onUserMentionClick, onChannelClick)}
            </li>
          ))}
        </ol>
      )
      continue
    }

    // Horizontal rule
    if (line.trim() === "---" || line.trim() === "***" || line.trim() === "___") {
      blocks.push(<hr key={key++} className="my-4" style={{ borderColor: "var(--border-default)" }} />)
      i++
      continue
    }

    // Empty line
    if (line.trim() === "") {
      i++
      continue
    }

    // Regular paragraph
    blocks.push(
      <p key={key++} style={{ color: "var(--text-primary)" }}>
        {parseInlineWithMentions(line, mentions, onUserMentionClick, onChannelClick)}
      </p>
    )
    i++
  }

  return blocks
}

// Parse inline markdown with mention support
function parseInlineWithMentions(
  text: string,
  mentions: MessageMention[],
  onUserMentionClick?: (id: string) => void,
  onChannelClick?: (slug: string) => void
): React.ReactNode[] {
  if (mentions.length === 0) {
    return parseInlineMarkdown(text)
  }

  // Build regex for mentions
  const mentionPatterns = mentions.map((m) => {
    if (m.type === "user") {
      return `@${escapeRegex(m.label)}`
    } else if (m.type === "crosspost") {
      return `#\\+${escapeRegex(m.slug || m.label)}`
    } else {
      return `#${escapeRegex(m.slug || m.label)}`
    }
  })

  if (mentionPatterns.length === 0) {
    return parseInlineMarkdown(text)
  }

  const regex = new RegExp(`(${mentionPatterns.join("|")})`, "g")
  const parts = text.split(regex)

  return parts.flatMap((part, index) => {
    const mention = mentions.find((m) => {
      if (m.type === "user" && part === `@${m.label}`) return true
      if (m.type === "crosspost" && part === `#+${m.slug || m.label}`) return true
      if (m.type === "channel" && part === `#${m.slug || m.label}`) return true
      return false
    })

    if (mention) {
      if (mention.type === "user") {
        return (
          <button
            key={index}
            onClick={() => onUserMentionClick?.(mention.id)}
            className="inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium transition-colors hover:opacity-80"
            style={{ background: "rgba(99, 102, 241, 0.15)", color: "var(--accent-primary)" }}
          >
            @{mention.label}
          </button>
        )
      } else {
        const isCrosspost = mention.type === "crosspost"
        return (
          <button
            key={index}
            onClick={() => onChannelClick?.(mention.slug || mention.label)}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-sm font-medium transition-colors hover:opacity-80"
            style={{
              background: isCrosspost ? "rgba(99, 102, 241, 0.15)" : "var(--bg-tertiary)",
              color: isCrosspost ? "var(--accent-primary)" : "var(--text-secondary)",
            }}
          >
            <Hash className="w-3 h-3" />
            {isCrosspost && "+"}
            {mention.slug || mention.label}
          </button>
        )
      }
    }

    return parseInlineMarkdown(part)
  })
}

// Parse inline markdown (bold, italic, code, links, etc.)
function parseInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Inline code (single backticks)
    let match = remaining.match(/^`([^`]+)`/)
    if (match) {
      nodes.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded text-sm font-mono"
          style={{ background: "var(--bg-tertiary)", color: "var(--accent-primary)" }}
        >
          {match[1]}
        </code>
      )
      remaining = remaining.slice(match[0].length)
      continue
    }

    // Bold (double asterisks or underscores)
    match = remaining.match(/^\*\*(.+?)\*\*/) || remaining.match(/^__(.+?)__/)
    if (match) {
      nodes.push(
        <strong key={key++} className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {match[1]}
        </strong>
      )
      remaining = remaining.slice(match[0].length)
      continue
    }

    // Italic (single asterisks or underscores) - be careful not to match list markers
    match = remaining.match(/^\*([^*\s][^*]*?)\*/) || remaining.match(/^_([^_\s][^_]*?)_/)
    if (match) {
      nodes.push(
        <em key={key++} className="italic">
          {match[1]}
        </em>
      )
      remaining = remaining.slice(match[0].length)
      continue
    }

    // Strikethrough
    match = remaining.match(/^~~(.+?)~~/)
    if (match) {
      nodes.push(
        <span key={key++} className="line-through" style={{ color: "var(--text-muted)" }}>
          {match[1]}
        </span>
      )
      remaining = remaining.slice(match[0].length)
      continue
    }

    // Links [text](url)
    match = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (match) {
      nodes.push(
        <a
          key={key++}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:opacity-80"
          style={{ color: "var(--accent-primary)" }}
        >
          {match[1]}
        </a>
      )
      remaining = remaining.slice(match[0].length)
      continue
    }

    // Auto-link URLs
    match = remaining.match(/^(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/)
    if (match) {
      nodes.push(
        <a
          key={key++}
          href={match[1]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:opacity-80"
          style={{ color: "var(--accent-primary)" }}
        >
          {match[1]}
        </a>
      )
      remaining = remaining.slice(match[0].length)
      continue
    }

    // Regular text - consume until next special character
    match = remaining.match(/^[^*_`~\[h]+/) || remaining.match(/^[*_`~\[h]/)
    if (match) {
      nodes.push(<Fragment key={key++}>{match[0]}</Fragment>)
      remaining = remaining.slice(match[0].length)
      continue
    }

    // Safety fallback
    nodes.push(<Fragment key={key++}>{remaining[0]}</Fragment>)
    remaining = remaining.slice(1)
  }

  return nodes
}

export function MessageContent({ content, mentions = [], onUserMentionClick, onChannelClick }: MessageContentProps) {
  const renderedContent = useMemo(() => {
    return (
      <div className="text-sm leading-relaxed space-y-1">
        {parseMarkdown(content, mentions, onUserMentionClick, onChannelClick)}
      </div>
    )
  }, [content, mentions, onUserMentionClick, onChannelClick])

  return renderedContent
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
