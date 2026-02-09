import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { withTransaction } from "./setup"
import { EventService } from "../../src/services/event-service"
import { StreamEventRepository } from "../../src/repositories/stream-event-repository"
import { MessageRepository } from "../../src/repositories/message-repository"
import { OutboxRepository } from "../../src/lib/outbox"
import { streamId, userId, workspaceId } from "../../src/lib/id"
import { setupTestDatabase, testMessageContent } from "./setup"

describe("Event Sourcing", () => {
  let pool: Pool
  let eventService: EventService

  beforeAll(async () => {
    pool = await setupTestDatabase()
    eventService = new EventService(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    // Clean up test data between tests
    await pool.query("DELETE FROM reactions")
    await pool.query("DELETE FROM messages")
    await pool.query("DELETE FROM stream_events")
    await pool.query("DELETE FROM stream_sequences")
    // Reset outbox but keep listener cursors
    await pool.query(
      "DELETE FROM outbox WHERE id > (SELECT COALESCE(MAX(last_processed_id), 0) FROM outbox_listeners WHERE listener_id = 'broadcast')"
    )
  })

  describe("Message Creation", () => {
    test("should create event, projection, and outbox entry atomically", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Hello, world!"),
      })

      // Verify message projection was created
      expect(message.id).toMatch(/^msg_/)
      expect(message.streamId).toBe(testStreamId)
      expect(message.authorId).toBe(testUserId)
      expect(message.contentMarkdown).toBe("Hello, world!")
      expect(message.sequence).toBe(1n)

      // Verify event was created
      const events = await StreamEventRepository.list(pool, testStreamId)

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        streamId: testStreamId,
        sequence: 1n,
        eventType: "message_created",
        actorId: testUserId,
        actorType: "user",
      })
      expect(events[0].payload).toMatchObject({
        messageId: message.id,
        contentMarkdown: "Hello, world!",
      })
    })

    test("should assign sequential sequence numbers", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const msg1 = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("First"),
      })

      const msg2 = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Second"),
      })

      const msg3 = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Third"),
      })

      expect(msg1.sequence).toBe(1n)
      expect(msg2.sequence).toBe(2n)
      expect(msg3.sequence).toBe(3n)

      // Verify events have matching sequences
      const events = await StreamEventRepository.list(pool, testStreamId)
      expect(events.map((e) => e.sequence)).toEqual([1n, 2n, 3n])
    })

    test("should isolate sequences per stream", async () => {
      const stream1 = streamId()
      const stream2 = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      // Create messages in interleaved order
      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: stream1,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Stream 1 - First"),
      })

      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: stream2,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Stream 2 - First"),
      })

      const msg1_2 = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: stream1,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Stream 1 - Second"),
      })

      const msg2_2 = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: stream2,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Stream 2 - Second"),
      })

      // Each stream should have its own sequence
      expect(msg1_2.sequence).toBe(2n)
      expect(msg2_2.sequence).toBe(2n)
    })

    test("should support persona authors", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const personaId = "persona_ariadne"

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: personaId,
        authorType: "persona",
        ...testMessageContent("I am Ariadne"),
      })

      expect(message.authorId).toBe(personaId)
      expect(message.authorType).toBe("persona")

      const events = await StreamEventRepository.list(pool, testStreamId)
      expect(events[0].actorType).toBe("persona")
    })

    test("should publish to outbox for real-time delivery", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      // Get baseline outbox id
      const baselineResult = await pool.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
      const baselineId = BigInt(baselineResult.rows[0].max_id)

      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Test message"),
      })

      const outboxEvents = await OutboxRepository.fetchAfterId(pool, baselineId)

      // INV-23: Don't assert event count - verify specific events we care about
      const messageCreatedEvent = outboxEvents.find((e) => e.eventType === "message:created")
      expect(messageCreatedEvent).toBeDefined()
      expect(messageCreatedEvent!.payload).toMatchObject({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
      })

      const unreadIncrementEvent = outboxEvents.find((e) => e.eventType === "unread:increment")
      expect(unreadIncrementEvent).toBeDefined()
      expect(unreadIncrementEvent!.payload).toMatchObject({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
      })
    })
  })

  describe("Message Editing", () => {
    test("should create edit event and update projection", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const original = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Original content"),
      })

      const edited = await eventService.editMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: original.id,
        ...testMessageContent("Edited content"),
        actorId: testUserId,
      })

      // Projection should be updated
      expect(edited).not.toBeNull()
      expect(edited!.contentMarkdown).toBe("Edited content")
      expect(edited!.editedAt).not.toBeNull()

      // Both events should exist
      const events = await StreamEventRepository.list(pool, testStreamId)

      expect(events).toHaveLength(2)
      expect(events[0].eventType).toBe("message_created")
      expect(events[1].eventType).toBe("message_edited")
      expect(events[1].payload).toMatchObject({
        messageId: original.id,
        contentMarkdown: "Edited content",
      })
    })

    test("should preserve sequence on edit", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const original = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Original"),
      })

      const edited = await eventService.editMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: original.id,
        ...testMessageContent("Edited"),
        actorId: testUserId,
      })

      // Message sequence should not change on edit
      expect(edited!.sequence).toBe(original.sequence)
    })

    test("should publish edit event to outbox", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const original = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Original"),
      })

      // Get baseline after message creation
      const baselineResult = await pool.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
      const baselineId = BigInt(baselineResult.rows[0].max_id)

      await eventService.editMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: original.id,
        ...testMessageContent("Edited"),
        actorId: testUserId,
      })

      const outboxEvents = await OutboxRepository.fetchAfterId(pool, baselineId)

      expect(outboxEvents).toHaveLength(1)
      expect(outboxEvents[0].eventType).toBe("message:edited")
    })
  })

  describe("Message Deletion", () => {
    test("should create delete event and soft-delete projection", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("To be deleted"),
      })

      const deleted = await eventService.deleteMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        actorId: testUserId,
      })

      // Soft delete - record still exists but has deletedAt
      expect(deleted).not.toBeNull()
      expect(deleted!.deletedAt).not.toBeNull()

      // Delete event should exist
      const events = await StreamEventRepository.list(pool, testStreamId)

      expect(events).toHaveLength(2)
      expect(events[1].eventType).toBe("message_deleted")
      expect(events[1].payload).toMatchObject({
        messageId: message.id,
      })
    })

    test("should exclude deleted messages from list queries", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const msg1 = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Keep me"),
      })

      const msg2 = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Delete me"),
      })

      await eventService.deleteMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: msg2.id,
        actorId: testUserId,
      })

      const messages = await eventService.getMessages(testStreamId)

      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(msg1.id)
    })

    test("should publish delete event to outbox", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("To delete"),
      })

      const baselineResult = await pool.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
      const baselineId = BigInt(baselineResult.rows[0].max_id)

      await eventService.deleteMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        actorId: testUserId,
      })

      const outboxEvents = await OutboxRepository.fetchAfterId(pool, baselineId)

      expect(outboxEvents).toHaveLength(1)
      expect(outboxEvents[0].eventType).toBe("message:deleted")
      expect(outboxEvents[0].payload).toMatchObject({
        messageId: message.id,
      })
    })
  })

  describe("Reactions", () => {
    test("should add reaction event and update projection", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("React to me"),
      })

      const updated = await eventService.addReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "👍",
        userId: testUserId,
      })

      expect(updated).not.toBeNull()
      expect(updated!.reactions).toEqual({
        "👍": [testUserId],
      })

      // Reaction event should exist
      const events = await StreamEventRepository.list(pool, testStreamId)
      const reactionEvent = events.find((e) => e.eventType === "reaction_added")

      expect(reactionEvent).toBeDefined()
      expect(reactionEvent!.payload).toMatchObject({
        messageId: message.id,
        emoji: "👍",
        userId: testUserId,
      })
    })

    test("should aggregate multiple reactions correctly", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const user1 = userId()
      const user2 = userId()

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: user1,
        authorType: "user",
        ...testMessageContent("Popular message"),
      })

      await eventService.addReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "👍",
        userId: user1,
      })

      await eventService.addReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "👍",
        userId: user2,
      })

      await eventService.addReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "❤️",
        userId: user1,
      })

      const updated = await eventService.getMessageById(message.id)

      expect(updated!.reactions["👍"]).toHaveLength(2)
      expect(updated!.reactions["👍"]).toContain(user1)
      expect(updated!.reactions["👍"]).toContain(user2)
      expect(updated!.reactions["❤️"]).toEqual([user1])
    })

    test("should remove reaction event and update projection", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("React then unreact"),
      })

      await eventService.addReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "👍",
        userId: testUserId,
      })

      const afterRemove = await eventService.removeReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "👍",
        userId: testUserId,
      })

      // Reaction should be gone from projection
      expect(afterRemove!.reactions["👍"]).toBeUndefined()

      // Both events should exist (add and remove)
      const events = await StreamEventRepository.list(pool, testStreamId)
      const eventTypes = events.map((e) => e.eventType)

      expect(eventTypes).toContain("reaction_added")
      expect(eventTypes).toContain("reaction_removed")
    })

    test("should handle duplicate reaction gracefully", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Double react"),
      })

      await eventService.addReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "👍",
        userId: testUserId,
      })

      // Add same reaction again - should not duplicate in projection
      await eventService.addReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "👍",
        userId: testUserId,
      })

      const final = await eventService.getMessageById(message.id)

      // Only one entry for this user
      expect(final!.reactions["👍"]).toEqual([testUserId])
    })

    test("should publish reaction events to outbox", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Outbox test"),
      })

      const baselineResult = await pool.query("SELECT COALESCE(MAX(id), 0) as max_id FROM outbox")
      const baselineId = BigInt(baselineResult.rows[0].max_id)

      await eventService.addReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "👍",
        userId: testUserId,
      })

      await eventService.removeReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "👍",
        userId: testUserId,
      })

      const outboxEvents = await OutboxRepository.fetchAfterId(pool, baselineId)

      expect(outboxEvents).toHaveLength(2)
      expect(outboxEvents[0].eventType).toBe("reaction:added")
      expect(outboxEvents[1].eventType).toBe("reaction:removed")
    })
  })

  describe("Event Listing", () => {
    test("should list events in sequence order", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("First"),
      })

      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Second"),
      })

      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Third"),
      })

      const events = await eventService.listEvents(testStreamId)

      expect(events).toHaveLength(3)
      expect(events[0].sequence).toBe(1n)
      expect(events[1].sequence).toBe(2n)
      expect(events[2].sequence).toBe(3n)
    })

    test("should filter events by type", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Test"),
      })

      await eventService.addReaction({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        emoji: "👍",
        userId: testUserId,
      })

      await eventService.editMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        messageId: message.id,
        ...testMessageContent("Edited"),
        actorId: testUserId,
      })

      // Filter to only message events
      const messageEvents = await eventService.listEvents(testStreamId, {
        types: ["message_created", "message_edited"],
      })

      expect(messageEvents).toHaveLength(2)
      expect(messageEvents.every((e) => e.eventType.startsWith("message_"))).toBe(true)
    })

    test("should paginate events with afterSequence", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      for (let i = 0; i < 5; i++) {
        await eventService.createMessage({
          workspaceId: testWorkspaceId,
          streamId: testStreamId,
          authorId: testUserId,
          authorType: "user",
          ...testMessageContent(`Message ${i + 1}`),
        })
      }

      // Get events after sequence 2
      const events = await eventService.listEvents(testStreamId, {
        afterSequence: 2n,
      })

      expect(events).toHaveLength(3)
      expect(events[0].sequence).toBe(3n)
      expect(events[1].sequence).toBe(4n)
      expect(events[2].sequence).toBe(5n)
    })

    test("should respect limit parameter", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      for (let i = 0; i < 10; i++) {
        await eventService.createMessage({
          workspaceId: testWorkspaceId,
          streamId: testStreamId,
          authorId: testUserId,
          authorType: "user",
          ...testMessageContent(`Message ${i + 1}`),
        })
      }

      const events = await eventService.listEvents(testStreamId, { limit: 3 })

      expect(events).toHaveLength(3)
    })
  })

  describe("Transaction Atomicity", () => {
    test("should rollback all changes on failure", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      // Get baseline counts
      const beforeEvents = await pool.query("SELECT COUNT(*) as count FROM stream_events")
      const beforeMessages = await pool.query("SELECT COUNT(*) as count FROM messages")
      const beforeOutbox = await pool.query("SELECT COUNT(*) as count FROM outbox")

      // Try to create a message with an invalid stream_id that would cause FK failure
      // Since we don't have FK constraints, we'll simulate by using a custom transaction
      try {
        await withTestTransaction(pool, async (client) => {
          // Insert event
          await StreamEventRepository.insert(client, {
            id: "evt_test",
            streamId: testStreamId,
            eventType: "message_created",
            payload: { messageId: "msg_test", content: "Test", contentFormat: "markdown" },
            actorId: testUserId,
            actorType: "user",
          })

          // Insert message
          await MessageRepository.insert(client, {
            id: "msg_test",
            streamId: testStreamId,
            sequence: 1n,
            authorId: testUserId,
            authorType: "user",
            ...testMessageContent("Test"),
          })

          // Simulate failure before outbox insert
          throw new Error("Simulated failure")
        })
      } catch {
        // Expected to fail
      }

      // Verify nothing was persisted
      const afterEvents = await pool.query("SELECT COUNT(*) as count FROM stream_events")
      const afterMessages = await pool.query("SELECT COUNT(*) as count FROM messages")
      const afterOutbox = await pool.query("SELECT COUNT(*) as count FROM outbox")

      expect(afterEvents.rows[0].count).toBe(beforeEvents.rows[0].count)
      expect(afterMessages.rows[0].count).toBe(beforeMessages.rows[0].count)
      expect(afterOutbox.rows[0].count).toBe(beforeOutbox.rows[0].count)
    })
  })
})
