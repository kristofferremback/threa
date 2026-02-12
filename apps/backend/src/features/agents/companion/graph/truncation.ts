import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages"
import { logger } from "../../../../lib/logger"

/**
 * Maximum context size in characters for messages sent to the model.
 * This is a conservative limit to stay well under the 200k token limit.
 * Roughly 4 chars per token, so 400k chars ≈ 100k tokens.
 */
export const MAX_MESSAGE_CHARS = 400_000

/**
 * Maximum size for any single message in characters.
 * Individual messages larger than this will be truncated.
 * This prevents a single huge message from consuming all context.
 */
const MAX_SINGLE_MESSAGE_CHARS = 50_000

/**
 * Get the character length of a message's content.
 */
function getMessageLength(message: BaseMessage): number {
  if (typeof message.content === "string") {
    return message.content.length
  }
  if (Array.isArray(message.content)) {
    return message.content.reduce((sum: number, part: unknown) => {
      if (typeof part === "string") return sum + part.length
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        (part as { type: string }).type === "text" &&
        "text" in part
      ) {
        return sum + ((part as { text?: string }).text?.length ?? 0)
      }
      return sum
    }, 0)
  }
  return 0
}

/**
 * Get the type string for a message using static isInstance checks.
 */
function getMessageType(message: BaseMessage): string {
  if (HumanMessage.isInstance(message)) return "human"
  if (AIMessage.isInstance(message)) return "ai"
  if (SystemMessage.isInstance(message)) return "system"
  if (ToolMessage.isInstance(message)) return "tool"
  return "unknown"
}

/**
 * Truncate a single message's content if it exceeds the limit.
 * Returns a new message with truncated content, or the original if no truncation needed.
 */
function truncateSingleMessage(message: BaseMessage, maxChars: number): BaseMessage {
  const length = getMessageLength(message)
  if (length <= maxChars) return message

  const messageType = getMessageType(message)
  logger.warn({ messageLength: length, maxChars, messageType }, "Truncating oversized message")

  // Truncate the content
  if (typeof message.content === "string") {
    const truncated = message.content.slice(0, maxChars) + "\n\n[... content truncated due to length ...]"
    switch (true) {
      case HumanMessage.isInstance(message):
        return new HumanMessage({ content: truncated, id: message.id })
      case AIMessage.isInstance(message):
        return new AIMessage({
          content: truncated,
          id: message.id,
          tool_calls: message.tool_calls,
        })
      case SystemMessage.isInstance(message):
        return new SystemMessage({ content: truncated, id: message.id })
      case ToolMessage.isInstance(message):
        return new ToolMessage({
          content: truncated,
          tool_call_id: message.tool_call_id,
        })
      default:
        logger.warn({ messageType }, "Unknown message type in truncation, creating generic message")
        return new HumanMessage({ content: truncated, id: message.id })
    }
  }

  // For array content (multimodal), truncate text parts
  if (Array.isArray(message.content)) {
    let remainingChars = maxChars
    const truncatedContent: unknown[] = []

    for (const part of message.content as unknown[]) {
      const isTextBlock =
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        (part as { type: string }).type === "text" &&
        "text" in part

      switch (true) {
        case typeof part === "string":
          if (part.length <= remainingChars) {
            truncatedContent.push(part)
            remainingChars -= part.length
          } else {
            truncatedContent.push(part.slice(0, remainingChars) + "\n\n[... content truncated ...]")
            remainingChars = 0
          }
          break
        case isTextBlock: {
          const textPart = part as { type: string; text: string }
          if (textPart.text.length <= remainingChars) {
            truncatedContent.push(part)
            remainingChars -= textPart.text.length
          } else {
            truncatedContent.push({
              type: "text",
              text: textPart.text.slice(0, remainingChars) + "\n\n[... content truncated ...]",
            })
            remainingChars = 0
          }
          break
        }
        default:
          // Keep non-text parts (images, etc.)
          truncatedContent.push(part)
      }
      if (remainingChars === 0) break
    }

    switch (true) {
      case HumanMessage.isInstance(message):
        return new HumanMessage({ content: truncatedContent as HumanMessage["content"], id: message.id })
      case AIMessage.isInstance(message):
        return new AIMessage({
          content: truncatedContent as AIMessage["content"],
          id: message.id,
          tool_calls: message.tool_calls,
        })
      case ToolMessage.isInstance(message):
        return new ToolMessage({
          content: truncatedContent as ToolMessage["content"],
          tool_call_id: message.tool_call_id,
        })
      default:
        logger.warn({ messageType }, "Unknown message type with array content in truncation")
        return new HumanMessage({ content: truncatedContent as HumanMessage["content"], id: message.id })
    }
  }

  // Fallback: if we get here, log and return truncated as HumanMessage
  logger.warn({ messageType, contentType: typeof message.content }, "Unhandled content type in truncation")
  return message
}

/**
 * Truncate messages to stay within context limits.
 * Keeps recent messages, preserving tool call/response pairs.
 *
 * Strategy:
 * 1. First, truncate any individual messages that are too large
 * 2. Calculate total length of all messages
 * 3. If under limit, return all messages
 * 4. Otherwise, keep the most recent messages that fit
 * 5. Always keep at least the last message for context
 */
export function truncateMessages(messages: BaseMessage[], maxChars: number): BaseMessage[] {
  if (messages.length === 0) return messages

  // First pass: truncate any oversized individual messages
  const truncatedIndividual = messages.map((msg) => truncateSingleMessage(msg, MAX_SINGLE_MESSAGE_CHARS))

  // Calculate total length after individual truncation
  let totalLength = 0
  for (const msg of truncatedIndividual) {
    totalLength += getMessageLength(msg)
  }

  // If under limit, return all (after individual truncation)
  if (totalLength <= maxChars) return truncatedIndividual

  logger.warn(
    { totalLength, maxChars, messageCount: truncatedIndividual.length },
    "Truncating messages to stay within context limit"
  )

  // Build from the end, keeping messages until we hit the limit
  const kept: BaseMessage[] = []
  let keptLength = 0

  // Walk backwards through messages
  for (let i = truncatedIndividual.length - 1; i >= 0; i--) {
    const msg = truncatedIndividual[i]
    const msgLength = getMessageLength(msg)

    // If adding this message would exceed limit, stop
    // But always keep at least 1 message
    if (keptLength + msgLength > maxChars && kept.length > 0) {
      break
    }

    kept.unshift(msg)
    keptLength += msgLength
  }

  logger.info(
    { keptLength, keptCount: kept.length, droppedCount: truncatedIndividual.length - kept.length },
    "Messages truncated"
  )

  return kept
}
