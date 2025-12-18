/**
 * ID Generation Unit Tests
 *
 * Tests verify:
 * 1. IDs have correct prefix format
 * 2. IDs are unique
 * 3. IDs contain valid ULID characters
 */

import { describe, test, expect } from "bun:test"
import {
  userId,
  workspaceId,
  streamId,
  eventId,
  messageId,
  attachmentId,
  personaId,
  notificationId,
  invitationId,
  sessionId,
  stepId,
} from "./id"

describe("ID Generation", () => {
  describe("format", () => {
    const testCases = [
      { name: "userId", fn: userId, prefix: "usr" },
      { name: "workspaceId", fn: workspaceId, prefix: "ws" },
      { name: "streamId", fn: streamId, prefix: "stream" },
      { name: "eventId", fn: eventId, prefix: "event" },
      { name: "messageId", fn: messageId, prefix: "msg" },
      { name: "attachmentId", fn: attachmentId, prefix: "attach" },
      { name: "personaId", fn: personaId, prefix: "persona" },
      { name: "notificationId", fn: notificationId, prefix: "notif" },
      { name: "invitationId", fn: invitationId, prefix: "inv" },
      { name: "sessionId", fn: sessionId, prefix: "session" },
      { name: "stepId", fn: stepId, prefix: "step" },
    ]

    for (const { name, fn, prefix } of testCases) {
      test(`${name} has correct prefix '${prefix}_'`, () => {
        const id = fn()
        expect(id.startsWith(`${prefix}_`)).toBe(true)
      })

      test(`${name} has valid ULID format after prefix`, () => {
        const id = fn()
        const parts = id.split("_")
        expect(parts.length).toBe(2)

        const ulid = parts[1]
        // ULID is 26 characters using Crockford's base32
        expect(ulid.length).toBe(26)
        // Valid Crockford base32 characters (uppercase, no I, L, O, U)
        expect(ulid).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/)
      })
    }
  })

  describe("uniqueness", () => {
    test("generates unique user IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => userId()))
      expect(ids.size).toBe(100)
    })

    test("generates unique workspace IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => workspaceId()))
      expect(ids.size).toBe(100)
    })

    test("generates unique stream IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => streamId()))
      expect(ids.size).toBe(100)
    })

    test("generates unique event IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => eventId()))
      expect(ids.size).toBe(100)
    })

    test("generates unique message IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => messageId()))
      expect(ids.size).toBe(100)
    })
  })

  describe("sortability", () => {
    test("IDs generated later sort after earlier IDs", async () => {
      const id1 = streamId()
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 2))
      const id2 = streamId()

      // ULIDs are lexicographically sortable by time
      expect(id1 < id2).toBe(true)
    })
  })
})
