import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { SearchService } from "../search-service"
import {
  getTestPool,
  closeTestPool,
  cleanupTestData,
  createTestUser,
  createTestWorkspace,
  addUserToWorkspace,
  createTestStream,
  addUserToStream,
  createTestMessage,
  createTestThread,
  createTestThinkingSpace,
} from "./test-helpers"

describe("SearchService", () => {
  let pool: Pool
  let searchService: SearchService

  beforeAll(async () => {
    pool = await getTestPool()
    searchService = new SearchService(pool)
  })

  afterAll(async () => {
    await closeTestPool()
  })

  beforeEach(async () => {
    await cleanupTestData(pool)
  })

  describe("search with userIds filter (from:)", () => {
    test("should return messages from specified users only", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      const channel = await createTestStream(pool, workspace.id, { visibility: "public" })

      await createTestMessage(pool, channel.id, alice.id, "Message from Alice about testing")
      await createTestMessage(pool, channel.id, bob.id, "Message from Bob about testing")
      await createTestMessage(pool, channel.id, alice.id, "Another message from Alice")

      const results = await searchService.search(workspace.id, "", {
        userId: alice.id,
        filters: { userIds: [alice.id] },
      })

      expect(results.results.length).toBe(2)
      expect(results.results.every((r) => r.actor?.id === alice.id)).toBe(true)
    })
  })

  describe("search with withUserIds filter (with:)", () => {
    test("should return messages from streams where all specified users participated", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      const charlie = await createTestUser(pool, { name: "Charlie" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)
      await addUserToWorkspace(pool, charlie.id, workspace.id)

      // Channel where Alice and Bob both posted
      const channel1 = await createTestStream(pool, workspace.id, { visibility: "public", name: "Channel 1" })
      await createTestMessage(pool, channel1.id, alice.id, "Alice in channel 1")
      await createTestMessage(pool, channel1.id, bob.id, "Bob in channel 1")

      // Channel where only Charlie posted
      const channel2 = await createTestStream(pool, workspace.id, { visibility: "public", name: "Channel 2" })
      await createTestMessage(pool, channel2.id, charlie.id, "Charlie in channel 2")

      const results = await searchService.search(workspace.id, "", {
        userId: alice.id,
        filters: { withUserIds: [alice.id, bob.id] },
      })

      expect(results.results.length).toBe(2)
      expect(results.results.every((r) => r.streamId === channel1.id)).toBe(true)
    })

    test("should include thread root message author as participant", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      // Alice posts in channel
      const channel = await createTestStream(pool, workspace.id, { visibility: "public" })
      const rootMessage = await createTestMessage(pool, channel.id, alice.id, "Alice's message that starts a thread")

      // Thread created from Alice's message, Bob replies
      const thread = await createTestThread(pool, workspace.id, channel.id, rootMessage.id)
      await createTestMessage(pool, thread.id, bob.id, "Bob's reply in thread")

      // Search for conversations with both Alice and Bob in threads
      const results = await searchService.search(workspace.id, "", {
        userId: alice.id,
        filters: { withUserIds: [alice.id, bob.id], streamTypes: ["thread"] },
      })

      // Should find Bob's message in the thread because Alice is the root message author
      expect(results.results.length).toBe(1)
      expect(results.results[0].streamId).toBe(thread.id)
    })
  })

  describe("search with streamTypes filter (is:)", () => {
    test("should return messages only from specified stream types", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      await addUserToWorkspace(pool, alice.id, workspace.id)

      const channel = await createTestStream(pool, workspace.id, { streamType: "channel", visibility: "public" })
      const rootMessage = await createTestMessage(pool, channel.id, alice.id, "Channel message")

      const thread = await createTestThread(pool, workspace.id, channel.id, rootMessage.id)
      await createTestMessage(pool, thread.id, alice.id, "Thread message")

      const thinkingSpace = await createTestThinkingSpace(pool, workspace.id, alice.id)
      await createTestMessage(pool, thinkingSpace.id, alice.id, "Thinking space message")

      // Search only threads
      const threadResults = await searchService.search(workspace.id, "", {
        userId: alice.id,
        filters: { streamTypes: ["thread"] },
      })
      expect(threadResults.results.length).toBe(1)
      expect(threadResults.results[0].content).toBe("Thread message")

      // Search only channels
      const channelResults = await searchService.search(workspace.id, "", {
        userId: alice.id,
        filters: { streamTypes: ["channel"] },
      })
      expect(channelResults.results.length).toBe(1)
      expect(channelResults.results[0].content).toBe("Channel message")

      // Search only thinking spaces
      const thinkingResults = await searchService.search(workspace.id, "", {
        userId: alice.id,
        filters: { streamTypes: ["thinking_space"] },
      })
      expect(thinkingResults.results.length).toBe(1)
      expect(thinkingResults.results[0].content).toBe("Thinking space message")
    })
  })

  describe("permission filtering", () => {
    test("should not return messages from private streams user is not a member of", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      // Public channel - both can see
      const publicChannel = await createTestStream(pool, workspace.id, { visibility: "public" })
      await createTestMessage(pool, publicChannel.id, alice.id, "Public message")

      // Private channel - only Alice is member
      const privateChannel = await createTestStream(pool, workspace.id, { visibility: "private" })
      await addUserToStream(pool, alice.id, privateChannel.id)
      await createTestMessage(pool, privateChannel.id, alice.id, "Private message")

      // Alice can see both
      const aliceResults = await searchService.search(workspace.id, "", { userId: alice.id })
      expect(aliceResults.results.length).toBe(2)

      // Bob can only see public
      const bobResults = await searchService.search(workspace.id, "", { userId: bob.id })
      expect(bobResults.results.length).toBe(1)
      expect(bobResults.results[0].content).toBe("Public message")
    })

    test("should not return messages from other users thinking spaces", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      // Alice's thinking space
      const aliceThinking = await createTestThinkingSpace(pool, workspace.id, alice.id)
      await createTestMessage(pool, aliceThinking.id, alice.id, "Alice's private thoughts")

      // Bob's thinking space
      const bobThinking = await createTestThinkingSpace(pool, workspace.id, bob.id)
      await createTestMessage(pool, bobThinking.id, bob.id, "Bob's private thoughts")

      // Alice can only see her own thinking space
      const aliceResults = await searchService.search(workspace.id, "", {
        userId: alice.id,
        filters: { streamTypes: ["thinking_space"] },
      })
      expect(aliceResults.results.length).toBe(1)
      expect(aliceResults.results[0].content).toBe("Alice's private thoughts")

      // Bob can only see his own thinking space
      const bobResults = await searchService.search(workspace.id, "", {
        userId: bob.id,
        filters: { streamTypes: ["thinking_space"] },
      })
      expect(bobResults.results.length).toBe(1)
      expect(bobResults.results[0].content).toBe("Bob's private thoughts")
    })

    test("should return messages from threads with inherited visibility when parent is public", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      // Public channel
      const publicChannel = await createTestStream(pool, workspace.id, { visibility: "public" })
      const rootMessage = await createTestMessage(pool, publicChannel.id, alice.id, "Root message")

      // Thread with inherited visibility (should be public since parent is public)
      const thread = await createTestThread(pool, workspace.id, publicChannel.id, rootMessage.id, {
        visibility: "inherit",
      })
      await createTestMessage(pool, thread.id, alice.id, "Thread message in public thread")

      // Bob should be able to see the thread message even though he's not explicitly a member
      const bobResults = await searchService.search(workspace.id, "", {
        userId: bob.id,
        filters: { streamTypes: ["thread"] },
      })
      expect(bobResults.results.length).toBe(1)
      expect(bobResults.results[0].content).toBe("Thread message in public thread")
    })

    test("should not return messages from threads with inherited visibility when parent is private and user is not member", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      // Private channel - only Alice is member
      const privateChannel = await createTestStream(pool, workspace.id, { visibility: "private" })
      await addUserToStream(pool, alice.id, privateChannel.id)
      const rootMessage = await createTestMessage(pool, privateChannel.id, alice.id, "Root message")

      // Thread with inherited visibility (should be private since parent is private)
      const thread = await createTestThread(pool, workspace.id, privateChannel.id, rootMessage.id, {
        visibility: "inherit",
      })
      await createTestMessage(pool, thread.id, alice.id, "Thread message in private thread")

      // Alice can see the thread
      const aliceResults = await searchService.search(workspace.id, "", {
        userId: alice.id,
        filters: { streamTypes: ["thread"] },
      })
      expect(aliceResults.results.length).toBe(1)

      // Bob cannot see the thread
      const bobResults = await searchService.search(workspace.id, "", {
        userId: bob.id,
        filters: { streamTypes: ["thread"] },
      })
      expect(bobResults.results.length).toBe(0)
    })
  })

  describe("scope filtering (Ariadne context)", () => {
    test("public scope should only return messages from public streams", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      await addUserToWorkspace(pool, alice.id, workspace.id)

      const publicChannel = await createTestStream(pool, workspace.id, { visibility: "public" })
      await createTestMessage(pool, publicChannel.id, alice.id, "Public message")

      const privateChannel = await createTestStream(pool, workspace.id, { visibility: "private" })
      await addUserToStream(pool, alice.id, privateChannel.id)
      await createTestMessage(pool, privateChannel.id, alice.id, "Private message")

      const thinkingSpace = await createTestThinkingSpace(pool, workspace.id, alice.id)
      await createTestMessage(pool, thinkingSpace.id, alice.id, "Thinking message")

      const results = await searchService.search(workspace.id, "", {
        userId: alice.id,
        scope: { type: "public" },
      })

      expect(results.results.length).toBe(1)
      expect(results.results[0].content).toBe("Public message")
    })

    test("private scope should return messages from current private stream and public streams", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      await addUserToWorkspace(pool, alice.id, workspace.id)

      const publicChannel = await createTestStream(pool, workspace.id, { visibility: "public" })
      await createTestMessage(pool, publicChannel.id, alice.id, "Public message")

      const privateChannel1 = await createTestStream(pool, workspace.id, { visibility: "private" })
      await addUserToStream(pool, alice.id, privateChannel1.id)
      await createTestMessage(pool, privateChannel1.id, alice.id, "Private message 1")

      const privateChannel2 = await createTestStream(pool, workspace.id, { visibility: "private" })
      await addUserToStream(pool, alice.id, privateChannel2.id)
      await createTestMessage(pool, privateChannel2.id, alice.id, "Private message 2")

      // Scope to privateChannel1 - should see public + privateChannel1, not privateChannel2
      const results = await searchService.search(workspace.id, "", {
        userId: alice.id,
        scope: { type: "private", currentStreamId: privateChannel1.id },
      })

      expect(results.results.length).toBe(2)
      const contents = results.results.map((r) => r.content)
      expect(contents).toContain("Public message")
      expect(contents).toContain("Private message 1")
      expect(contents).not.toContain("Private message 2")
    })

    test("user scope should return all messages the user has access to", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      await addUserToWorkspace(pool, alice.id, workspace.id)

      const publicChannel = await createTestStream(pool, workspace.id, { visibility: "public" })
      await createTestMessage(pool, publicChannel.id, alice.id, "Public message")

      const privateChannel = await createTestStream(pool, workspace.id, { visibility: "private" })
      await addUserToStream(pool, alice.id, privateChannel.id)
      await createTestMessage(pool, privateChannel.id, alice.id, "Private message")

      const thinkingSpace = await createTestThinkingSpace(pool, workspace.id, alice.id)
      await createTestMessage(pool, thinkingSpace.id, alice.id, "Thinking message")

      const results = await searchService.search(workspace.id, "", {
        userId: alice.id,
        scope: { type: "user" },
      })

      expect(results.results.length).toBe(3)
    })
  })

  describe("resolveUserNames", () => {
    test("should resolve user names to IDs", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice Smith" })
      const bob = await createTestUser(pool, { name: "Bob Jones" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      const resolved = await searchService.resolveUserNames(workspace.id, ["Alice", "Bob"])

      expect(resolved.get("Alice")).toBe(alice.id)
      expect(resolved.get("Bob")).toBe(bob.id)
    })

    test("should handle partial name matches", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice Östlund" })
      await addUserToWorkspace(pool, alice.id, workspace.id)

      const resolved = await searchService.resolveUserNames(workspace.id, ["Östlund"])

      expect(resolved.get("Östlund")).toBe(alice.id)
    })
  })

  describe("resolveStreamSlugs", () => {
    test("should resolve stream slugs to IDs", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      await addUserToWorkspace(pool, alice.id, workspace.id)

      const general = await createTestStream(pool, workspace.id, { slug: "general", name: "General" })
      const random = await createTestStream(pool, workspace.id, { slug: "random", name: "Random" })

      const resolved = await searchService.resolveStreamSlugs(workspace.id, ["general", "random"])

      expect(resolved.get("general")).toBe(general.id)
      expect(resolved.get("random")).toBe(random.id)
    })
  })
})
