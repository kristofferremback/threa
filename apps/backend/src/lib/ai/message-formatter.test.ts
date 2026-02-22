import { describe, test, expect, mock, beforeEach, spyOn } from "bun:test"
import { MessageFormatter } from "./message-formatter"
import { UserRepository } from "../../features/workspaces"
import { PersonaRepository } from "../../features/agents"
import type { Message } from "../../features/messaging"
import type { AttachmentWithExtraction } from "../../features/attachments"
import type { Querier } from "../../db"

const mockFindMembersByIds = mock(() => Promise.resolve([] as { id: string; name: string }[]))
const mockFindPersonasByIds = mock(() => Promise.resolve([] as { id: string; name: string }[]))

const mockClient = {} as Querier

function createMessage(overrides: Partial<Message> = {}): Message {
  const contentMarkdown = overrides.contentMarkdown ?? "Hello, world!"
  return {
    id: "msg_123",
    streamId: "stream_123",
    sequence: 1n,
    authorId: "member_123",
    authorType: "member",
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: contentMarkdown }] }] },
    contentMarkdown,
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
    mockFindMembersByIds.mockReset()
    mockFindPersonasByIds.mockReset()

    mockFindMembersByIds.mockResolvedValue([])
    mockFindPersonasByIds.mockResolvedValue([])

    spyOn(UserRepository, "findByIds").mockImplementation(mockFindMembersByIds as any)
    spyOn(PersonaRepository, "findByIds").mockImplementation(mockFindPersonasByIds as any)

    formatter = new MessageFormatter()
  })

  test("should return empty wrapper for empty message list", async () => {
    const result = await formatter.formatMessages(mockClient, [])

    expect(result).toBe("<messages></messages>")
    expect(mockFindMembersByIds).not.toHaveBeenCalled()
    expect(mockFindPersonasByIds).not.toHaveBeenCalled()
  })

  test("should format messages with user author names", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        authorId: "member_123",
        authorType: "member",
        contentMarkdown: "Hello!",
        createdAt: new Date("2024-01-01T10:00:00Z"),
      }),
    ]

    mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(result).toBe(
      '<messages>\n<message authorType="member" authorId="member_123" authorName="Alice" createdAt="2024-01-01T10:00:00.000Z">Hello!</message>\n</messages>'
    )
  })

  test("should format messages with persona author names", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        authorId: "persona_456",
        authorType: "persona",
        contentMarkdown: "I can help with that!",
        createdAt: new Date("2024-01-01T10:00:01Z"),
      }),
    ]

    mockFindPersonasByIds.mockResolvedValue([{ id: "persona_456", name: "Ariadne" }])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(result).toBe(
      '<messages>\n<message authorType="persona" authorId="persona_456" authorName="Ariadne" createdAt="2024-01-01T10:00:01.000Z">I can help with that!</message>\n</messages>'
    )
  })

  test("should batch lookup mixed authors efficiently", async () => {
    const createdAt = new Date("2024-01-01T10:00:00Z")
    const messages = [
      createMessage({
        id: "msg_1",
        authorId: "member_123",
        authorType: "member",
        contentMarkdown: "Question?",
        createdAt,
      }),
      createMessage({
        id: "msg_2",
        authorId: "persona_456",
        authorType: "persona",
        contentMarkdown: "Answer!",
        createdAt,
      }),
      createMessage({
        id: "msg_3",
        authorId: "member_123",
        authorType: "member",
        contentMarkdown: "Thanks!",
        createdAt,
      }),
    ]

    mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])
    mockFindPersonasByIds.mockResolvedValue([{ id: "persona_456", name: "Ariadne" }])

    const result = await formatter.formatMessages(mockClient, messages)

    // Verify batch efficiency: only 1 call per author type despite 3 messages
    expect(mockFindMembersByIds).toHaveBeenCalledWith(mockClient, ["member_123"])
    expect(mockFindPersonasByIds).toHaveBeenCalledWith(mockClient, ["persona_456"])

    expect(result).toBe(
      "<messages>\n" +
        '<message authorType="member" authorId="member_123" authorName="Alice" createdAt="2024-01-01T10:00:00.000Z">Question?</message>\n' +
        '<message authorType="persona" authorId="persona_456" authorName="Ariadne" createdAt="2024-01-01T10:00:00.000Z">Answer!</message>\n' +
        '<message authorType="member" authorId="member_123" authorName="Alice" createdAt="2024-01-01T10:00:00.000Z">Thanks!</message>\n' +
        "</messages>"
    )
  })

  test("should use 'Unknown' for unresolved author IDs", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        authorId: "member_deleted",
        authorType: "member",
        contentMarkdown: "Message from deleted user",
      }),
    ]

    mockFindMembersByIds.mockResolvedValue([])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(result).toContain('authorName="Unknown"')
  })

  test("should preserve message order", async () => {
    const messages = [
      createMessage({ id: "msg_1", contentMarkdown: "First", createdAt: new Date("2024-01-01T10:00:00Z") }),
      createMessage({ id: "msg_2", contentMarkdown: "Second", createdAt: new Date("2024-01-01T10:00:01Z") }),
      createMessage({ id: "msg_3", contentMarkdown: "Third", createdAt: new Date("2024-01-01T10:00:02Z") }),
    ]

    mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

    const result = await formatter.formatMessages(mockClient, messages)

    const firstIndex = result.indexOf("First")
    const secondIndex = result.indexOf("Second")
    const thirdIndex = result.indexOf("Third")

    expect(firstIndex).toBeLessThan(secondIndex)
    expect(secondIndex).toBeLessThan(thirdIndex)
  })

  test("should include createdAt in ISO format", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        createdAt: new Date("2024-01-01T10:00:00Z"),
      }),
    ]

    mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(result).toContain('createdAt="2024-01-01T10:00:00.000Z"')
  })

  test("should escape XML special characters in message content", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        contentMarkdown: "if (a < b && c > d) { return <tag>; }",
      }),
    ]

    mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(result).toContain("if (a &lt; b &amp;&amp; c &gt; d) { return &lt;tag&gt;; }")
    expect(result).not.toContain("<tag>")
  })

  test("should escape quotes in author names", async () => {
    const messages = [
      createMessage({
        id: "msg_1",
        authorId: "member_123",
        authorType: "member",
        contentMarkdown: "Hello",
      }),
    ]

    mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: 'Bob "The Builder" Smith' }])

    const result = await formatter.formatMessages(mockClient, messages)

    expect(result).toContain('authorName="Bob &quot;The Builder&quot; Smith"')
    expect(result).not.toContain('authorName="Bob "The Builder" Smith"')
  })

  describe("formatMessagesInline", () => {
    test("should return empty string for empty message list", async () => {
      const result = await formatter.formatMessagesInline(mockClient, [])

      expect(result).toBe("")
      expect(mockFindMembersByIds).not.toHaveBeenCalled()
      expect(mockFindPersonasByIds).not.toHaveBeenCalled()
    })

    test("should format messages in inline format without IDs", async () => {
      const messages = [
        createMessage({
          id: "msg_1",
          authorId: "member_123",
          authorType: "member",
          contentMarkdown: "Hello!",
          createdAt: new Date("2024-01-01T10:00:00Z"),
        }),
        createMessage({
          id: "msg_2",
          authorId: "persona_456",
          authorType: "persona",
          contentMarkdown: "Hi there!",
          createdAt: new Date("2024-01-01T10:00:01Z"),
        }),
      ]

      mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])
      mockFindPersonasByIds.mockResolvedValue([{ id: "persona_456", name: "Ariadne" }])

      const result = await formatter.formatMessagesInline(mockClient, messages)

      expect(result).toBe(
        "[2024-01-01T10:00:00.000Z] [member] Alice: Hello!\n\n[2024-01-01T10:00:01.000Z] [persona] Ariadne: Hi there!"
      )
    })

    test("should include message IDs when includeIds option is true", async () => {
      const messages = [
        createMessage({
          id: "msg_abc123",
          authorId: "member_123",
          authorType: "member",
          contentMarkdown: "Hello!",
          createdAt: new Date("2024-01-01T10:00:00Z"),
        }),
      ]

      mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

      const result = await formatter.formatMessagesInline(mockClient, messages, { includeIds: true })

      expect(result).toBe("[ID:msg_abc123] [2024-01-01T10:00:00.000Z] [member] Alice: Hello!")
    })

    test("should use 'Unknown' for unresolved author IDs", async () => {
      const messages = [
        createMessage({
          id: "msg_1",
          authorId: "member_deleted",
          authorType: "member",
          contentMarkdown: "Message from deleted user",
          createdAt: new Date("2024-01-01T10:00:00Z"),
        }),
      ]

      mockFindMembersByIds.mockResolvedValue([])

      const result = await formatter.formatMessagesInline(mockClient, messages)

      expect(result).toBe("[2024-01-01T10:00:00.000Z] [member] Unknown: Message from deleted user")
    })

    test("should separate messages with double newlines", async () => {
      const messages = [
        createMessage({ id: "msg_1", contentMarkdown: "First", createdAt: new Date("2024-01-01T10:00:00Z") }),
        createMessage({ id: "msg_2", contentMarkdown: "Second", createdAt: new Date("2024-01-01T10:00:01Z") }),
      ]

      mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

      const result = await formatter.formatMessagesInline(mockClient, messages)

      expect(result).toBe(
        "[2024-01-01T10:00:00.000Z] [member] Alice: First\n\n[2024-01-01T10:00:01.000Z] [member] Alice: Second"
      )
    })
  })

  describe("formatMessagesWithAttachments", () => {
    function createAttachment(overrides: Partial<AttachmentWithExtraction> = {}): AttachmentWithExtraction {
      return {
        id: "attach_123",
        workspaceId: "ws_123",
        streamId: "stream_123",
        messageId: "msg_123",
        uploadedBy: "member_123",
        filename: "image.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        storageProvider: "s3" as const,
        storagePath: "/path/to/image.jpg",
        processingStatus: "completed" as const,
        safetyStatus: "clean" as const,
        createdAt: new Date("2024-01-01T10:00:00Z"),
        extraction: null,
        ...overrides,
      }
    }

    test("should return empty wrapper for empty message list", async () => {
      const result = await formatter.formatMessagesWithAttachments(mockClient, [], new Map())

      expect(result).toBe("<messages></messages>")
    })

    test("should format messages without attachments", async () => {
      const messages = [
        createMessage({
          id: "msg_1",
          authorId: "member_123",
          authorType: "member",
          contentMarkdown: "Hello!",
          createdAt: new Date("2024-01-01T10:00:00Z"),
        }),
      ]

      mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

      const result = await formatter.formatMessagesWithAttachments(mockClient, messages, new Map())

      expect(result).toContain('authorName="Alice"')
      expect(result).toContain("Hello!")
      expect(result).not.toContain("<attachment")
    })

    test("should include attachment extraction summary in message", async () => {
      const messages = [
        createMessage({
          id: "msg_1",
          authorId: "member_123",
          authorType: "member",
          contentMarkdown: "What's in this image?",
          createdAt: new Date("2024-01-01T10:00:00Z"),
        }),
      ]

      const attachmentsMap = new Map<string, AttachmentWithExtraction[]>()
      attachmentsMap.set("msg_1", [
        createAttachment({
          id: "attach_1",
          messageId: "msg_1",
          filename: "fish.jpg",
          extraction: {
            contentType: "photo" as const,
            summary: "A colorful tropical fish swimming in a coral reef",
            fullText: null,
          },
        }),
      ])

      mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

      const result = await formatter.formatMessagesWithAttachments(mockClient, messages, attachmentsMap)

      expect(result).toContain("What's in this image?")
      expect(result).toContain('<attachment filename="fish.jpg" contentType="photo">')
      expect(result).toContain("A colorful tropical fish swimming in a coral reef</attachment>")
    })

    test("should handle multiple attachments on same message", async () => {
      const messages = [
        createMessage({
          id: "msg_1",
          authorId: "member_123",
          authorType: "member",
          contentMarkdown: "Compare these images",
          createdAt: new Date("2024-01-01T10:00:00Z"),
        }),
      ]

      const attachmentsMap = new Map<string, AttachmentWithExtraction[]>()
      attachmentsMap.set("msg_1", [
        createAttachment({
          id: "attach_1",
          messageId: "msg_1",
          filename: "cat.jpg",
          extraction: {
            contentType: "photo" as const,
            summary: "An orange tabby cat sleeping on a couch",
            fullText: null,
          },
        }),
        createAttachment({
          id: "attach_2",
          messageId: "msg_1",
          filename: "dog.jpg",
          extraction: {
            contentType: "photo" as const,
            summary: "A golden retriever playing in a park",
            fullText: null,
          },
        }),
      ])

      mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

      const result = await formatter.formatMessagesWithAttachments(mockClient, messages, attachmentsMap)

      expect(result).toContain('<attachment filename="cat.jpg" contentType="photo">')
      expect(result).toContain("An orange tabby cat sleeping on a couch</attachment>")
      expect(result).toContain('<attachment filename="dog.jpg" contentType="photo">')
      expect(result).toContain("A golden retriever playing in a park</attachment>")
    })

    test("should skip attachments without extractions", async () => {
      const messages = [
        createMessage({
          id: "msg_1",
          authorId: "member_123",
          authorType: "member",
          contentMarkdown: "Check this file",
          createdAt: new Date("2024-01-01T10:00:00Z"),
        }),
      ]

      const attachmentsMap = new Map<string, AttachmentWithExtraction[]>()
      attachmentsMap.set("msg_1", [
        createAttachment({
          id: "attach_1",
          messageId: "msg_1",
          filename: "document.pdf",
          extraction: null, // No extraction
        }),
      ])

      mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

      const result = await formatter.formatMessagesWithAttachments(mockClient, messages, attachmentsMap)

      expect(result).toContain("Check this file")
      expect(result).not.toContain("<attachment")
    })

    test("should escape XML special characters in filenames and summaries", async () => {
      const messages = [
        createMessage({
          id: "msg_1",
          authorId: "member_123",
          authorType: "member",
          contentMarkdown: "Look at this",
          createdAt: new Date("2024-01-01T10:00:00Z"),
        }),
      ]

      const attachmentsMap = new Map<string, AttachmentWithExtraction[]>()
      attachmentsMap.set("msg_1", [
        createAttachment({
          id: "attach_1",
          messageId: "msg_1",
          filename: 'file"with"quotes.jpg',
          extraction: {
            contentType: "photo" as const,
            summary: "Image with <brackets> & ampersand",
            fullText: null,
          },
        }),
      ])

      mockFindMembersByIds.mockResolvedValue([{ id: "member_123", name: "Alice" }])

      const result = await formatter.formatMessagesWithAttachments(mockClient, messages, attachmentsMap)

      expect(result).toContain('filename="file&quot;with&quot;quotes.jpg"')
      expect(result).toContain("Image with &lt;brackets&gt; &amp; ampersand</attachment>")
    })
  })
})
