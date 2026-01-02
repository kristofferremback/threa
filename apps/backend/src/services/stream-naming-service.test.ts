import { describe, test, expect, mock, beforeEach, spyOn } from "bun:test"
import { StreamNamingService } from "./stream-naming-service"
import { MessageFormatter } from "../lib/ai/message-formatter"
import * as ai from "ai"

// Mock message formatter
const mockFormatMessages = mock(() => Promise.resolve("<messages></messages>"))
const mockMessageFormatter = {
  formatMessages: mockFormatMessages,
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

const mockFindByIdForUpdate = mock(() => Promise.resolve(mockStream))
const mockMessageList = mock(() => Promise.resolve(mockMessages))
const mockStreamList = mock(() => Promise.resolve([]))
const mockStreamUpdate = mock(() => Promise.resolve())
const mockOutboxInsert = mock(() => Promise.resolve())

mock.module("../repositories/stream-repository", () => ({
  StreamRepository: {
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

mock.module("../repositories/outbox-repository", () => ({
  OutboxRepository: {
    insert: mockOutboxInsert,
  },
}))

mock.module("../db", () => ({
  withTransaction: (_pool: unknown, fn: (client: unknown) => Promise<unknown>) => fn({}),
}))

mock.module("../lib/display-name", () => ({
  needsAutoNaming: () => true,
}))

const mockGetModel = mock(() => ({}))
const mockProviderRegistry = {
  getModel: mockGetModel,
}

const mockPool = {} as any

describe("StreamNamingService", () => {
  let service: StreamNamingService
  let generateTextSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockFindByIdForUpdate.mockReset()
    mockMessageList.mockReset()
    mockStreamList.mockReset()
    mockStreamUpdate.mockReset()
    mockOutboxInsert.mockReset()
    mockGetModel.mockReset()
    mockFormatMessages.mockReset()

    mockFindByIdForUpdate.mockResolvedValue(mockStream)
    mockMessageList.mockResolvedValue(mockMessages)
    mockGetModel.mockReturnValue({})
    mockFormatMessages.mockResolvedValue("<messages></messages>")
    // Don't set default for mockStreamList - each test that needs it will set it

    service = new StreamNamingService(mockPool, mockProviderRegistry as any, "test-model", mockMessageFormatter)

    generateTextSpy = spyOn(ai, "generateText")
  })

  describe("attemptAutoNaming with requireName=false (user message)", () => {
    test("should return false when LLM returns NOT_ENOUGH_CONTEXT", async () => {
      mockStreamList.mockResolvedValue([])
      generateTextSpy.mockResolvedValue({ text: "NOT_ENOUGH_CONTEXT" } as any)

      const result = await service.attemptAutoNaming("stream_123", false)

      expect(result).toBe(false)
      expect(mockStreamUpdate).not.toHaveBeenCalled()
    })

    test("should generate name when LLM returns valid title", async () => {
      mockStreamList.mockResolvedValue([])
      generateTextSpy.mockResolvedValue({ text: "Help Request" } as any)

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
      generateTextSpy.mockResolvedValue({ text: "NOT_ENOUGH_CONTEXT" } as any)

      await expect(service.attemptAutoNaming("stream_123", true)).rejects.toThrow(
        "Failed to generate required name: NOT_ENOUGH_CONTEXT returned"
      )

      expect(mockStreamUpdate).not.toHaveBeenCalled()
    })

    test("should throw when LLM returns empty response", async () => {
      mockStreamList.mockResolvedValue([])
      generateTextSpy.mockResolvedValue({ text: "" } as any)

      await expect(service.attemptAutoNaming("stream_123", true)).rejects.toThrow(
        "Failed to generate required name: NOT_ENOUGH_CONTEXT returned"
      )
    })

    test("should generate name when LLM returns valid title", async () => {
      mockStreamList.mockResolvedValue([])
      generateTextSpy.mockResolvedValue({ text: "Quick Question" } as any)

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

      generateTextSpy.mockResolvedValue({ text: "New Topic" } as any)

      await service.attemptAutoNaming("stream_123", false)

      const calls = generateTextSpy.mock.calls
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

      generateTextSpy.mockResolvedValue({ text: "New Topic" } as any)

      await service.attemptAutoNaming("stream_123", false)

      const calls = generateTextSpy.mock.calls
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
      generateTextSpy.mockResolvedValue({ text: "Title" } as any)

      await service.attemptAutoNaming("stream_123", false)

      const calls = generateTextSpy.mock.calls
      const lastCall = calls[calls.length - 1]?.[0] as { messages: Array<{ role: string; content: string }> }
      const systemMessage = lastCall.messages.find((m) => m.role === "system")?.content ?? ""

      expect(systemMessage).toContain("NOT_ENOUGH_CONTEXT")
    })

    test("should require generating a name when requireName=true", async () => {
      mockStreamList.mockResolvedValue([])
      generateTextSpy.mockResolvedValue({ text: "Title" } as any)

      await service.attemptAutoNaming("stream_123", true)

      const calls = generateTextSpy.mock.calls
      const lastCall = calls[calls.length - 1]?.[0] as { messages: Array<{ role: string; content: string }> }
      const systemMessage = lastCall.messages.find((m) => m.role === "system")?.content ?? ""

      expect(systemMessage).toContain("You MUST generate a title")
    })
  })

  describe("edge cases", () => {
    test("should clean quotes from generated name", async () => {
      mockStreamList.mockResolvedValue([])
      generateTextSpy.mockResolvedValue({ text: '"Quoted Title"' } as any)

      await service.attemptAutoNaming("stream_123", false)

      expect(mockStreamUpdate).toHaveBeenCalledWith({}, "stream_123", {
        displayName: "Quoted Title",
        displayNameGeneratedAt: expect.any(Date),
      })
    })

    test("should reject names that are too long", async () => {
      mockStreamList.mockResolvedValue([])
      const longName = "A".repeat(150)
      generateTextSpy.mockResolvedValue({ text: longName } as any)

      const result = await service.attemptAutoNaming("stream_123", false)

      expect(result).toBe(false)
      expect(mockStreamUpdate).not.toHaveBeenCalled()
    })

    test("should throw for too-long names when requireName=true", async () => {
      mockStreamList.mockResolvedValue([])
      const longName = "A".repeat(150)
      generateTextSpy.mockResolvedValue({ text: longName } as any)

      await expect(service.attemptAutoNaming("stream_123", true)).rejects.toThrow("invalid response")
    })
  })
})
