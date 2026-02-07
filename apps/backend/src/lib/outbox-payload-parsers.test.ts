import { describe, test, expect } from "bun:test"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { AuthorTypes } from "@threa/types"

describe("parseMessageCreatedPayload", () => {
  describe("modern format", () => {
    test("should parse valid modern payload", () => {
      const payload = {
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: {
          id: "event_789",
          sequence: "42",
          actorType: "member",
          actorId: "member_abc",
          payload: {
            messageId: "msg_def",
            contentMarkdown: "Hello world",
          },
        },
      }

      const result = parseMessageCreatedPayload(payload)

      expect(result).toEqual({
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: {
          id: "event_789",
          sequence: "42",
          actorType: "member",
          actorId: "member_abc",
          payload: {
            messageId: "msg_def",
            contentMarkdown: "Hello world",
          },
        },
      })
    })

    test("should parse persona message", () => {
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

      const result = parseMessageCreatedPayload(payload)

      expect(result?.event.actorType).toBe(AuthorTypes.PERSONA)
      expect(result?.event.actorId).toBe("persona_xyz")
    })

    test("should default missing optional fields", () => {
      const payload = {
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: {
          payload: {
            messageId: "msg_def",
          },
        },
      }

      const result = parseMessageCreatedPayload(payload)

      expect(result).toEqual({
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: {
          id: "",
          sequence: "0",
          actorType: "member",
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
    test("should return null for null payload", () => {
      const result = parseMessageCreatedPayload(null)
      expect(result).toBeNull()
    })

    test("should return null for non-object payload", () => {
      const result = parseMessageCreatedPayload("string")
      expect(result).toBeNull()
    })

    test("should return null when workspaceId missing", () => {
      const payload = {
        streamId: "stream_456",
        event: { payload: { messageId: "msg_123" } },
      }
      const result = parseMessageCreatedPayload(payload)
      expect(result).toBeNull()
    })

    test("should return null when streamId missing", () => {
      const payload = {
        workspaceId: "ws_123",
        event: { payload: { messageId: "msg_123" } },
      }
      const result = parseMessageCreatedPayload(payload)
      expect(result).toBeNull()
    })

    test("should return null when messageId missing from both formats", () => {
      const payload = {
        workspaceId: "ws_123",
        streamId: "stream_456",
        event: { payload: {} },
      }
      const result = parseMessageCreatedPayload(payload)
      expect(result).toBeNull()
    })
  })
})
