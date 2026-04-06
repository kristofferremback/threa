import { describe, expect, test } from "bun:test"
import { appendMessage, resolveTag, formatTitle, formatBody, type NotificationMessage } from "./sw-notification-format"

describe("resolveTag", () => {
  test("returns streamId for message activity", () => {
    expect(resolveTag("stream_123", "message")).toBe("stream_123")
  })

  test("returns streamId:mention for mention activity", () => {
    expect(resolveTag("stream_123", "mention")).toBe("stream_123:mention")
  })

  test("returns streamId when activityType is undefined", () => {
    expect(resolveTag("stream_123")).toBe("stream_123")
  })
})

describe("appendMessage", () => {
  test("appends to empty list", () => {
    const result = appendMessage([], { authorName: "Alice", contentPreview: "hello" })
    expect(result).toEqual([{ authorName: "Alice", contentPreview: "hello" }])
  })

  test("appends to existing list", () => {
    const existing: NotificationMessage[] = [{ authorName: "Alice", contentPreview: "first" }]
    const result = appendMessage(existing, { authorName: "Bob", contentPreview: "second" })
    expect(result).toEqual([
      { authorName: "Alice", contentPreview: "first" },
      { authorName: "Bob", contentPreview: "second" },
    ])
  })

  test("caps at 5 messages, dropping oldest", () => {
    const existing: NotificationMessage[] = Array.from({ length: 5 }, (_, i) => ({
      authorName: `User${i}`,
      contentPreview: `msg${i}`,
    }))
    const result = appendMessage(existing, { authorName: "New", contentPreview: "latest" })
    expect(result).toHaveLength(5)
    expect(result[0].authorName).toBe("User1")
    expect(result[4]).toEqual({ authorName: "New", contentPreview: "latest" })
  })

  test("does not mutate the input array", () => {
    const existing: NotificationMessage[] = [{ authorName: "Alice", contentPreview: "hi" }]
    appendMessage(existing, { authorName: "Bob", contentPreview: "hey" })
    expect(existing).toHaveLength(1)
  })
})

describe("formatTitle", () => {
  test("single message with stream name", () => {
    const messages: NotificationMessage[] = [{ authorName: "Alice", contentPreview: "hey" }]
    expect(formatTitle(messages, "#general")).toBe("#general")
  })

  test("single message without stream name", () => {
    const messages: NotificationMessage[] = [{ authorName: "Alice", contentPreview: "hey" }]
    expect(formatTitle(messages)).toBe("New message")
  })

  test("single mention with stream name", () => {
    const messages: NotificationMessage[] = [{ authorName: "Alice", contentPreview: "hey @bob" }]
    expect(formatTitle(messages, "#general", "mention")).toBe("Mentioned in #general")
  })

  test("single mention without stream name", () => {
    const messages: NotificationMessage[] = [{ authorName: "Alice", contentPreview: "hey @bob" }]
    expect(formatTitle(messages, undefined, "mention")).toBe("You were mentioned")
  })

  test("multiple messages with stream name", () => {
    const messages: NotificationMessage[] = [
      { authorName: "Alice", contentPreview: "first" },
      { authorName: "Bob", contentPreview: "second" },
      { authorName: "Carol", contentPreview: "third" },
    ]
    expect(formatTitle(messages, "#general")).toBe("#general · 3 new messages")
  })

  test("multiple messages without stream name", () => {
    const messages: NotificationMessage[] = [
      { authorName: "Alice", contentPreview: "first" },
      { authorName: "Bob", contentPreview: "second" },
    ]
    expect(formatTitle(messages)).toBe("2 new messages")
  })

  test("multiple mentions with stream name", () => {
    const messages: NotificationMessage[] = [
      { authorName: "Alice", contentPreview: "hey @bob" },
      { authorName: "Carol", contentPreview: "@bob check this" },
    ]
    expect(formatTitle(messages, "#general", "mention")).toBe("2 new mentions in #general")
  })
})

describe("formatBody", () => {
  test("single message with author and preview", () => {
    const messages: NotificationMessage[] = [{ authorName: "Alice", contentPreview: "hello team" }]
    expect(formatBody(messages)).toBe("Alice: hello team")
  })

  test("single message without author", () => {
    const messages: NotificationMessage[] = [{ contentPreview: "hello team" }]
    expect(formatBody(messages)).toBe("hello team")
  })

  test("single message with author but no preview", () => {
    const messages: NotificationMessage[] = [{ authorName: "Alice" }]
    expect(formatBody(messages)).toBe("Alice")
  })

  test("single message with neither author nor preview", () => {
    const messages: NotificationMessage[] = [{}]
    expect(formatBody(messages)).toBe("New message")
  })

  test("multiple messages joined by newlines", () => {
    const messages: NotificationMessage[] = [
      { authorName: "Alice", contentPreview: "hello" },
      { authorName: "Bob", contentPreview: "world" },
    ]
    expect(formatBody(messages)).toBe("Alice: hello\nBob: world")
  })

  test("truncates long previews at 80 chars", () => {
    const longPreview = "a".repeat(100)
    const messages: NotificationMessage[] = [{ authorName: "Alice", contentPreview: longPreview }]
    const body = formatBody(messages)
    // "Alice: " + 79 chars + "…" = within limit
    expect(body).toBe(`Alice: ${"a".repeat(79)}…`)
  })
})
