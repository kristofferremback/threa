/**
 * Thread Graph Integration Tests
 *
 * Tests verify:
 * 1. Thread creation from channels sets correct parent and root
 * 2. Nested threads inherit the correct root stream ID
 * 3. Thread listing by parent stream
 * 4. Deep nesting maintains correct ancestry
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Pool } from "pg"
import { withTransaction } from "../../src/db"
import { UserRepository } from "../../src/repositories/user-repository"
import { WorkspaceRepository } from "../../src/repositories/workspace-repository"
import { StreamService } from "../../src/services/stream-service"
import { EventService } from "../../src/services/event-service"
import { setupTestDatabase, testMessageContent } from "./setup"
import { userId, workspaceId, messageId } from "../../src/lib/id"
import { StreamTypes, Visibilities } from "@threa/types"

describe("Thread Graph", () => {
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

  describe("Thread Creation", () => {
    test("thread from channel has channel as parent and root", async () => {
      const ownerId = userId()
      const wsId = workspaceId()

      await withTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `thread-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Thread Test Workspace",
          slug: `thread-ws-${wsId}`,
          createdBy: ownerId,
        })
        await WorkspaceRepository.addMember(client, wsId, ownerId)
      })

      // Create a channel
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `thread-channel-${Date.now()}`,
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      // Create a message in the channel
      const parentMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Parent message for thread test"),
      })

      // Create a thread from the channel
      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: ownerId,
      })

      expect(thread.type).toBe(StreamTypes.THREAD)
      expect(thread.parentStreamId).toBe(channel.id)
      expect(thread.parentMessageId).toBe(parentMessage.id)
      expect(thread.rootStreamId).toBe(channel.id)
      expect(thread.visibility).toBe(Visibilities.PRIVATE)
    })

    test("nested thread inherits root from parent thread", async () => {
      const ownerId = userId()
      const wsId = workspaceId()

      await withTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `nested-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Nested Thread Workspace",
          slug: `nested-ws-${wsId}`,
          createdBy: ownerId,
        })
        await WorkspaceRepository.addMember(client, wsId, ownerId)
      })

      // Create channel -> thread1 -> thread2
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `nested-channel-${Date.now()}`,
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      const msg1 = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Message 1"),
      })

      const thread1 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: msg1.id,
        createdBy: ownerId,
      })

      const msg2 = await eventService.createMessage({
        workspaceId: wsId,
        streamId: thread1.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Message 2"),
      })

      const thread2 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: thread1.id,
        parentMessageId: msg2.id,
        createdBy: ownerId,
      })

      // thread1's root is channel
      expect(thread1.rootStreamId).toBe(channel.id)

      // thread2's parent is thread1, but root is still channel
      expect(thread2.parentStreamId).toBe(thread1.id)
      expect(thread2.rootStreamId).toBe(channel.id)
    })

    test("deeply nested threads maintain correct root", async () => {
      const ownerId = userId()
      const wsId = workspaceId()

      await withTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `deep-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Deep Thread Workspace",
          slug: `deep-ws-${wsId}`,
          createdBy: ownerId,
        })
        await WorkspaceRepository.addMember(client, wsId, ownerId)
      })

      // Create channel -> t1 -> t2 -> t3 -> t4
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `deep-channel-${Date.now()}`,
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      let parentStream = channel
      const threads = []
      for (let i = 0; i < 4; i++) {
        // Create a message in the current parent stream
        const msg = await eventService.createMessage({
          workspaceId: wsId,
          streamId: parentStream.id,
          authorId: ownerId,
          authorType: "user",
          ...testMessageContent(`Deep message ${i + 1}`),
        })

        const thread = await streamService.createThread({
          workspaceId: wsId,
          parentStreamId: parentStream.id,
          parentMessageId: msg.id,
          createdBy: ownerId,
        })
        threads.push(thread)
        parentStream = thread
      }

      // All threads should have channel as root
      for (const thread of threads) {
        expect(thread.rootStreamId).toBe(channel.id)
      }

      // Each thread's parent should be the previous one
      expect(threads[0].parentStreamId).toBe(channel.id)
      expect(threads[1].parentStreamId).toBe(threads[0].id)
      expect(threads[2].parentStreamId).toBe(threads[1].id)
      expect(threads[3].parentStreamId).toBe(threads[2].id)
    })
  })

  describe("Thread from Scratchpad", () => {
    test("thread from scratchpad has scratchpad as parent and root", async () => {
      const ownerId = userId()
      const wsId = workspaceId()

      await withTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `scratch-thread-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Scratchpad Thread Workspace",
          slug: `scratch-thread-ws-${wsId}`,
          createdBy: ownerId,
        })
        await WorkspaceRepository.addMember(client, wsId, ownerId)
      })

      // Create a scratchpad
      const scratchpad = await streamService.createScratchpad({
        workspaceId: wsId,
        createdBy: ownerId,
      })

      // Create a message in the scratchpad
      const parentMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: scratchpad.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Scratchpad message for thread"),
      })

      // Create a thread from the scratchpad
      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: scratchpad.id,
        parentMessageId: parentMessage.id,
        createdBy: ownerId,
      })

      expect(thread.parentStreamId).toBe(scratchpad.id)
      expect(thread.rootStreamId).toBe(scratchpad.id)
    })
  })

  describe("Thread Membership", () => {
    test("thread creator is automatically added as member", async () => {
      const ownerId = userId()
      const wsId = workspaceId()

      await withTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `thread-member-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Thread Member Workspace",
          slug: `thread-member-ws-${wsId}`,
          createdBy: ownerId,
        })
        await WorkspaceRepository.addMember(client, wsId, ownerId)
      })

      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `member-channel-${Date.now()}`,
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      const parentMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Message for thread membership test"),
      })

      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: ownerId,
      })

      // Creator should be a member
      const isMember = await streamService.isMember(thread.id, ownerId)
      expect(isMember).toBe(true)
    })
  })

  describe("Invalid Thread Creation", () => {
    test("creating thread with non-existent parent fails", async () => {
      const ownerId = userId()
      const wsId = workspaceId()

      await withTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `invalid-thread-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Invalid Thread Workspace",
          slug: `invalid-thread-ws-${wsId}`,
          createdBy: ownerId,
        })
        await WorkspaceRepository.addMember(client, wsId, ownerId)
      })

      await expect(
        streamService.createThread({
          workspaceId: wsId,
          parentStreamId: "stream_nonexistent",
          parentMessageId: "msg_nonexistent",
          createdBy: ownerId,
        })
      ).rejects.toThrow("Stream not found")
    })
  })

  describe("Thread Idempotency", () => {
    test("creating thread for same parent message returns existing thread", async () => {
      const ownerId = userId()
      const wsId = workspaceId()

      await withTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `idem-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Idempotency Test Workspace",
          slug: `idem-ws-${wsId}`,
          createdBy: ownerId,
        })
        await WorkspaceRepository.addMember(client, wsId, ownerId)
      })

      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `idem-channel-${Date.now()}`,
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      // Create actual message to thread from
      const parentMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Parent message for idempotency test"),
      })

      // Create thread first time
      const thread1 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: ownerId,
      })

      // Create thread second time with same parent message
      const thread2 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: ownerId,
      })

      // Should return the same thread
      expect(thread2.id).toBe(thread1.id)
      expect(thread2.createdBy).toBe(thread1.createdBy)
    })

    test("different user creating thread for same message becomes member of existing thread", async () => {
      const ownerId = userId()
      const user2Id = userId()
      const wsId = workspaceId()

      await withTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `idem-owner2-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: user2Id,
          email: `idem-user2-${user2Id}@test.com`,
          name: "User 2",
          workosUserId: `workos_${user2Id}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Multi-user Idempotency Workspace",
          slug: `idem-multi-ws-${wsId}`,
          createdBy: ownerId,
        })
        await WorkspaceRepository.addMember(client, wsId, ownerId)
        await WorkspaceRepository.addMember(client, wsId, user2Id)
      })

      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `idem-multi-channel-${Date.now()}`,
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      // Create actual message to thread from
      const parentMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Parent message for multi-user idempotency test"),
      })

      // First user creates thread
      const thread1 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: ownerId,
      })

      // Second user tries to create thread for same message
      const thread2 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: user2Id,
      })

      // Should return same thread
      expect(thread2.id).toBe(thread1.id)
      // createdBy should NOT change - first creator owns it
      expect(thread2.createdBy).toBe(ownerId)

      // Both users should be members
      const isMember1 = await streamService.isMember(thread1.id, ownerId)
      const isMember2 = await streamService.isMember(thread1.id, user2Id)
      expect(isMember1).toBe(true)
      expect(isMember2).toBe(true)
    })
  })

  describe("Reply Count", () => {
    test("creating message in thread increments parent message reply count", async () => {
      const ownerId = userId()
      const wsId = workspaceId()

      await withTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `reply-count-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Reply Count Test Workspace",
          slug: `reply-ws-${wsId}`,
          createdBy: ownerId,
        })
        await WorkspaceRepository.addMember(client, wsId, ownerId)
      })

      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `reply-channel-${Date.now()}`,
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      // Create a message in the channel
      const parentMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Parent message"),
      })

      // Verify initial reply count is 0
      const initialMessage = await eventService.getMessageById(parentMessage.id)
      expect(initialMessage?.replyCount).toBe(0)

      // Create a thread from the parent message
      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: ownerId,
      })

      // Send a message in the thread
      await eventService.createMessage({
        workspaceId: wsId,
        streamId: thread.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Reply 1"),
      })

      // Verify reply count is now 1
      const updatedMessage1 = await eventService.getMessageById(parentMessage.id)
      expect(updatedMessage1?.replyCount).toBe(1)

      // Send another message in the thread
      await eventService.createMessage({
        workspaceId: wsId,
        streamId: thread.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Reply 2"),
      })

      // Verify reply count is now 2
      const updatedMessage2 = await eventService.getMessageById(parentMessage.id)
      expect(updatedMessage2?.replyCount).toBe(2)
    })

    test("reply count only tracks direct thread, not nested threads", async () => {
      const ownerId = userId()
      const wsId = workspaceId()

      await withTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `nested-reply-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Nested Reply Count Workspace",
          slug: `nested-reply-ws-${wsId}`,
          createdBy: ownerId,
        })
        await WorkspaceRepository.addMember(client, wsId, ownerId)
      })

      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `nested-reply-channel-${Date.now()}`,
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      // Create message in channel
      const channelMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Channel message"),
      })

      // Create thread from channel message
      const thread1 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: channelMessage.id,
        createdBy: ownerId,
      })

      // Create message in thread1
      const thread1Message = await eventService.createMessage({
        workspaceId: wsId,
        streamId: thread1.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Thread 1 message"),
      })

      // Channel message should have 1 reply
      const afterThread1Msg = await eventService.getMessageById(channelMessage.id)
      expect(afterThread1Msg?.replyCount).toBe(1)

      // Create nested thread from thread1 message
      const thread2 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: thread1.id,
        parentMessageId: thread1Message.id,
        createdBy: ownerId,
      })

      // Create message in nested thread
      await eventService.createMessage({
        workspaceId: wsId,
        streamId: thread2.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Thread 2 message"),
      })

      // Channel message should STILL have 1 reply (not 2)
      const afterThread2Msg = await eventService.getMessageById(channelMessage.id)
      expect(afterThread2Msg?.replyCount).toBe(1)

      // Thread 1 message should have 1 reply
      const thread1MsgUpdated = await eventService.getMessageById(thread1Message.id)
      expect(thread1MsgUpdated?.replyCount).toBe(1)
    })
  })
})
