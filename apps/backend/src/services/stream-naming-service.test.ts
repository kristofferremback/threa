import { describe, test, expect, mock, beforeEach, spyOn } from "bun:test"
import { StreamNamingService } from "./stream-naming-service"
import { MessageFormatter } from "../lib/ai/message-formatter"
import { AttachmentRepository } from "../repositories/attachment-repository"
import type { AI } from "../lib/ai/ai"
import type { ConfigResolver, ComponentConfig } from "../lib/ai/config-resolver"

// Mock message formatter
const mockFormatMessages = mock(() => Promise.resolve("<messages></messages>"))
const mockFormatMessagesWithAttachments = mock(() => Promise.resolve("<messages></messages>"))
const mockMessageFormatter = {
  formatMessages: mockFormatMessages,
  formatMessagesWithAttachments: mockFormatMessagesWithAttachments,
} as unknown as MessageFormatter

// Mock repositories
const mockStream = {
  id: "stream_123",
  workspaceId: "ws_456",
  type: "scratchpad",
  displayName: null,
  displayNameGeneratedAt: null,
}

const mockMessages = [
  {
    id: "msg_1",
    content: "Hello, can you help me with something?",
    authorType: "user",
    authorId: "user_123",
    createdAt: new Date("2024-01-01T10:00:00Z"),
  },
  {
    id: "msg_2",
    content: "Sure, what do you need?",
    authorType: "persona",
    authorId: "persona_456",
    createdAt: new Date("2024-01-01T10:00:01Z"),
  },
]

const mockFindById = mock(() => Promise.resolve(mockStream))
const mockFindByIdForUpdate = mock(() => Promise.resolve(mockStream))
const mockMessageList = mock(() => Promise.resolve(mockMessages))
const mockStreamList = mock(() => Promise.resolve([] as { id: string; displayName: string | null }[]))
const mockStreamUpdate = mock(() => Promise.resolve())
const mockOutboxInsert = mock(() => Promise.resolve())

mock.module("../repositories/stream-repository", () => ({
  StreamRepository: {
    findById: mockFindById,
    findByIdForUpdate: mockFindByIdForUpdate,
    list: mockStreamList,
    update: mockStreamUpdate,
  },
}))

mock.module("../repositories/message-repository", () => ({
  MessageRepository: {
    list: mockMessageList,
  },
}))

// AttachmentRepository will be mocked via spyOn in beforeEach

// Mock awaitImageProcessing
const mockAwaitImageProcessing = mock(() =>
  Promise.resolve({ allCompleted: true, completedIds: [], failedOrTimedOutIds: [] })
)
mock.module("../lib/await-image-processing", () => ({
  awaitImageProcessing: mockAwaitImageProcessing,
}))

mock.module("../repositories/outbox-repository", () => ({
  OutboxRepository: {
    insert: mockOutboxInsert,
  },
}))

mock.module("../db", () => ({
  withClient: (_pool: unknown, fn: (client: unknown) => Promise<unknown>) => fn({}),
  withTransaction: (_pool: unknown, fn: (client: unknown) => Promise<unknown>) => fn({}),
}))

mock.module("../lib/display-name", () => ({
  needsAutoNaming: () => true,
}))

// Mock AI instance
const mockGenerateText = mock(async (_options: unknown) => ({ value: "", response: {} }))
const mockAI: Partial<AI> = {
  generateText: mockGenerateText as unknown as AI["generateText"],
}

// Mock ConfigResolver
const mockConfigResolver: ConfigResolver = {
  async resolve<T extends ComponentConfig>(): Promise<T> {
    return {
      modelId: "test-model",
      temperature: 0.3,
    } as T
  },
}

const mockPool = {} as any

describe("StreamNamingService", () => {
  let service: StreamNamingService

  beforeEach(() => {
    mockFindById.mockReset()
    mockFindByIdForUpdate.mockReset()
    mockMessageList.mockReset()
    mockStreamList.mockReset()
    mockStreamUpdate.mockReset()
    mockOutboxInsert.mockReset()
    mockGenerateText.mockReset()
    mockFormatMessages.mockReset()
    mockFormatMessagesWithAttachments.mockReset()
    mockAwaitImageProcessing.mockReset()

    mockFindById.mockResolvedValue(mockStream)
    mockFindByIdForUpdate.mockResolvedValue(mockStream)
    mockMessageList.mockResolvedValue(mockMessages)
    mockFormatMessages.mockResolvedValue("<messages></messages>")
    mockFormatMessagesWithAttachments.mockResolvedValue("<messages></messages>")
    mockAwaitImageProcessing.mockResolvedValue({ allCompleted: true, completedIds: [], failedOrTimedOutIds: [] })
    // Don't set default for mockStreamList - each test that needs it will set it

    // Use spyOn for AttachmentRepository to avoid mock.module pollution
    spyOn(AttachmentRepository, "findByMessageIds").mockResolvedValue(new Map())
    spyOn(AttachmentRepository, "findByMessageIdsWithExtractions").mockResolvedValue(new Map())

    service = new StreamNamingService(mockPool, mockAI as AI, mockConfigResolver, mockMessageFormatter)
  })

  describe("attemptAutoNaming with requireName=false (user message)", () => {
    test("should return false when LLM returns NOT_ENOUGH_CONTEXT", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "NOT_ENOUGH_CONTEXT", response: {} })

      const result = await service.attemptAutoNaming("stream_123", false)

      expect(result).toBe(false)
      expect(mockStreamUpdate).not.toHaveBeenCalled()
    })

    test("should generate name when LLM returns valid title", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "Help Request", response: {} })

      const result = await service.attemptAutoNaming("stream_123", false)

      expect(result).toBe(true)
      expect(mockStreamUpdate).toHaveBeenCalledWith({}, "stream_123", {
        displayName: "Help Request",
        displayNameGeneratedAt: expect.any(Date),
      })
    })
  })

  describe("attemptAutoNaming with requireName=true (agent message)", () => {
    test("should throw when LLM returns NOT_ENOUGH_CONTEXT", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "NOT_ENOUGH_CONTEXT", response: {} })

      await expect(service.attemptAutoNaming("stream_123", true)).rejects.toThrow(
        "Failed to generate required name: NOT_ENOUGH_CONTEXT returned"
      )

      expect(mockStreamUpdate).not.toHaveBeenCalled()
    })

    test("should throw when LLM returns empty response", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "", response: {} })

      await expect(service.attemptAutoNaming("stream_123", true)).rejects.toThrow(
        "Failed to generate required name: NOT_ENOUGH_CONTEXT returned"
      )
    })

    test("should generate name when LLM returns valid title", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "Quick Question", response: {} })

      const result = await service.attemptAutoNaming("stream_123", true)

      expect(result).toBe(true)
      expect(mockStreamUpdate).toHaveBeenCalled()
    })
  })

  describe("existing names in prompt", () => {
    test("should include existing scratchpad names in system message", async () => {
      mockStreamList.mockImplementation(() =>
        Promise.resolve([
          { id: "stream_other1", displayName: "Project Planning" },
          { id: "stream_other2", displayName: "Bug Fixes" },
          { id: "stream_123", displayName: null }, // Current stream, should be excluded
        ])
      )

      mockGenerateText.mockResolvedValue({ value: "New Topic", response: {} })

      await service.attemptAutoNaming("stream_123", false)

      const calls = mockGenerateText.mock.calls
      const lastCall = calls[calls.length - 1]?.[0] as { messages: Array<{ role: string; content: string }> }
      const systemMessage = lastCall.messages.find((m) => m.role === "system")?.content ?? ""

      expect(systemMessage).toContain("Project Planning")
      expect(systemMessage).toContain("Bug Fixes")
    })

    test("should exclude current stream from existing names list", async () => {
      mockStreamList.mockImplementation(() =>
        Promise.resolve([
          { id: "stream_123", displayName: "Current Stream Name" },
          { id: "stream_other", displayName: "Another Scratchpad" },
        ])
      )

      mockGenerateText.mockResolvedValue({ value: "New Topic", response: {} })

      await service.attemptAutoNaming("stream_123", false)

      const calls = mockGenerateText.mock.calls
      const lastCall = calls[calls.length - 1]?.[0] as { messages: Array<{ role: string; content: string }> }
      const systemMessage = lastCall.messages.find((m) => m.role === "system")?.content ?? ""

      // Should include the other stream's name
      expect(systemMessage).toContain("Another Scratchpad")
      // Should NOT include current stream's name (excluded by filter)
      expect(systemMessage).not.toContain("Current Stream Name")
    })
  })

  describe("prompt differences based on requireName", () => {
    test("should include NOT_ENOUGH_CONTEXT instruction when requireName=false", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "Title", response: {} })

      await service.attemptAutoNaming("stream_123", false)

      const calls = mockGenerateText.mock.calls
      const lastCall = calls[calls.length - 1]?.[0] as { messages: Array<{ role: string; content: string }> }
      const systemMessage = lastCall.messages.find((m) => m.role === "system")?.content ?? ""

      expect(systemMessage).toContain("NOT_ENOUGH_CONTEXT")
    })

    test("should require generating a name when requireName=true", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "Title", response: {} })

      await service.attemptAutoNaming("stream_123", true)

      const calls = mockGenerateText.mock.calls
      const lastCall = calls[calls.length - 1]?.[0] as { messages: Array<{ role: string; content: string }> }
      const systemMessage = lastCall.messages.find((m) => m.role === "system")?.content ?? ""

      expect(systemMessage).toContain("You MUST generate a title")
    })
  })

  describe("edge cases", () => {
    test("should clean quotes from generated name", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: '"Quoted Title"', response: {} })

      await service.attemptAutoNaming("stream_123", false)

      expect(mockStreamUpdate).toHaveBeenCalledWith({}, "stream_123", {
        displayName: "Quoted Title",
        displayNameGeneratedAt: expect.any(Date),
      })
    })

    test("should reject names that are too long", async () => {
      mockStreamList.mockResolvedValue([])
      const longName = "A".repeat(150)
      mockGenerateText.mockResolvedValue({ value: longName, response: {} })

      const result = await service.attemptAutoNaming("stream_123", false)

      expect(result).toBe(false)
      expect(mockStreamUpdate).not.toHaveBeenCalled()
    })

    test("should throw for too-long names when requireName=true", async () => {
      mockStreamList.mockResolvedValue([])
      const longName = "A".repeat(150)
      mockGenerateText.mockResolvedValue({ value: longName, response: {} })

      await expect(service.attemptAutoNaming("stream_123", true)).rejects.toThrow("invalid response")
    })
  })

  describe("attachment processing", () => {
    test("should await image processing when messages have attachments", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "Fish Image", response: {} })

      // Set up attachments for the messages
      const attachmentsMap = new Map()
      attachmentsMap.set("msg_1", [{ id: "attach_1" }])
      spyOn(AttachmentRepository, "findByMessageIds").mockResolvedValue(attachmentsMap)

      await service.attemptAutoNaming("stream_123", false)

      // Should have called awaitImageProcessing with the attachment IDs
      expect(mockAwaitImageProcessing).toHaveBeenCalledWith(mockPool, ["attach_1"])
    })

    test("should not call awaitImageProcessing when no attachments", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "Title", response: {} })

      // No attachments (default from beforeEach)
      await service.attemptAutoNaming("stream_123", false)

      // Should not have called awaitImageProcessing
      expect(mockAwaitImageProcessing).not.toHaveBeenCalled()
    })

    test("should fetch attachments with extractions after awaiting processing", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "Fish Analysis", response: {} })

      // Set up attachments
      const attachmentsMap = new Map()
      attachmentsMap.set("msg_1", [{ id: "attach_1" }])
      spyOn(AttachmentRepository, "findByMessageIds").mockResolvedValue(attachmentsMap)

      // Set up extractions
      const extractionsMap = new Map()
      extractionsMap.set("msg_1", [
        {
          id: "attach_1",
          extraction: {
            contentType: "photo",
            summary: "A colorful tropical fish",
            fullText: null,
          },
        },
      ])
      spyOn(AttachmentRepository, "findByMessageIdsWithExtractions").mockResolvedValue(extractionsMap)

      await service.attemptAutoNaming("stream_123", false)

      // Should have used formatMessagesWithAttachments
      expect(mockFormatMessagesWithAttachments).toHaveBeenCalled()
    })

    test("should use formatMessagesWithAttachments for conversation text", async () => {
      mockStreamList.mockResolvedValue([])
      mockGenerateText.mockResolvedValue({ value: "Image Discussion", response: {} })

      // No attachments (default from beforeEach)
      await service.attemptAutoNaming("stream_123", false)

      // Should always use formatMessagesWithAttachments
      expect(mockFormatMessagesWithAttachments).toHaveBeenCalled()
      // Should not use the old formatMessages
      expect(mockFormatMessages).not.toHaveBeenCalled()
    })
  })
})
