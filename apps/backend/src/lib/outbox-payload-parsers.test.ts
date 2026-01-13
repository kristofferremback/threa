import { describe, test, expect, mock } from "bun:test"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { AuthorTypes } from "@threa/types"

// Mock the database dependencies
mock.module("../db", () => ({
  withClient: (_pool: unknown, fn: (client: unknown) => Promise<unknown>) => fn({}),
}))

const mockPool = {} as any

describe("parseMessageCreatedPayload", () => {
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
