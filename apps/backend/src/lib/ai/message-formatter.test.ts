import { describe, test, expect, mock, beforeEach } from "bun:test"
import { MessageFormatter } from "./message-formatter"
import type { Message } from "../../repositories/message-repository"
import type { PoolClient } from "pg"

const mockFindUsersByIds = mock(() => Promise.resolve([]))
const mockFindPersonasByIds = mock(() => Promise.resolve([]))

mock.module("../../repositories/user-repository", () => ({
  UserRepository: {
    findByIds: mockFindUsersByIds,
  },
}))

mock.module("../../repositories/persona-repository", () => ({
  PersonaRepository: {
    findByIds: mockFindPersonasByIds,
  },
}))

const mockClient = {} as PoolClient

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_123",
    streamId: "stream_123",
    sequence: 1n,
    authorId: "user_123",
    authorType: "user",
    content: "Hello, world!",
    contentFormat: "markdown",
    replyCount: 0,
    reactions: {},
    editedAt: null,
    deletedAt: null,
    createdAt: new Date("2024-01-01T10:00:00Z"),
    ...overrides,
  }
}

describe("MessageFormatter", () => {
  let formatter: MessageFormatter

  beforeEach(() => {
    mockFindUsersByIds.mockReset()
    mockFindPersonasByIds.mockReset()

    mockFindUsersByIds.mockResolvedValue([])
    mockFindPersonasByIds.mockResolvedValue([])

    formatter = new MessageFormatter()
  })

  test("should return empty wrapper for empty message list", async () => {
    const result = await formatter.formatMessages(mockClient, [])

    expect(result).toBe("<messages></messages>")
    expect(mockFindUsersByIds).not.toHaveBeenCalled()
    expect(mockFindPersonasByIds).not.toHaveBeenCalled()
  })

  test("should format messages with user author names", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        authorId: "user_123",
        authorType: "user",
        content: "Hello!",
        createdAt: new Date("2024-01-01T10:00:00Z"),
      }),
    ]

    mockFindUsersByIds.mockResolvedValue([{ id: "user_123", name: "Alice" }])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(result).toContain('authorName="Alice"')
    expect(result).toContain('authorType="user"')
    expect(result).toContain('authorId="user_123"')
    expect(result).toContain("Hello!")
  })

  test("should format messages with persona author names", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        authorId: "persona_456",
        authorType: "persona",
        content: "I can help with that!",
        createdAt: new Date("2024-01-01T10:00:01Z"),
      }),
    ]

    mockFindPersonasByIds.mockResolvedValue([{ id: "persona_456", name: "Ariadne" }])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(result).toContain('authorName="Ariadne"')
    expect(result).toContain('authorType="persona"')
    expect(result).toContain('authorId="persona_456"')
    expect(result).toContain("I can help with that!")
  })

  test("should batch lookup mixed authors efficiently", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        authorId: "user_123",
        authorType: "user",
        content: "Question?",
      }),
      createMessage({
        id: "msg_2",
        authorId: "persona_456",
        authorType: "persona",
        content: "Answer!",
      }),
      createMessage({
        id: "msg_3",
        authorId: "user_123",
        authorType: "user",
        content: "Thanks!",
      }),
    ]

    mockFindUsersByIds.mockResolvedValue([{ id: "user_123", name: "Alice" }])
    mockFindPersonasByIds.mockResolvedValue([{ id: "persona_456", name: "Ariadne" }])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(mockFindUsersByIds).toHaveBeenCalledTimes(1)
    expect(mockFindPersonasByIds).toHaveBeenCalledTimes(1)

    expect(mockFindUsersByIds).toHaveBeenCalledWith(mockClient, ["user_123"])
    expect(mockFindPersonasByIds).toHaveBeenCalledWith(mockClient, ["persona_456"])

    expect(result).toContain('authorName="Alice"')
    expect(result).toContain('authorName="Ariadne"')
  })

  test("should use 'Unknown' for unresolved author IDs", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        authorId: "user_deleted",
        authorType: "user",
        content: "Message from deleted user",
      }),
    ]

    mockFindUsersByIds.mockResolvedValue([])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(result).toContain('authorName="Unknown"')
  })

  test("should preserve message order", async () => {
    const messages = [
      createMessage({ id: "msg_1", content: "First", createdAt: new Date("2024-01-01T10:00:00Z") }),
      createMessage({ id: "msg_2", content: "Second", createdAt: new Date("2024-01-01T10:00:01Z") }),
      createMessage({ id: "msg_3", content: "Third", createdAt: new Date("2024-01-01T10:00:02Z") }),
    ]

    mockFindUsersByIds.mockResolvedValue([{ id: "user_123", name: "Alice" }])

    const result = await formatter.formatMessages(mockClient, messages)

    const firstIndex = result.indexOf("First")
    const secondIndex = result.indexOf("Second")
    const thirdIndex = result.indexOf("Third")

    expect(firstIndex).toBeLessThan(secondIndex)
    expect(secondIndex).toBeLessThan(thirdIndex)
  })

  test("should include createdAt in output", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        createdAt: new Date("2024-01-01T10:00:00Z"),
      }),
    ]

    mockFindUsersByIds.mockResolvedValue([{ id: "user_123", name: "Alice" }])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(result).toContain("createdAt=")
  })

  describe("formatMessagesInline", () => {
    test("should return empty string for empty message list", async () => {
      const result = await formatter.formatMessagesInline(mockClient, [])

      expect(result).toBe("")
      expect(mockFindUsersByIds).not.toHaveBeenCalled()
      expect(mockFindPersonasByIds).not.toHaveBeenCalled()
    })

    test("should format messages in inline format without IDs", async () => {
      const messages = [
        createMessage({
          id: "msg_1",
          authorId: "user_123",
          authorType: "user",
          content: "Hello!",
        }),
        createMessage({
          id: "msg_2",
          authorId: "persona_456",
          authorType: "persona",
          content: "Hi there!",
        }),
      ]

      mockFindUsersByIds.mockResolvedValue([{ id: "user_123", name: "Alice" }])
      mockFindPersonasByIds.mockResolvedValue([{ id: "persona_456", name: "Ariadne" }])

      const result = await formatter.formatMessagesInline(mockClient, messages)

      expect(result).toContain("[user] Alice: Hello!")
      expect(result).toContain("[persona] Ariadne: Hi there!")
      expect(result).not.toContain("[ID:")
    })

    test("should include message IDs when includeIds option is true", async () => {
      const messages = [
        createMessage({
          id: "msg_abc123",
          authorId: "user_123",
          authorType: "user",
          content: "Hello!",
        }),
      ]

      mockFindUsersByIds.mockResolvedValue([{ id: "user_123", name: "Alice" }])

      const result = await formatter.formatMessagesInline(mockClient, messages, { includeIds: true })

      expect(result).toContain("[ID:msg_abc123]")
      expect(result).toContain("[user] Alice: Hello!")
    })

    test("should use 'Unknown' for unresolved author IDs", async () => {
      const messages = [
        createMessage({
          id: "msg_1",
          authorId: "user_deleted",
          authorType: "user",
          content: "Message from deleted user",
        }),
      ]

      mockFindUsersByIds.mockResolvedValue([])

      const result = await formatter.formatMessagesInline(mockClient, messages)

      expect(result).toContain("[user] Unknown: Message from deleted user")
    })

    test("should separate messages with double newlines", async () => {
      const messages = [
        createMessage({ id: "msg_1", content: "First" }),
        createMessage({ id: "msg_2", content: "Second" }),
      ]

      mockFindUsersByIds.mockResolvedValue([{ id: "user_123", name: "Alice" }])

      const result = await formatter.formatMessagesInline(mockClient, messages)

      expect(result).toContain("First\n\n")
      expect(result).toContain("Second")
    })
  })
})
