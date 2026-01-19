import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { withClient, withTransaction } from "./setup"
import { StreamService } from "../../src/services/stream-service"
import { EventService } from "../../src/services/event-service"
import { StreamEventRepository } from "../../src/repositories/stream-event-repository"
import { StreamMemberRepository } from "../../src/repositories/stream-member-repository"
import { streamId, userId, workspaceId } from "../../src/lib/id"
import { setupTestDatabase, testMessageContent } from "./setup"

describe("Unread Counts", () => {
  let pool: Pool
  let streamService: StreamService
  let eventService: EventService

  beforeAll(async () => {
    pool = await setupTestDatabase()
    streamService = new StreamService(pool)
    eventService = new EventService(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM reactions")
    await pool.query("DELETE FROM messages")
    await pool.query("DELETE FROM stream_events")
    await pool.query("DELETE FROM stream_sequences")
    await pool.query("DELETE FROM stream_members")
    await pool.query("DELETE FROM streams")
    await pool.query(
      "DELETE FROM outbox WHERE id > (SELECT COALESCE(MAX(last_processed_id), 0) FROM outbox_listeners WHERE listener_id = 'broadcast')"
    )
  })

  describe("countUnreadByStreamBatch", () => {
    test("should return 0 unread when lastReadEventId matches latest event", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      // Create a stream and add a message
      await withTestTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [testStreamId, testWorkspaceId, testUserId]
        )
        await StreamMemberRepository.insert(client, testStreamId, testUserId)
      })

      const message = await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Hello"),
      })

      // Get the event ID for this message
      const events = await withClient(pool, (client) => StreamEventRepository.list(client, testStreamId))
      const lastEventId = events[0].id

      // Count unreads with lastReadEventId = latest event
      const counts = await streamService.getUnreadCounts([{ streamId: testStreamId, lastReadEventId: lastEventId }])

      expect(counts.get(testStreamId)).toBe(0)
    })

    test("should return correct unread count when messages exist after lastReadEventId", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      await withTestTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [testStreamId, testWorkspaceId, testUserId]
        )
        await StreamMemberRepository.insert(client, testStreamId, testUserId)
      })

      // Create 3 messages
      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Message 1"),
      })

      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Message 2"),
      })

      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Message 3"),
      })

      // Get the first event as last read
      const events = await withClient(pool, (client) => StreamEventRepository.list(client, testStreamId))
      const firstEventId = events[0].id

      // Should have 2 unread (messages 2 and 3)
      const counts = await streamService.getUnreadCounts([{ streamId: testStreamId, lastReadEventId: firstEventId }])

      expect(counts.get(testStreamId)).toBe(2)
    })

    test("should return all messages as unread when lastReadEventId is null", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      await withTestTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [testStreamId, testWorkspaceId, testUserId]
        )
        await StreamMemberRepository.insert(client, testStreamId, testUserId)
      })

      // Create 3 messages
      for (let i = 1; i <= 3; i++) {
        await eventService.createMessage({
          workspaceId: testWorkspaceId,
          streamId: testStreamId,
          authorId: testUserId,
          authorType: "user",
          ...testMessageContent(`Message ${i}`),
        })
      }

      // Count with null lastReadEventId (never read)
      const counts = await streamService.getUnreadCounts([{ streamId: testStreamId, lastReadEventId: null }])

      expect(counts.get(testStreamId)).toBe(3)
    })

    test("should not count user's own message as unread", async () => {
      const testStreamId = streamId()
      const testWorkspaceId = workspaceId()
      const authorId = userId()
      const otherUserId = userId()

      // Create a stream with two members
      await withTestTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'channel', 'private', $3)`,
          [testStreamId, testWorkspaceId, authorId]
        )
        await StreamMemberRepository.insert(client, testStreamId, authorId)
        await StreamMemberRepository.insert(client, testStreamId, otherUserId)
      })

      // Author sends a message
      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: testStreamId,
        authorId: authorId,
        authorType: "user",
        ...testMessageContent("Hello from author"),
      })

      // Author's lastReadEventId should have been updated to include their own message
      const authorMembership = await streamService.getMembership(testStreamId, authorId)
      expect(authorMembership?.lastReadEventId).not.toBeNull()

      // Author should have 0 unread
      const authorCounts = await streamService.getUnreadCounts([
        { streamId: testStreamId, lastReadEventId: authorMembership!.lastReadEventId },
      ])
      expect(authorCounts.get(testStreamId)).toBe(0)

      // Other user should have 1 unread (their lastReadEventId is still null)
      const otherMembership = await streamService.getMembership(testStreamId, otherUserId)
      expect(otherMembership?.lastReadEventId).toBeNull()

      const otherCounts = await streamService.getUnreadCounts([
        { streamId: testStreamId, lastReadEventId: otherMembership!.lastReadEventId },
      ])
      expect(otherCounts.get(testStreamId)).toBe(1)
    })

    test("should handle multiple streams in batch", async () => {
      const stream1 = streamId()
      const stream2 = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      await withTestTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [stream1, testWorkspaceId, testUserId]
        )
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [stream2, testWorkspaceId, testUserId]
        )
        await StreamMemberRepository.insert(client, stream1, testUserId)
        await StreamMemberRepository.insert(client, stream2, testUserId)
      })

      // Stream 1: 2 messages
      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: stream1,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Stream 1 - Message 1"),
      })
      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: stream1,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Stream 1 - Message 2"),
      })

      // Stream 2: 3 messages
      for (let i = 1; i <= 3; i++) {
        await eventService.createMessage({
          workspaceId: testWorkspaceId,
          streamId: stream2,
          authorId: testUserId,
          authorType: "user",
          ...testMessageContent(`Stream 2 - Message ${i}`),
        })
      }

      // Get first event from stream1, read all of stream2
      const events1 = await withClient(pool, (client) => StreamEventRepository.list(client, stream1))
      const events2 = await withClient(pool, (client) => StreamEventRepository.list(client, stream2))

      const counts = await streamService.getUnreadCounts([
        { streamId: stream1, lastReadEventId: events1[0].id }, // Read 1, unread 1
        { streamId: stream2, lastReadEventId: events2[2].id }, // Read all 3, unread 0
      ])

      expect(counts.get(stream1)).toBe(1)
      expect(counts.get(stream2)).toBe(0)
    })
  })

  describe("markAllAsRead", () => {
    test("should update all stream memberships to latest event", async () => {
      const stream1 = streamId()
      const stream2 = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()
      const otherUserId = userId()

      await withTestTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [stream1, testWorkspaceId, testUserId]
        )
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [stream2, testWorkspaceId, testUserId]
        )
        await StreamMemberRepository.insert(client, stream1, testUserId)
        await StreamMemberRepository.insert(client, stream2, testUserId)
        await StreamMemberRepository.insert(client, stream1, otherUserId)
        await StreamMemberRepository.insert(client, stream2, otherUserId)
      })

      // Add messages from another user so testUserId has unread messages
      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: stream1,
        authorId: otherUserId,
        authorType: "user",
        ...testMessageContent("Stream 1 message"),
      })
      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: stream2,
        authorId: otherUserId,
        authorType: "user",
        ...testMessageContent("Stream 2 message"),
      })

      // Mark all as read
      const updatedStreamIds = await streamService.markAllAsRead(testWorkspaceId, testUserId)

      expect(updatedStreamIds).toHaveLength(2)
      expect(updatedStreamIds).toContain(stream1)
      expect(updatedStreamIds).toContain(stream2)

      // Verify memberships are updated
      const membership1 = await streamService.getMembership(stream1, testUserId)
      const membership2 = await streamService.getMembership(stream2, testUserId)

      expect(membership1?.lastReadEventId).not.toBeNull()
      expect(membership2?.lastReadEventId).not.toBeNull()

      // Verify unread counts are now 0
      const counts = await streamService.getUnreadCounts([
        { streamId: stream1, lastReadEventId: membership1!.lastReadEventId },
        { streamId: stream2, lastReadEventId: membership2!.lastReadEventId },
      ])

      expect(counts.get(stream1)).toBe(0)
      expect(counts.get(stream2)).toBe(0)
    })

    test("should only update streams that have unread messages", async () => {
      const stream1 = streamId()
      const stream2 = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      await withTestTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [stream1, testWorkspaceId, testUserId]
        )
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [stream2, testWorkspaceId, testUserId]
        )
        await StreamMemberRepository.insert(client, stream1, testUserId)
        await StreamMemberRepository.insert(client, stream2, testUserId)
      })

      // Add message to stream1 only
      await eventService.createMessage({
        workspaceId: testWorkspaceId,
        streamId: stream1,
        authorId: testUserId,
        authorType: "user",
        ...testMessageContent("Stream 1 message"),
      })

      // Mark stream1 as read first
      const events1 = await withClient(pool, (client) => StreamEventRepository.list(client, stream1))
      await streamService.markAsRead(testWorkspaceId, stream1, testUserId, events1[0].id)

      // Now markAllAsRead should return empty (both are already read or have no messages)
      const updatedStreamIds = await streamService.markAllAsRead(testWorkspaceId, testUserId)

      expect(updatedStreamIds).toHaveLength(0)
    })

    test("should only affect streams in the specified workspace", async () => {
      const stream1 = streamId()
      const stream2 = streamId()
      const workspace1 = workspaceId()
      const workspace2 = workspaceId()
      const testUserId = userId()
      const otherUserId = userId()

      await withTestTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [stream1, workspace1, testUserId]
        )
        await client.query(
          `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
          [stream2, workspace2, testUserId]
        )
        await StreamMemberRepository.insert(client, stream1, testUserId)
        await StreamMemberRepository.insert(client, stream2, testUserId)
        await StreamMemberRepository.insert(client, stream1, otherUserId)
        await StreamMemberRepository.insert(client, stream2, otherUserId)
      })

      // Add messages from another user so testUserId has unread messages
      await eventService.createMessage({
        workspaceId: workspace1,
        streamId: stream1,
        authorId: otherUserId,
        authorType: "user",
        ...testMessageContent("Workspace 1 message"),
      })
      await eventService.createMessage({
        workspaceId: workspace2,
        streamId: stream2,
        authorId: otherUserId,
        authorType: "user",
        ...testMessageContent("Workspace 2 message"),
      })

      // Mark all as read in workspace1 only
      const updatedStreamIds = await streamService.markAllAsRead(workspace1, testUserId)

      expect(updatedStreamIds).toHaveLength(1)
      expect(updatedStreamIds).toContain(stream1)
      expect(updatedStreamIds).not.toContain(stream2)

      // Stream2 should still have unread (otherUserId sent a message that testUserId hasn't read)
      const membership2 = await streamService.getMembership(stream2, testUserId)
      expect(membership2?.lastReadEventId).toBeNull()
    })
  })

  describe("batchUpdateLastReadEventId", () => {
    test("should update multiple memberships in a single query", async () => {
      const stream1 = streamId()
      const stream2 = streamId()
      const stream3 = streamId()
      const testWorkspaceId = workspaceId()
      const testUserId = userId()

      await withTestTransaction(pool, async (client) => {
        for (const id of [stream1, stream2, stream3]) {
          await client.query(
            `INSERT INTO streams (id, workspace_id, type, visibility, created_by) VALUES ($1, $2, 'scratchpad', 'private', $3)`,
            [id, testWorkspaceId, testUserId]
          )
          await StreamMemberRepository.insert(client, id, testUserId)
        }
      })

      // Add messages
      const eventIds: string[] = []
      for (const streamId of [stream1, stream2, stream3]) {
        await eventService.createMessage({
          workspaceId: testWorkspaceId,
          streamId,
          authorId: testUserId,
          authorType: "user",
          ...testMessageContent("Test message"),
        })
        const events = await withClient(pool, (client) => StreamEventRepository.list(client, streamId))
        eventIds.push(events[0].id)
      }

      // Batch update
      const updates = new Map<string, string>([
        [stream1, eventIds[0]],
        [stream2, eventIds[1]],
        [stream3, eventIds[2]],
      ])

      await withTestTransaction(pool, async (client) => {
        await StreamMemberRepository.batchUpdateLastReadEventId(client, testUserId, updates)
      })

      // Verify all were updated
      const m1 = await streamService.getMembership(stream1, testUserId)
      const m2 = await streamService.getMembership(stream2, testUserId)
      const m3 = await streamService.getMembership(stream3, testUserId)

      expect(m1?.lastReadEventId).toBe(eventIds[0])
      expect(m2?.lastReadEventId).toBe(eventIds[1])
      expect(m3?.lastReadEventId).toBe(eventIds[2])
    })
  })
})
