/**
 * Context Builder Integration Tests
 *
 * Tests verify:
 * 1. Scratchpad context includes conversation history
 * 2. Channel context includes members and conversation
 * 3. Thread context includes hierarchy path
 * 4. DM context includes both participants
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Pool } from "pg"
import { withTestTransaction } from "../../src/db"
import { UserRepository } from "../../src/repositories/user-repository"
import { WorkspaceRepository } from "../../src/repositories/workspace-repository"
import { StreamRepository } from "../../src/repositories/stream-repository"
import { StreamMemberRepository } from "../../src/repositories/stream-member-repository"
import { MessageRepository } from "../../src/repositories/message-repository"
import { buildStreamContext } from "../../src/agents/context-builder"
import { setupTestDatabase, testMessageContent } from "./setup"
import { userId, workspaceId, streamId, messageId } from "../../src/lib/id"
import { StreamTypes, Visibilities } from "@threa/types"

describe("Context Builder", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("Scratchpad Context", () => {
    test("should include conversation history", async () => {
      await withTestTransaction(pool, async (client) => {
        const ownerId = userId()
        const wsId = workspaceId()
        const scratchpadId = streamId()

        await UserRepository.insert(client, {
          id: ownerId,
          email: `scratchpad-ctx-${ownerId}@test.com`,
          name: "Scratchpad Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Context Test Workspace",
          slug: `ctx-ws-${wsId}`,
          createdBy: ownerId,
        })

        const scratchpad = await StreamRepository.insert(client, {
          id: scratchpadId,
          workspaceId: wsId,
          type: StreamTypes.SCRATCHPAD,
          displayName: "My Scratchpad",
          description: "Personal notes",
          visibility: Visibilities.PRIVATE,
          createdBy: ownerId,
        })

        // Add some messages
        const msg1Id = messageId()
        const msg2Id = messageId()
        await MessageRepository.insert(client, {
          id: msg1Id,
          streamId: scratchpadId,
          sequence: BigInt(1),
          authorId: ownerId,
          authorType: "user",
          ...testMessageContent("Hello world"),
        })
        await MessageRepository.insert(client, {
          id: msg2Id,
          streamId: scratchpadId,
          sequence: BigInt(2),
          authorId: ownerId,
          authorType: "user",
          ...testMessageContent("Second message"),
        })

        const context = await buildStreamContext(client, scratchpad)

        expect(context).toMatchObject({
          streamType: StreamTypes.SCRATCHPAD,
          streamInfo: {
            name: "My Scratchpad",
            description: "Personal notes",
          },
          conversationHistory: [{ contentMarkdown: "Hello world" }, { contentMarkdown: "Second message" }],
        })
        expect(context.participants).toBeUndefined()
      })
    })
  })

  describe("Channel Context", () => {
    test("should include members and conversation", async () => {
      await withTestTransaction(pool, async (client) => {
        const ownerId = userId()
        const memberId = userId()
        const wsId = workspaceId()
        const channelId = streamId()

        await UserRepository.insert(client, {
          id: ownerId,
          email: `channel-ctx-owner-${ownerId}@test.com`,
          name: "Channel Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await UserRepository.insert(client, {
          id: memberId,
          email: `channel-ctx-member-${memberId}@test.com`,
          name: "Channel Member",
          workosUserId: `workos_${memberId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Channel Context Workspace",
          slug: `channel-ctx-ws-${wsId}`,
          createdBy: ownerId,
        })

        const channel = await StreamRepository.insert(client, {
          id: channelId,
          workspaceId: wsId,
          type: StreamTypes.CHANNEL,
          displayName: "General",
          slug: "general",
          description: "General discussion",
          visibility: Visibilities.PUBLIC,
          createdBy: ownerId,
        })

        // Add members
        await StreamMemberRepository.insert(client, channelId, ownerId)
        await StreamMemberRepository.insert(client, channelId, memberId)

        // Add a message
        const msgId = messageId()
        await MessageRepository.insert(client, {
          id: msgId,
          streamId: channelId,
          sequence: BigInt(1),
          authorId: ownerId,
          authorType: "user",
          ...testMessageContent("Welcome to the channel!"),
        })

        const context = await buildStreamContext(client, channel)

        expect(context.streamType).toBe(StreamTypes.CHANNEL)
        expect(context.streamInfo.name).toBe("General")
        expect(context.streamInfo.slug).toBe("general")
        expect(context.streamInfo.description).toBe("General discussion")
        expect(context.conversationHistory).toHaveLength(1)
        expect(context.participants).toHaveLength(2)

        const participantNames = context.participants!.map((p) => p.name).sort()
        expect(participantNames).toEqual(["Channel Member", "Channel Owner"])
      })
    })
  })

  describe("Thread Context", () => {
    test("should include thread hierarchy path", async () => {
      await withTestTransaction(pool, async (client) => {
        const ownerId = userId()
        const wsId = workspaceId()
        const channelId = streamId()
        const threadId = streamId()

        await UserRepository.insert(client, {
          id: ownerId,
          email: `thread-ctx-${ownerId}@test.com`,
          name: "Thread Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Thread Context Workspace",
          slug: `thread-ctx-ws-${wsId}`,
          createdBy: ownerId,
        })

        // Create channel
        await StreamRepository.insert(client, {
          id: channelId,
          workspaceId: wsId,
          type: StreamTypes.CHANNEL,
          displayName: "Discussions",
          slug: "discussions",
          visibility: Visibilities.PUBLIC,
          createdBy: ownerId,
        })

        // Add parent message
        const parentMsgId = messageId()
        await MessageRepository.insert(client, {
          id: parentMsgId,
          streamId: channelId,
          sequence: BigInt(1),
          authorId: ownerId,
          authorType: "user",
          ...testMessageContent("This is the parent message that spawned the thread"),
        })

        // Create thread from channel
        const thread = await StreamRepository.insert(client, {
          id: threadId,
          workspaceId: wsId,
          type: StreamTypes.THREAD,
          displayName: "Thread Discussion",
          visibility: Visibilities.PRIVATE,
          parentStreamId: channelId,
          parentMessageId: parentMsgId,
          rootStreamId: channelId,
          createdBy: ownerId,
        })

        // Add thread message
        const threadMsgId = messageId()
        await MessageRepository.insert(client, {
          id: threadMsgId,
          streamId: threadId,
          sequence: BigInt(1),
          authorId: ownerId,
          authorType: "user",
          ...testMessageContent("Reply in thread"),
        })

        const context = await buildStreamContext(client, thread)

        expect(context).toMatchObject({
          streamType: StreamTypes.THREAD,
          streamInfo: { name: "Thread Discussion" },
          conversationHistory: [{ contentMarkdown: "Reply in thread" }],
          threadContext: {
            depth: 2,
            path: [
              { streamId: channelId, displayName: "Discussions" },
              { streamId: threadId, displayName: "Thread Discussion" },
            ],
          },
        })

        // Verify anchor message content (uses toContain, cannot express in toMatchObject)
        expect(context.threadContext!.path[1].anchorMessage!.content).toContain("parent message")
      })
    })

    test("should handle deeply nested threads", async () => {
      await withTestTransaction(pool, async (client) => {
        const ownerId = userId()
        const wsId = workspaceId()
        const channelId = streamId()
        const thread1Id = streamId()
        const thread2Id = streamId()

        await UserRepository.insert(client, {
          id: ownerId,
          email: `deep-thread-ctx-${ownerId}@test.com`,
          name: "Deep Thread Owner",
          workosUserId: `workos_${ownerId}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "Deep Thread Context Workspace",
          slug: `deep-thread-ws-${wsId}`,
          createdBy: ownerId,
        })

        // Create channel -> thread1 -> thread2
        await StreamRepository.insert(client, {
          id: channelId,
          workspaceId: wsId,
          type: StreamTypes.CHANNEL,
          displayName: "Root Channel",
          slug: "root",
          visibility: Visibilities.PUBLIC,
          createdBy: ownerId,
        })

        const msg1Id = messageId()
        await MessageRepository.insert(client, {
          id: msg1Id,
          streamId: channelId,
          sequence: BigInt(1),
          authorId: ownerId,
          authorType: "user",
          ...testMessageContent("First level message"),
        })

        await StreamRepository.insert(client, {
          id: thread1Id,
          workspaceId: wsId,
          type: StreamTypes.THREAD,
          displayName: "Thread Level 1",
          visibility: Visibilities.PRIVATE,
          parentStreamId: channelId,
          parentMessageId: msg1Id,
          rootStreamId: channelId,
          createdBy: ownerId,
        })

        const msg2Id = messageId()
        await MessageRepository.insert(client, {
          id: msg2Id,
          streamId: thread1Id,
          sequence: BigInt(1),
          authorId: ownerId,
          authorType: "user",
          ...testMessageContent("Second level message"),
        })

        const thread2 = await StreamRepository.insert(client, {
          id: thread2Id,
          workspaceId: wsId,
          type: StreamTypes.THREAD,
          displayName: "Thread Level 2",
          visibility: Visibilities.PRIVATE,
          parentStreamId: thread1Id,
          parentMessageId: msg2Id,
          rootStreamId: channelId,
          createdBy: ownerId,
        })

        const msg3Id = messageId()
        await MessageRepository.insert(client, {
          id: msg3Id,
          streamId: thread2Id,
          sequence: BigInt(1),
          authorId: ownerId,
          authorType: "user",
          ...testMessageContent("Third level message"),
        })

        const context = await buildStreamContext(client, thread2)

        expect(context.threadContext).toMatchObject({
          depth: 3,
          path: [{ displayName: "Root Channel" }, { displayName: "Thread Level 1" }, { displayName: "Thread Level 2" }],
        })
      })
    })
  })

  describe("DM Context", () => {
    test("should include both participants", async () => {
      await withTestTransaction(pool, async (client) => {
        const user1Id = userId()
        const user2Id = userId()
        const wsId = workspaceId()
        const dmId = streamId()

        await UserRepository.insert(client, {
          id: user1Id,
          email: `dm-ctx-user1-${user1Id}@test.com`,
          name: "Alice",
          workosUserId: `workos_${user1Id}`,
        })
        await UserRepository.insert(client, {
          id: user2Id,
          email: `dm-ctx-user2-${user2Id}@test.com`,
          name: "Bob",
          workosUserId: `workos_${user2Id}`,
        })
        await WorkspaceRepository.insert(client, {
          id: wsId,
          name: "DM Context Workspace",
          slug: `dm-ctx-ws-${wsId}`,
          createdBy: user1Id,
        })

        const dm = await StreamRepository.insert(client, {
          id: dmId,
          workspaceId: wsId,
          type: StreamTypes.DM,
          visibility: Visibilities.PRIVATE,
          createdBy: user1Id,
        })

        // Add both as members
        await StreamMemberRepository.insert(client, dmId, user1Id)
        await StreamMemberRepository.insert(client, dmId, user2Id)

        // Add messages
        const msgId = messageId()
        await MessageRepository.insert(client, {
          id: msgId,
          streamId: dmId,
          sequence: BigInt(1),
          authorId: user1Id,
          authorType: "user",
          ...testMessageContent("Hey Bob!"),
        })

        const context = await buildStreamContext(client, dm)

        expect(context.streamType).toBe(StreamTypes.DM)
        expect(context.conversationHistory).toHaveLength(1)
        expect(context.participants).toHaveLength(2)

        const participantNames = context.participants!.map((p) => p.name).sort()
        expect(participantNames).toEqual(["Alice", "Bob"])
      })
    })
  })
})
