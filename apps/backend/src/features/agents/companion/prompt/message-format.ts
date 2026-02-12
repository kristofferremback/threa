import type { CoreMessage } from "ai"
import { AuthorTypes, StreamTypes, type ChartData, type DiagramData, type TableData } from "@threa/types"
import { formatDate, formatTime, getDateKey } from "../../../../lib/temporal"
import type { AttachmentContext, MessageWithAttachments, StreamContext } from "../../context-builder"

/**
 * Format messages for the LLM with timestamps and author names.
 * Includes date boundaries when messages cross dates.
 *
 * Returns CoreMessage[] with enriched content:
 * - User messages: `(14:30) [@name] content`
 * - Assistant messages: content only (no timestamp to avoid model mimicking)
 *
 * Attachments are included as text descriptions (captions/summaries).
 * Actual images are loaded on-demand via the load_attachment tool.
 */
export function formatMessagesWithTemporal(messages: MessageWithAttachments[], context: StreamContext): CoreMessage[] {
  const temporal = context.temporal
  if (!temporal) {
    // No temporal context - return messages with original content + attachment context
    return messages.map((m) => ({
      role: m.authorType === AuthorTypes.MEMBER ? ("user" as const) : ("assistant" as const),
      content: formatMessageContent(m),
    }))
  }

  // Build authorId -> name map from participants (users only)
  const authorNames = new Map<string, string>()
  if (context.participants) {
    for (const p of context.participants) {
      authorNames.set(p.id, p.name)
    }
  }

  const result: CoreMessage[] = []
  let currentDateKey: string | null = null

  for (const msg of messages) {
    const role = msg.authorType === AuthorTypes.MEMBER ? ("user" as const) : ("assistant" as const)

    if (msg.authorType === AuthorTypes.MEMBER) {
      // Check for date boundary - only on user messages to avoid model mimicking the format
      const msgDateKey = getDateKey(msg.createdAt, temporal.timezone)
      let dateBoundaryPrefix = ""
      if (msgDateKey !== currentDateKey) {
        const dateStr = formatDate(msg.createdAt, temporal.timezone, temporal.dateFormat)
        dateBoundaryPrefix = `[Date: ${dateStr}]\n`
        currentDateKey = msgDateKey
      }

      // Format with timestamp and optional author name for multi-user contexts
      const time = formatTime(msg.createdAt, temporal.timezone, temporal.timeFormat)
      const authorName = authorNames.get(msg.authorId) ?? "Unknown"
      const hasMultipleUsers = context.streamType === StreamTypes.CHANNEL || context.streamType === StreamTypes.DM
      const namePrefix = hasMultipleUsers ? `[@${authorName}] ` : ""
      const textPrefix = `${dateBoundaryPrefix}(${time}) ${namePrefix}`

      result.push({
        role,
        content: formatMessageContent(msg, textPrefix),
      })
    } else {
      // Assistant/persona messages - no timestamp or date markers to avoid model mimicking
      result.push({
        role,
        content: formatMessageContent(msg),
      })
    }
  }

  return result
}

/**
 * Format structured data as compact JSON for inclusion in attachment descriptions.
 * Note: Label avoids "data:" pattern which Langfuse SDK incorrectly parses as data URI.
 */
function formatStructuredData(data: ChartData | TableData | DiagramData | null): string | null {
  if (!data) return null

  // For tables with many rows, truncate to avoid context bloat
  if ("rows" in data && Array.isArray(data.rows) && data.rows.length > 10) {
    const truncated = {
      ...data,
      rows: data.rows.slice(0, 10),
      _truncated: `${data.rows.length - 10} more rows`,
    }
    return `  Parsed: ${JSON.stringify(truncated)}`
  }

  return `  Parsed: ${JSON.stringify(data)}`
}

/**
 * Format a single attachment as a text description.
 */
function formatAttachmentDescription(att: AttachmentContext): string {
  const isImage = att.mimeType.startsWith("image/")
  let desc = isImage ? `[Image: ${att.filename}]` : `[Attachment: ${att.filename} (${att.mimeType})]`

  if (att.extraction) {
    if (isImage) {
      if (att.extraction.summary) {
        desc += ` - ${att.extraction.summary}`
      }
    } else {
      desc += `\n  Content type: ${att.extraction.contentType}`
      desc += `\n  Summary: ${att.extraction.summary}`
      if (att.extraction.fullText) {
        desc += `\n  Full content: ${att.extraction.fullText}`
      }
    }
    const structuredStr = formatStructuredData(att.extraction.structuredData)
    if (structuredStr) {
      desc += `\n${structuredStr}`
    }
  }

  return desc
}

/**
 * Format message content including attachment context as text descriptions.
 * Actual images are loaded on-demand via the load_attachment tool.
 */
function formatMessageContent(msg: MessageWithAttachments, textPrefix: string = ""): string {
  let content = textPrefix + msg.contentMarkdown

  if (msg.attachments && msg.attachments.length > 0) {
    const descriptions = msg.attachments.map(formatAttachmentDescription)
    content += "\n\n" + descriptions.join("\n\n")
  }

  return content
}
