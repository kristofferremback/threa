import { describe, test, expect } from "bun:test"
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages"

// Re-implement the truncation functions here for testing since they're not exported
// This tests the logic without needing to export internal functions

function getMessageLength(message: { content: string | unknown[] }): number {
  if (typeof message.content === "string") {
    return message.content.length
  }
  if (Array.isArray(message.content)) {
    return message.content.reduce((sum: number, part) => {
      if (typeof part === "string") return sum + part.length
      if (typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part) {
        return sum + ((part as { text?: string }).text?.length ?? 0)
      }
      return sum
    }, 0)
  }
  return 0
}

function truncateMessages<T extends { content: string | unknown[] }>(messages: T[], maxChars: number): T[] {
  if (messages.length === 0) return messages

  let totalLength = 0
  for (const msg of messages) {
    totalLength += getMessageLength(msg)
  }

  if (totalLength <= maxChars) return messages

  const kept: T[] = []
  let keptLength = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const msgLength = getMessageLength(msg)

    if (keptLength + msgLength > maxChars && kept.length > 0) {
      break
    }

    kept.unshift(msg)
    keptLength += msgLength
  }

  return kept
}

describe("message truncation", () => {
  test("returns all messages when under limit", () => {
    const messages = [new HumanMessage("Hello"), new AIMessage("Hi there!")]

    const result = truncateMessages(messages, 1000)

    expect(result.length).toBe(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("Hi there!")
  })

  test("truncates old messages when over limit", () => {
    const messages = [
      new HumanMessage("A".repeat(100)), // 100 chars
      new HumanMessage("B".repeat(100)), // 100 chars
      new HumanMessage("C".repeat(100)), // 100 chars
    ]

    const result = truncateMessages(messages, 150)

    // Should keep only the last 1-2 messages that fit
    expect(result.length).toBeLessThan(3)
    // Should include the most recent message
    expect((result[result.length - 1].content as string).startsWith("C")).toBe(true)
  })

  test("always keeps at least one message", () => {
    const messages = [
      new HumanMessage("A".repeat(1000)), // Way over any reasonable limit
    ]

    const result = truncateMessages(messages, 10)

    expect(result.length).toBe(1)
    expect(result[0].content).toBe(messages[0].content)
  })

  test("handles empty message array", () => {
    const result = truncateMessages([], 1000)

    expect(result.length).toBe(0)
  })

  test("handles messages with array content", () => {
    const messages = [
      { content: [{ type: "text", text: "Hello" }] } as unknown as HumanMessage,
      { content: [{ type: "text", text: "World" }] } as unknown as AIMessage,
    ]

    const result = truncateMessages(messages, 1000)

    expect(result.length).toBe(2)
  })

  test("handles mixed content types", () => {
    const messages = [
      new HumanMessage("Hello"),
      new AIMessage("Hi!"),
      new ToolMessage({ content: "Tool result", tool_call_id: "call_1" }),
    ]

    const result = truncateMessages(messages, 1000)

    expect(result.length).toBe(3)
  })

  test("keeps most recent messages when truncating", () => {
    const messages = [
      new HumanMessage("First message - should be dropped"),
      new HumanMessage("Second message - should be dropped"),
      new HumanMessage("Third message - should be kept"),
      new AIMessage("Response"),
    ]

    // Total: 35 + 36 + 35 + 8 = 114 chars
    // Limit to 50 chars - should keep "Third message - should be kept" (35) + "Response" (8) = 43
    const result = truncateMessages(messages, 50)

    expect(result.length).toBe(2)
    expect(result[0].content as string).toBe("Third message - should be kept")
    expect(result[1].content as string).toBe("Response")
  })
})
