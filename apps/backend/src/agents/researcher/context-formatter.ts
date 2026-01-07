import type { Memo } from "../../repositories/memo-repository"

/**
 * Enriched memo result with source stream info.
 */
export interface EnrichedMemoResult {
  memo: Memo
  distance: number
  sourceStream: {
    id: string
    type: string
    name: string | null
  } | null
}

/**
 * Enriched message result with author and stream info.
 */
export interface EnrichedMessageResult {
  id: string
  streamId: string
  content: string
  authorId: string
  authorType: "user" | "persona"
  authorName: string
  streamName: string
  streamType: string
  createdAt: Date
}

/**
 * Format retrieved memos and messages into a context section for the system prompt.
 *
 * Returns null if no results were found.
 * Otherwise returns a formatted markdown section to inject into the prompt.
 */
export function formatRetrievedContext(memos: EnrichedMemoResult[], messages: EnrichedMessageResult[]): string | null {
  if (memos.length === 0 && messages.length === 0) {
    return null
  }

  const parts: string[] = []

  parts.push("## Retrieved Knowledge")
  parts.push("")
  parts.push("The following relevant information was found in the workspace:")
  parts.push("")

  // Memos first (higher quality, summarized knowledge)
  if (memos.length > 0) {
    parts.push("### Memos")
    parts.push("")

    for (const { memo, sourceStream } of memos) {
      const location = sourceStream?.name ?? sourceStream?.type ?? "workspace"
      parts.push(`**${memo.title}** _(from ${location})_`)
      parts.push("")
      parts.push(memo.abstract)
      parts.push("")

      if (memo.keyPoints.length > 0) {
        parts.push("Key points:")
        for (const kp of memo.keyPoints) {
          parts.push(`- ${kp}`)
        }
        parts.push("")
      }
    }
  }

  // Messages as supplement/fallback
  if (messages.length > 0) {
    parts.push("### Related Messages")
    parts.push("")

    for (const msg of messages) {
      const relativeDate = formatRelativeDate(msg.createdAt)
      const author = msg.authorType === "user" ? `@${msg.authorName}` : msg.authorName

      parts.push(`> **${author}** in _${msg.streamName}_ (${relativeDate}):`)
      parts.push(`> ${truncateContent(msg.content, 300)}`)
      parts.push("")
    }
  }

  parts.push("Use this knowledge to inform your response. Cite sources when relevant.")

  return parts.join("\n")
}

/**
 * Truncate content to a maximum length, adding ellipsis if truncated.
 */
function truncateContent(content: string, maxLength: number): string {
  // Normalize whitespace
  const normalized = content.replace(/\s+/g, " ").trim()

  if (normalized.length <= maxLength) {
    return normalized
  }

  return normalized.slice(0, maxLength - 3) + "..."
}

/**
 * Format a date as a relative time string.
 */
function formatRelativeDate(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 30) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  if (diffDays > 0) {
    return diffDays === 1 ? "yesterday" : `${diffDays} days ago`
  }

  if (diffHours > 0) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`
  }

  if (diffMinutes > 0) {
    return diffMinutes === 1 ? "1 minute ago" : `${diffMinutes} minutes ago`
  }

  return "just now"
}
