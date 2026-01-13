import { describe, test, expect, mock, beforeEach } from "bun:test"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { AuthorTypes } from "@threa/types"

// Mock the database dependencies
const mockFindById = mock(() =>
  Promise.resolve(
    null as {
      id: string
      authorType: string
      authorId: string
      sequence: bigint
      contentMarkdown: string
    } | null
  )
)

mock.module("../repositories", () => ({
  MessageRepository: {
    findById: mockFindById,
  },
}))

mock.module("../db", () => ({
  withClient: (_pool: unknown, fn: (client: unknown) => Promise<unknown>) => fn({}),
}))

const mockPool = {} as any

describe("parseMessageCreatedPayload", () => {
  beforeEach(() => {
    mockFindById.mockReset()
    mockFindById.mockResolvedValue(null)
  })

  describe("modern format", () => {
    test("should parse valid modern payload", async () => {
      const payload = {
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: {
          id: "event_789",
          sequence: "42",
          actorType: "user",
          actorId: "user_abc",
          payload: {
            messageId: "msg_def",
            contentMarkdown: "Hello world",
          },
        },
      }

      const result = await parseMessageCreatedPayload(payload, mockPool)

      expect(result).toEqual({
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: {
          id: "event_789",
          sequence: "42",
          actorType: "user",
          actorId: "user_abc",
          payload: {
            messageId: "msg_def",
            contentMarkdown: "Hello world",
          },
        },
      })
    })

    test("should parse persona message", async () => {
      const payload = {
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: {
          id: "event_789",
          sequence: "10",
          actorType: "persona",
          actorId: "persona_xyz",
          payload: {
            messageId: "msg_def",
            contentMarkdown: "AI response",
          },
        },
      }

      const result = await parseMessageCreatedPayload(payload, mockPool)

      expect(result?.event.actorType).toBe(AuthorTypes.PERSONA)
      expect(result?.event.actorId).toBe("persona_xyz")
    })

    test("should default missing optional fields", async () => {
      const payload = {
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: {
          payload: {
            messageId: "msg_def",
          },
        },
      }

      const result = await parseMessageCreatedPayload(payload, mockPool)

      expect(result).toEqual({
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: {
          id: "",
          sequence: "0",
          actorType: "user",
          actorId: null,
          payload: {
            messageId: "msg_def",
            contentMarkdown: "",
          },
        },
      })
    })
  })

  describe("legacy format", () => {
    test("should normalize legacy payload with messageId at top level", async () => {
      const payload = {
        workspaceId: "ws_123",
        streamId: "stream_456",
        messageId: "msg_legacy",
      }

      const result = await parseMessageCreatedPayload(payload, mockPool)

      expect(result).toEqual({
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: {
          id: "",
          sequence: "0",
          actorType: "user",
          actorId: null,
          payload: {
            messageId: "msg_legacy",
            contentMarkdown: "",
          },
        },
      })
    })

    test("should look up message to get actual authorType", async () => {
      mockFindById.mockResolvedValue({
        id: "msg_legacy",
        authorType: "persona",
        authorId: "persona_abc",
        sequence: BigInt(99),
        contentMarkdown: "Looked up content",
      })

      const payload = {
        workspaceId: "ws_123",
        streamId: "stream_456",
        messageId: "msg_legacy",
      }

      const result = await parseMessageCreatedPayload(payload, mockPool)

      expect(result?.event.actorType).toBe("persona")
      expect(result?.event.actorId).toBe("persona_abc")
      expect(result?.event.sequence).toBe("99")
      expect(result?.event.payload.contentMarkdown).toBe("Looked up content")
    })

    test("should use payload content as fallback when message not found", async () => {
      mockFindById.mockResolvedValue(null)

      const payload = {
        workspaceId: "ws_123",
        streamId: "stream_456",
        messageId: "msg_legacy",
        contentMarkdown: "Fallback content",
      }

      const result = await parseMessageCreatedPayload(payload, mockPool)

      expect(result?.event.actorType).toBe("user")
      expect(result?.event.payload.contentMarkdown).toBe("Fallback content")
    })
  })

  describe("invalid payloads", () => {
    test("should return null for null payload", async () => {
      const result = await parseMessageCreatedPayload(null, mockPool)
      expect(result).toBeNull()
    })

    test("should return null for non-object payload", async () => {
      const result = await parseMessageCreatedPayload("string", mockPool)
      expect(result).toBeNull()
    })

    test("should return null when workspaceId missing", async () => {
      const payload = {
        streamId: "stream_456",
        event: { payload: { messageId: "msg_123" } },
      }
      const result = await parseMessageCreatedPayload(payload, mockPool)
      expect(result).toBeNull()
    })

    test("should return null when streamId missing", async () => {
      const payload = {
        workspaceId: "ws_123",
        event: { payload: { messageId: "msg_123" } },
      }
      const result = await parseMessageCreatedPayload(payload, mockPool)
      expect(result).toBeNull()
    })

    test("should return null when messageId missing from both formats", async () => {
      const payload = {
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: { payload: {} },
      }
      const result = await parseMessageCreatedPayload(payload, mockPool)
      expect(result).toBeNull()
    })
  })
})
