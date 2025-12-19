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
import { setupTestDatabase } from "./setup"
import { userId, workspaceId, messageId } from "../../src/lib/id"
import { StreamTypes, Visibilities } from "@threa/types"

describe("Thread Graph", () => {
  let pool: Pool
  let streamService: StreamService

  beforeAll(async () => {
    pool = await setupTestDatabase()
    streamService = new StreamService(pool)
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

      // Create a thread from the channel
      const parentMsgId = messageId()
      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMsgId,
        createdBy: ownerId,
      })

      expect(thread.type).toBe(StreamTypes.THREAD)
      expect(thread.parentStreamId).toBe(channel.id)
      expect(thread.parentMessageId).toBe(parentMsgId)
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

      const thread1 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: messageId(),
        createdBy: ownerId,
      })

      const thread2 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: thread1.id,
        parentMessageId: messageId(),
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

      let parent = channel
      const threads = []
      for (let i = 0; i < 4; i++) {
        const thread = await streamService.createThread({
          workspaceId: wsId,
          parentStreamId: parent.id,
          parentMessageId: messageId(),
          createdBy: ownerId,
        })
        threads.push(thread)
        parent = thread
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

      // Create a thread from the scratchpad
      const parentMsgId = messageId()
      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: scratchpad.id,
        parentMessageId: parentMsgId,
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

      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: messageId(),
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
          parentMessageId: messageId(),
          createdBy: ownerId,
        })
      ).rejects.toThrow("Parent stream not found")
    })
  })
})
