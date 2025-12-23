/**
 * LLM Boundary Extractor Unit Tests
 *
 * Tests verify:
 * 1. Thread messages get 100% confidence and assigned to existing conversation
 * 2. Valid JSON parsing extracts correct fields
 * 3. Invalid JSON falls back to safe defaults
 * 4. Invalid conversation IDs are treated as new conversations
 * 5. Topic extraction from message content
 */

import { describe, test, expect, mock, beforeEach } from "bun:test"
import { LLMBoundaryExtractor } from "./llm-extractor"
import type { ExtractionContext, ConversationSummary } from "./types"
import type { Message } from "../../repositories/message-repository"

// Mock the ai module's generateText function
const mockGenerateText = mock(async () => ({ text: "{}" }))
mock.module("ai", () => ({
  generateText: mockGenerateText,
}))

// Mock provider registry
const mockProviderRegistry = {
  getModel: mock(() => ({})),
} as any

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg_test123",
    streamId: "stream_test",
    sequence: BigInt(1),
    authorId: "usr_test",
    authorType: "user",
    content: "Test message content",
    contentFormat: "markdown",
    replyCount: 0,
    reactions: {},
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    ...overrides,
  }
}

function createMockConversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "conv_existing123",
    topicSummary: "Existing conversation topic",
    messageCount: 5,
    lastMessagePreview: "Last message preview",
    participantIds: ["usr_test"],
    completenessScore: 3,
    ...overrides,
  }
}

function createMockContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    newMessage: createMockMessage(),
    recentMessages: [createMockMessage()],
    activeConversations: [],
    streamType: "scratchpad",
    isThread: false,
    ...overrides,
  }
}

describe("LLMBoundaryExtractor", () => {
  let extractor: LLMBoundaryExtractor

  beforeEach(() => {
    mockGenerateText.mockReset()
    extractor = new LLMBoundaryExtractor(mockProviderRegistry, "openrouter:anthropic/claude-3-haiku")
  })

  describe("thread handling", () => {
    test("returns 100% confidence for thread messages", async () => {
      const context = createMockContext({
        isThread: true,
        activeConversations: [createMockConversation({ id: "conv_thread123" })],
      })

      const result = await extractor.extract(context)

      expect(result.confidence).toBe(1.0)
      expect(result.conversationId).toBe("conv_thread123")
    })

    test("returns existing conversation ID for thread with active conversation", async () => {
      const existingConv = createMockConversation({ id: "conv_existing456" })
      const context = createMockContext({
        isThread: true,
        activeConversations: [existingConv],
      })

      const result = await extractor.extract(context)

      expect(result.conversationId).toBe("conv_existing456")
      expect(result.newConversationTopic).toBeUndefined()
    })

    test("creates new conversation for thread without existing conversation", async () => {
      const context = createMockContext({
        isThread: true,
        activeConversations: [],
        newMessage: createMockMessage({ content: "Starting a thread discussion" }),
      })

      const result = await extractor.extract(context)

      expect(result.conversationId).toBeNull()
      expect(result.newConversationTopic).toBe("Starting a thread discussion")
      expect(result.confidence).toBe(1.0)
    })

    test("does not call LLM for thread messages", async () => {
      const context = createMockContext({
        isThread: true,
        activeConversations: [createMockConversation()],
      })

      await extractor.extract(context)

      expect(mockGenerateText).not.toHaveBeenCalled()
    })
  })

  describe("LLM response parsing", () => {
    test("parses valid JSON response with existing conversation", async () => {
      const existingConv = createMockConversation({ id: "conv_match123" })
      const context = createMockContext({
        activeConversations: [existingConv],
      })

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          conversationId: "conv_match123",
          confidence: 0.92,
          reasoning: "Topic matches existing conversation",
        }),
      })

      const result = await extractor.extract(context)

      expect(result.conversationId).toBe("conv_match123")
      expect(result.confidence).toBe(0.92)
    })

    test("parses valid JSON response for new conversation", async () => {
      const context = createMockContext()

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          conversationId: null,
          newConversationTopic: "New topic from LLM",
          confidence: 0.88,
        }),
      })

      const result = await extractor.extract(context)

      expect(result.conversationId).toBeNull()
      expect(result.newConversationTopic).toBe("New topic from LLM")
      expect(result.confidence).toBe(0.88)
    })

    test("extracts JSON from markdown code blocks", async () => {
      const context = createMockContext()

      mockGenerateText.mockResolvedValueOnce({
        text: 'Here is the result:\n```json\n{"conversationId": null, "confidence": 0.75}\n```',
      })

      const result = await extractor.extract(context)

      expect(result.conversationId).toBeNull()
      expect(result.confidence).toBe(0.75)
    })

    test("parses completeness updates", async () => {
      const existingConv = createMockConversation({ id: "conv_update123" })
      const context = createMockContext({
        activeConversations: [existingConv],
      })

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          conversationId: "conv_update123",
          confidence: 0.95,
          completenessUpdates: [{ conversationId: "conv_update123", score: 6, status: "resolved" }],
        }),
      })

      const result = await extractor.extract(context)

      expect(result.completenessUpdates).toBeDefined()
      expect(result.completenessUpdates?.length).toBe(1)
      expect(result.completenessUpdates?.[0].score).toBe(6)
      expect(result.completenessUpdates?.[0].status).toBe("resolved")
    })
  })

  describe("fallback behavior", () => {
    test("falls back to safe defaults on invalid JSON", async () => {
      const context = createMockContext({
        newMessage: createMockMessage({ content: "Fallback topic here" }),
      })

      mockGenerateText.mockResolvedValueOnce({
        text: "This is not valid JSON at all",
      })

      const result = await extractor.extract(context)

      expect(result.conversationId).toBeNull()
      expect(result.newConversationTopic).toBe("Fallback topic here")
      expect(result.confidence).toBe(0.3)
    })

    test("falls back on LLM error", async () => {
      const context = createMockContext({
        newMessage: createMockMessage({ content: "Error fallback topic" }),
      })

      mockGenerateText.mockRejectedValueOnce(new Error("API error"))

      const result = await extractor.extract(context)

      expect(result.conversationId).toBeNull()
      expect(result.newConversationTopic).toBe("Error fallback topic")
      expect(result.confidence).toBe(0.3)
    })

    test("treats invalid conversation ID as new conversation", async () => {
      const existingConv = createMockConversation({ id: "conv_real123" })
      const context = createMockContext({
        activeConversations: [existingConv],
        newMessage: createMockMessage({ content: "New topic content" }),
      })

      // LLM returns an ID that doesn't exist in active conversations
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          conversationId: "conv_hallucinated_id",
          confidence: 0.8,
        }),
      })

      const result = await extractor.extract(context)

      // Should be treated as new conversation since ID doesn't exist
      expect(result.conversationId).toBeNull()
      expect(result.newConversationTopic).toBe("New topic content")
    })

    test("uses default confidence when not provided", async () => {
      const context = createMockContext()

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          conversationId: null,
        }),
      })

      const result = await extractor.extract(context)

      expect(result.confidence).toBe(0.5)
    })
  })

  describe("topic extraction", () => {
    test("extracts first sentence as topic", async () => {
      const context = createMockContext({
        isThread: true,
        activeConversations: [],
        newMessage: createMockMessage({
          content: "This is the first sentence. This is the second sentence.",
        }),
      })

      const result = await extractor.extract(context)

      expect(result.newConversationTopic).toBe("This is the first sentence")
    })

    test("handles messages ending with question mark", async () => {
      const context = createMockContext({
        isThread: true,
        activeConversations: [],
        newMessage: createMockMessage({
          content: "How do we handle this? I'm not sure about it.",
        }),
      })

      const result = await extractor.extract(context)

      expect(result.newConversationTopic).toBe("How do we handle this")
    })

    test("handles messages ending with exclamation", async () => {
      const context = createMockContext({
        isThread: true,
        activeConversations: [],
        newMessage: createMockMessage({
          content: "This is exciting news! Can't wait to share more.",
        }),
      })

      const result = await extractor.extract(context)

      expect(result.newConversationTopic).toBe("This is exciting news")
    })

    test("handles newline-separated content", async () => {
      const context = createMockContext({
        isThread: true,
        activeConversations: [],
        newMessage: createMockMessage({
          content: "First line here\nSecond line here\nThird line",
        }),
      })

      const result = await extractor.extract(context)

      expect(result.newConversationTopic).toBe("First line here")
    })

    test("truncates very long topics to 100 characters", async () => {
      const longContent = "A".repeat(200)
      const context = createMockContext({
        isThread: true,
        activeConversations: [],
        newMessage: createMockMessage({ content: longContent }),
      })

      const result = await extractor.extract(context)

      expect(result.newConversationTopic?.length).toBe(100)
    })
  })
})
