/**
 * Access Control Integration Tests
 *
 * Tests verify:
 * 1. Workspace membership gates workspace access
 * 2. Stream visibility controls discoverability
 * 3. Private streams require membership
 * 4. Creator-only operations (archive)
 * 5. Member-only operations (companion mode, pin, mute)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Pool } from "pg"
import { withTestTransaction, addTestMember } from "./setup"
import { UserRepository } from "../../src/auth/user-repository"
import { WorkspaceRepository, WorkspaceService } from "../../src/features/workspaces"
import { StreamEventRepository, StreamService } from "../../src/features/streams"
import { EventService } from "../../src/features/messaging"
import { StreamNotFoundError } from "../../src/lib/errors"
import { setupTestDatabase, testMessageContent } from "./setup"
import { userId, workspaceId, eventId, commandId } from "../../src/lib/id"
import { StreamTypes, Visibilities } from "@threa/types"

describe("Access Control", () => {
  let pool: Pool
  let streamService: StreamService
  let workspaceService: WorkspaceService
  let eventService: EventService

  beforeAll(async () => {
    pool = await setupTestDatabase()
    streamService = new StreamService(pool)
    workspaceService = new WorkspaceService(pool, {} as any)
    eventService = new EventService(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("Workspace Membership", () => {
    test("isMember returns true for workspace members", async () => {
      const user1Id = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: user1Id,
          email: `workspace-member-${user1Id}@test.com`,
          name: "Test User",
          workosUserId: `workos_${user1Id}`,
        })

        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Test Workspace",
          slug: `test-ws-${wsId}`,
          createdBy: user1Id,
        })
        await addTestMember(client, wsId, user1Id)
      })

      const isMember = await workspaceService.isMember(wsId, user1Id)
      expect(isMember).toBe(true)
    })

    test("isMember returns false for non-members", async () => {
      const ownerId = userId()
      const nonMemberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: nonMemberId,
          email: `non-member-${nonMemberId}@test.com`,
          name: "Non-Member",
          workosUserId: `workos_${nonMemberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Test Workspace",
          slug: `test-ws-${wsId}`,
          createdBy: ownerId,
        })
      })

      const isMember = await workspaceService.isMember(wsId, nonMemberId)
      expect(isMember).toBe(false)
    })

    test("joining a workspace makes user a member", async () => {
      const ownerId = userId()
      const joiningUserId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `owner-join-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: joiningUserId,
          email: `joining-${joiningUserId}@test.com`,
          name: "Joining User",
          workosUserId: `workos_${joiningUserId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Test Workspace",
          slug: `test-ws-${wsId}`,
          createdBy: ownerId,
        })
      })

      // Initially not a member
      expect(await workspaceService.isMember(wsId, joiningUserId)).toBe(false)

      // Join the workspace
      await workspaceService.addMember(wsId, joiningUserId)

      // Now a member
      expect(await workspaceService.isMember(wsId, joiningUserId)).toBe(true)
    })
  })

  describe("Stream Visibility", () => {
    test("public streams are visible to all workspace members", async () => {
      const ownerId = userId()
      const memberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `public-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: memberId,
          email: `public-member-${memberId}@test.com`,
          name: "Member",
          workosUserId: `workos_${memberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Public Test Workspace",
          slug: `public-test-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, memberId)
      })

      // Create a public channel (not adding memberId as stream member)
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `public-channel-${Date.now()}`,
        displayName: "Public Channel",
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      // Member should be able to access the public stream
      const stream = await streamService.validateStreamAccess(channel.id, wsId, memberId)
      expect(stream.id).toBe(channel.id)
      expect(stream.visibility).toBe(Visibilities.PUBLIC)
    })

    test("private streams are not visible to non-members", async () => {
      const ownerId = userId()
      const memberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `private-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: memberId,
          email: `private-member-${memberId}@test.com`,
          name: "Member",
          workosUserId: `workos_${memberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Private Test Workspace",
          slug: `private-test-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, memberId)
      })

      // Create a private channel (not adding memberId as stream member)
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `private-channel-${Date.now()}`,
        displayName: "Private Channel",
        createdBy: ownerId,
        visibility: Visibilities.PRIVATE,
      })

      // Member should NOT be able to access the private stream
      await expect(streamService.validateStreamAccess(channel.id, wsId, memberId)).rejects.toThrow(StreamNotFoundError)
    })

    test("private streams are accessible to stream members", async () => {
      const ownerId = userId()
      const streamMemberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `priv-access-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: streamMemberId,
          email: `priv-access-member-${streamMemberId}@test.com`,
          name: "Stream Member",
          workosUserId: `workos_${streamMemberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Private Access Workspace",
          slug: `priv-access-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, streamMemberId)
      })

      // Create a private channel
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `private-member-channel-${Date.now()}`,
        displayName: "Private Member Channel",
        createdBy: ownerId,
        visibility: Visibilities.PRIVATE,
      })

      // Add user as stream member
      await streamService.addMember(channel.id, streamMemberId)

      // Now they can access
      const stream = await streamService.validateStreamAccess(channel.id, wsId, streamMemberId)
      expect(stream.id).toBe(channel.id)
    })

    test("scratchpads are always private", async () => {
      const ownerId = userId()
      const otherId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `scratch-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: otherId,
          email: `scratch-other-${otherId}@test.com`,
          name: "Other",
          workosUserId: `workos_${otherId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Scratchpad Test Workspace",
          slug: `scratch-test-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, otherId)
      })

      // Create a scratchpad
      const scratchpad = await streamService.createScratchpad({
        workspaceId: wsId,
        createdBy: ownerId,
      })

      // Verify it's private
      expect(scratchpad.visibility).toBe(Visibilities.PRIVATE)
      expect(scratchpad.type).toBe(StreamTypes.SCRATCHPAD)

      // Owner can access (they're auto-added as member)
      const ownerAccess = await streamService.validateStreamAccess(scratchpad.id, wsId, ownerId)
      expect(ownerAccess.id).toBe(scratchpad.id)

      // Other workspace member cannot access
      await expect(streamService.validateStreamAccess(scratchpad.id, wsId, otherId)).rejects.toThrow(
        StreamNotFoundError
      )
    })
  })

  describe("Stream Listing", () => {
    test("list returns public streams and user's private streams", async () => {
      const user1Id = userId()
      const user2Id = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: user1Id,
          email: `list-user1-${user1Id}@test.com`,
          name: "User 1",
          workosUserId: `workos_${user1Id}`,
        })
        await UserRepository.insert(client, {
          id: user2Id,
          email: `list-user2-${user2Id}@test.com`,
          name: "User 2",
          workosUserId: `workos_${user2Id}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "List Test Workspace",
          slug: `list-test-ws-${wsId}`,
          createdBy: user1Id,
        })
        await addTestMember(client, wsId, user2Id)
      })

      // User 1 creates a public channel
      const publicChannel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `list-public-${Date.now()}`,
        displayName: "Public Channel",
        createdBy: user1Id,
        visibility: Visibilities.PUBLIC,
      })

      // User 1 creates a private scratchpad
      const user1Scratchpad = await streamService.createScratchpad({
        workspaceId: wsId,
        createdBy: user1Id,
      })

      // User 2 creates a private scratchpad
      const user2Scratchpad = await streamService.createScratchpad({
        workspaceId: wsId,
        createdBy: user2Id,
      })

      // User 1's list should include: public channel + their scratchpad
      const user1Streams = await streamService.list(wsId, user1Id)
      const user1StreamIds = user1Streams.map((s) => s.id)
      expect(user1StreamIds).toContain(publicChannel.id)
      expect(user1StreamIds).toContain(user1Scratchpad.id)
      expect(user1StreamIds).not.toContain(user2Scratchpad.id)

      // User 2's list should include: public channel + their scratchpad
      const user2Streams = await streamService.list(wsId, user2Id)
      const user2StreamIds = user2Streams.map((s) => s.id)
      expect(user2StreamIds).toContain(publicChannel.id)
      expect(user2StreamIds).toContain(user2Scratchpad.id)
      expect(user2StreamIds).not.toContain(user1Scratchpad.id)
    })
  })

  describe("Stream Membership Operations", () => {
    test("adding a member grants access to private stream", async () => {
      const ownerId = userId()
      const newMemberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `add-member-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: newMemberId,
          email: `add-member-new-${newMemberId}@test.com`,
          name: "New Member",
          workosUserId: `workos_${newMemberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Add Member Workspace",
          slug: `add-member-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, newMemberId)
      })

      // Create private channel
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `add-member-channel-${Date.now()}`,
        displayName: "Add Member Channel",
        createdBy: ownerId,
        visibility: Visibilities.PRIVATE,
      })

      // Initially no access
      await expect(streamService.validateStreamAccess(channel.id, wsId, newMemberId)).rejects.toThrow(
        StreamNotFoundError
      )

      // Add as member
      await streamService.addMember(channel.id, newMemberId)

      // Now has access
      const stream = await streamService.validateStreamAccess(channel.id, wsId, newMemberId)
      expect(stream.id).toBe(channel.id)
    })

    test("removing a member revokes access to private stream", async () => {
      const ownerId = userId()
      const removedMemberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `rm-member-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: removedMemberId,
          email: `rm-member-removed-${removedMemberId}@test.com`,
          name: "Removed Member",
          workosUserId: `workos_${removedMemberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Remove Member Workspace",
          slug: `rm-member-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, removedMemberId)
      })

      // Create private channel with member
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `rm-member-channel-${Date.now()}`,
        displayName: "Remove Member Channel",
        createdBy: ownerId,
        visibility: Visibilities.PRIVATE,
      })
      await streamService.addMember(channel.id, removedMemberId)

      // Verify access
      const accessBefore = await streamService.validateStreamAccess(channel.id, wsId, removedMemberId)
      expect(accessBefore.id).toBe(channel.id)

      // Remove member
      await streamService.removeMember(channel.id, removedMemberId)

      // Access revoked
      await expect(streamService.validateStreamAccess(channel.id, wsId, removedMemberId)).rejects.toThrow(
        StreamNotFoundError
      )
    })
  })

  describe("Cross-Workspace Isolation", () => {
    test("streams in different workspaces are isolated", async () => {
      const user1Id = userId()
      const user2Id = userId()
      const ws1Id = workspaceId()
      const ws2Id = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: user1Id,
          email: `cross-ws-user1-${user1Id}@test.com`,
          name: "User 1",
          workosUserId: `workos_${user1Id}`,
        })
        await UserRepository.insert(client, {
          id: user2Id,
          email: `cross-ws-user2-${user2Id}@test.com`,
          name: "User 2",
          workosUserId: `workos_${user2Id}`,
        })
        await WorkspaceRepository.insert(client, {
          id: ws1Id,
          name: "Workspace 1",
          slug: `ws1-${ws1Id}`,
          createdBy: user1Id,
        })
        await WorkspaceRepository.insert(client, {
          id: ws2Id,
          name: "Workspace 2",
          slug: `ws2-${ws2Id}`,
          createdBy: user2Id,
        })
      })

      // Create stream in workspace 1
      const ws1Stream = await streamService.createChannel({
        workspaceId: ws1Id,
        slug: `ws1-channel-${Date.now()}`,
        displayName: "WS1 Channel",
        createdBy: user1Id,
        visibility: Visibilities.PUBLIC,
      })

      // User 1 can access stream in their workspace
      const access = await streamService.validateStreamAccess(ws1Stream.id, ws1Id, user1Id)
      expect(access.id).toBe(ws1Stream.id)

      // Trying to access with wrong workspace ID fails
      await expect(streamService.validateStreamAccess(ws1Stream.id, ws2Id, user2Id)).rejects.toThrow(
        StreamNotFoundError
      )
    })
  })

  describe("Thread Visibility", () => {
    test("thread inherits visibility from parent channel", async () => {
      const ownerId = userId()
      const memberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `thread-vis-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: memberId,
          email: `thread-vis-member-${memberId}@test.com`,
          name: "Member",
          workosUserId: `workos_${memberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Thread Visibility Workspace",
          slug: `thread-vis-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, memberId)
      })

      // Create a public channel
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `thread-vis-channel-${Date.now()}`,
        displayName: "Thread Visibility Channel",
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      // Create a message in the channel
      const parentMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Parent message for thread visibility test"),
      })

      // Create a thread from the channel
      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: ownerId,
      })

      // Thread should be private (always), but accessible to channel members
      expect(thread.visibility).toBe(Visibilities.PRIVATE)
      expect(thread.rootStreamId).toBe(channel.id)

      // Member of workspace (who can see public channel) should be able to access thread
      // via root stream membership check
      const access = await streamService.validateStreamAccess(thread.id, wsId, memberId)
      expect(access.id).toBe(thread.id)
    })

    test("deeply nested threads are visible to root stream members", async () => {
      const ownerId = userId()
      const memberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `deep-thread-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: memberId,
          email: `deep-thread-member-${memberId}@test.com`,
          name: "Member",
          workosUserId: `workos_${memberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Deep Thread Workspace",
          slug: `deep-thread-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, memberId)
      })

      // Create channel -> thread1 -> thread2 -> thread3
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `deep-thread-channel-${Date.now()}`,
        displayName: "Deep Thread Channel",
        createdBy: ownerId,
        visibility: Visibilities.PUBLIC,
      })

      // Create messages for each level
      const msg1 = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Deep message 1"),
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
        ...testMessageContent("Deep message 2"),
      })

      const thread2 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: thread1.id,
        parentMessageId: msg2.id,
        createdBy: ownerId,
      })

      const msg3 = await eventService.createMessage({
        workspaceId: wsId,
        streamId: thread2.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Deep message 3"),
      })

      const thread3 = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: thread2.id,
        parentMessageId: msg3.id,
        createdBy: ownerId,
      })

      // All threads should have channel as root
      expect(thread1.rootStreamId).toBe(channel.id)
      expect(thread2.rootStreamId).toBe(channel.id)
      expect(thread3.rootStreamId).toBe(channel.id)

      // Workspace member (with access to public channel) should be able to access deeply nested thread
      const access = await streamService.validateStreamAccess(thread3.id, wsId, memberId)
      expect(access.id).toBe(thread3.id)
    })

    test("private channel threads require channel membership", async () => {
      const ownerId = userId()
      const nonMemberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `priv-thread-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: nonMemberId,
          email: `priv-thread-nonmember-${nonMemberId}@test.com`,
          name: "Non-Member",
          workosUserId: `workos_${nonMemberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Private Thread Workspace",
          slug: `priv-thread-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, nonMemberId)
      })

      // Create a private channel
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `priv-thread-channel-${Date.now()}`,
        displayName: "Private Thread Channel",
        createdBy: ownerId,
        visibility: Visibilities.PRIVATE,
      })

      // Create a message in the channel
      const parentMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Private channel message for thread"),
      })

      // Create a thread
      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: ownerId,
      })

      // Non-member of channel cannot access thread (even though in workspace)
      await expect(streamService.validateStreamAccess(thread.id, wsId, nonMemberId)).rejects.toThrow(
        StreamNotFoundError
      )

      // Add them to channel
      await streamService.addMember(channel.id, nonMemberId)

      // Now they can access thread
      const access = await streamService.validateStreamAccess(thread.id, wsId, nonMemberId)
      expect(access.id).toBe(thread.id)
    })

    test("channel member can post to thread via isMember inheritance", async () => {
      const channelOwnerId = userId()
      const channelMemberId = userId()
      const threadCreatorId = userId() // e.g., a persona
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: channelOwnerId,
          email: `thread-ismember-owner-${channelOwnerId}@test.com`,
          name: "Channel Owner",
          workosUserId: `workos_${channelOwnerId}`,
        })
        await UserRepository.insert(client, {
          id: channelMemberId,
          email: `thread-ismember-member-${channelMemberId}@test.com`,
          name: "Channel Member",
          workosUserId: `workos_${channelMemberId}`,
        })
        await UserRepository.insert(client, {
          id: threadCreatorId,
          email: `thread-ismember-creator-${threadCreatorId}@test.com`,
          name: "Thread Creator",
          workosUserId: `workos_${threadCreatorId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Thread isMember Workspace",
          slug: `thread-ismember-ws-${wsId}`,
          createdBy: channelOwnerId,
        })
        await addTestMember(client, wsId, channelMemberId)
        await addTestMember(client, wsId, threadCreatorId)
      })

      // Create channel with owner and member
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `thread-ismember-channel-${Date.now()}`,
        createdBy: channelOwnerId,
        visibility: Visibilities.PRIVATE,
      })
      await streamService.addMember(channel.id, channelMemberId)

      // Create message and thread by a different user (e.g., persona creating thread for mention response)
      const parentMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: channelMemberId,
        authorType: "user",
        ...testMessageContent("Message that will spawn a thread"),
      })
      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: threadCreatorId,
      })

      // Channel member should be able to post to thread even without direct thread membership
      // This is the exact scenario: user mentions @ariadne, ariadne creates thread, user should be able to respond
      expect(await streamService.isMember(thread.id, channelMemberId)).toBe(true)
      expect(await streamService.isMember(thread.id, channelOwnerId)).toBe(true)
    })

    test("adding member to thread adds them to root stream", async () => {
      const ownerId = userId()
      const newMemberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `thread-add-member-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: newMemberId,
          email: `thread-add-member-new-${newMemberId}@test.com`,
          name: "New Member",
          workosUserId: `workos_${newMemberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Thread Add Member Workspace",
          slug: `thread-add-member-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, newMemberId)
      })

      // Create a private channel and thread
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `thread-add-member-channel-${Date.now()}`,
        displayName: "Thread Add Member Channel",
        createdBy: ownerId,
        visibility: Visibilities.PRIVATE,
      })

      // Create a message in the channel
      const parentMessage = await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: ownerId,
        authorType: "user",
        ...testMessageContent("Message for add member to thread test"),
      })

      const thread = await streamService.createThread({
        workspaceId: wsId,
        parentStreamId: channel.id,
        parentMessageId: parentMessage.id,
        createdBy: ownerId,
      })

      // Initially not a member of either
      expect(await streamService.isMember(channel.id, newMemberId)).toBe(false)
      expect(await streamService.isMember(thread.id, newMemberId)).toBe(false)

      // Add them to the thread
      await streamService.addMember(thread.id, newMemberId)

      // Should now be member of both thread AND root channel
      expect(await streamService.isMember(thread.id, newMemberId)).toBe(true)
      expect(await streamService.isMember(channel.id, newMemberId)).toBe(true)
    })
  })

  describe("Member-Only Operations", () => {
    test("isMember correctly identifies stream members", async () => {
      const ownerId = userId()
      const memberId = userId()
      const nonMemberId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: ownerId,
          email: `is-member-owner-${ownerId}@test.com`,
          name: "Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: memberId,
          email: `is-member-member-${memberId}@test.com`,
          name: "Member",
          workosUserId: `workos_${memberId}`,
        })
        await UserRepository.insert(client, {
          id: nonMemberId,
          email: `is-member-non-${nonMemberId}@test.com`,
          name: "Non-Member",
          workosUserId: `workos_${nonMemberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "isMember Test Workspace",
          slug: `is-member-ws-${wsId}`,
          createdBy: ownerId,
        })
        await addTestMember(client, wsId, memberId)
        await addTestMember(client, wsId, nonMemberId)
      })

      // Create channel and add memberId
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `is-member-channel-${Date.now()}`,
        displayName: "isMember Channel",
        createdBy: ownerId,
        visibility: Visibilities.PRIVATE,
      })
      await streamService.addMember(channel.id, memberId)

      // Owner is member (auto-added on create)
      expect(await streamService.isMember(channel.id, ownerId)).toBe(true)

      // Explicitly added member is member
      expect(await streamService.isMember(channel.id, memberId)).toBe(true)

      // Non-member is not member
      expect(await streamService.isMember(channel.id, nonMemberId)).toBe(false)
    })
  })

  describe("Command Event Visibility", () => {
    test("command events are only visible to the command author", async () => {
      const userAId = userId()
      const userBId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: userAId,
          email: `cmd-vis-userA-${userAId}@test.com`,
          name: "User A",
          workosUserId: `workos_${userAId}`,
        })
        await UserRepository.insert(client, {
          id: userBId,
          email: `cmd-vis-userB-${userBId}@test.com`,
          name: "User B",
          workosUserId: `workos_${userBId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Command Visibility Workspace",
          slug: `cmd-vis-ws-${wsId}`,
          createdBy: userAId,
        })
        await addTestMember(client, wsId, userBId)
      })

      // Create a public channel with both users as members
      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `cmd-vis-channel-${Date.now()}`,
        displayName: "Command Visibility Channel",
        createdBy: userAId,
        visibility: Visibilities.PUBLIC,
      })
      await streamService.addMember(channel.id, userBId)

      // Create a regular message (visible to both)
      await eventService.createMessage({
        workspaceId: wsId,
        streamId: channel.id,
        authorId: userAId,
        authorType: "user",
        ...testMessageContent("Regular message visible to all"),
      })

      // Create command events as User A (directly via repository for test control)
      const cmdId = commandId()
      await withTestTransaction(pool, async (client) => {
        await StreamEventRepository.insert(client, {
          id: eventId(),
          streamId: channel.id,
          eventType: "command_dispatched",
          payload: {
            commandId: cmdId,
            name: "echo",
            args: "test args",
            status: "dispatched",
          },
          actorId: userAId,
          actorType: "user",
        })

        await StreamEventRepository.insert(client, {
          id: eventId(),
          streamId: channel.id,
          eventType: "command_completed",
          payload: {
            commandId: cmdId,
            result: "test result",
          },
          actorId: userAId,
          actorType: "user",
        })
      })

      // User A should see all events including command events
      const userAEvents = await eventService.listEvents(channel.id, { viewerId: userAId })
      const userAEventTypes = userAEvents.map((e) => e.eventType)
      expect(userAEventTypes).toContain("message_created")
      expect(userAEventTypes).toContain("command_dispatched")
      expect(userAEventTypes).toContain("command_completed")

      // User B should only see message events, NOT command events
      const userBEvents = await eventService.listEvents(channel.id, { viewerId: userBId })
      const userBEventTypes = userBEvents.map((e) => e.eventType)
      expect(userBEventTypes).toContain("message_created")
      expect(userBEventTypes).not.toContain("command_dispatched")
      expect(userBEventTypes).not.toContain("command_completed")
    })

    test("command_failed events are only visible to the command author", async () => {
      const userAId = userId()
      const userBId = userId()
      const wsId = workspaceId()

      await withTestTransaction(pool, async (client) => {
        await UserRepository.insert(client, {
          id: userAId,
          email: `cmd-fail-vis-userA-${userAId}@test.com`,
          name: "User A",
          workosUserId: `workos_${userAId}`,
        })
        await UserRepository.insert(client, {
          id: userBId,
          email: `cmd-fail-vis-userB-${userBId}@test.com`,
          name: "User B",
          workosUserId: `workos_${userBId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Command Failed Visibility Workspace",
          slug: `cmd-fail-vis-ws-${wsId}`,
          createdBy: userAId,
        })
        await addTestMember(client, wsId, userBId)
      })

      const channel = await streamService.createChannel({
        workspaceId: wsId,
        slug: `cmd-fail-vis-channel-${Date.now()}`,
        displayName: "Command Failed Visibility Channel",
        createdBy: userAId,
        visibility: Visibilities.PUBLIC,
      })
      await streamService.addMember(channel.id, userBId)

      // Create command_dispatched and command_failed events as User A
      const cmdId = commandId()
      await withTestTransaction(pool, async (client) => {
        await StreamEventRepository.insert(client, {
          id: eventId(),
          streamId: channel.id,
          eventType: "command_dispatched",
          payload: {
            commandId: cmdId,
            name: "echo",
            args: "bad args",
            status: "dispatched",
          },
          actorId: userAId,
          actorType: "user",
        })

        await StreamEventRepository.insert(client, {
          id: eventId(),
          streamId: channel.id,
          eventType: "command_failed",
          payload: {
            commandId: cmdId,
            error: "Something went wrong",
          },
          actorId: userAId,
          actorType: "user",
        })
      })

      // User A should see failed command events
      const userAEvents = await eventService.listEvents(channel.id, { viewerId: userAId })
      const userAEventTypes = userAEvents.map((e) => e.eventType)
      expect(userAEventTypes).toContain("command_dispatched")
      expect(userAEventTypes).toContain("command_failed")

      // User B should NOT see failed command events
      const userBEvents = await eventService.listEvents(channel.id, { viewerId: userBId })
      const userBEventTypes = userBEvents.map((e) => e.eventType)
      expect(userBEventTypes).not.toContain("command_dispatched")
      expect(userBEventTypes).not.toContain("command_failed")
    })
  })
})
