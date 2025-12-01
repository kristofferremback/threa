import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { StreamService } from "../stream-service"
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
} from "./test-helpers"

describe("StreamService", () => {
  let pool: Pool
  let streamService: StreamService

  beforeAll(async () => {
    pool = await getTestPool()
    streamService = new StreamService(pool)
  })

  afterAll(async () => {
    await closeTestPool()
  })

  beforeEach(async () => {
    await cleanupTestData(pool)
  })

  describe("createStream", () => {
    test("should create a public channel", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "General",
        slug: "general",
        visibility: "public",
      })

      expect(stream.id).toBeDefined()
      expect(stream.name).toBe("General")
      expect(stream.slug).toBe("general")
      expect(stream.streamType).toBe("channel")
      expect(stream.visibility).toBe("public")
    })

    test("should create a private channel", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "Secret",
        slug: "secret",
        visibility: "private",
      })

      expect(stream.visibility).toBe("private")
    })

    test("should create a thinking space", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "thinking_space",
        name: "My Thinking Space",
        visibility: "private",
      })

      expect(stream.streamType).toBe("thinking_space")
      expect(stream.visibility).toBe("private")
    })

    test("should add creator as owner member", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "Test Channel",
        slug: "test",
        visibility: "public",
      })

      const members = await streamService.getStreamMembers(stream.id)
      expect(members.length).toBe(1)
      expect(members[0].userId).toBe(user.id)
      expect(members[0].role).toBe("owner")
    })
  })

  describe("createEvent", () => {
    test("should create a message event", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "Test",
        slug: "test",
        visibility: "public",
      })

      const event = await streamService.createEvent({
        streamId: stream.id,
        actorId: user.id,
        eventType: "message",
        content: "Hello, world!",
      })

      expect(event.id).toBeDefined()
      expect(event.eventType).toBe("message")
      expect(event.content).toBe("Hello, world!")
      expect(event.actorId).toBe(user.id)
    })

    test("should create message with mentions", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: alice.id,
        streamType: "channel",
        name: "Test",
        slug: "test",
        visibility: "public",
      })

      const event = await streamService.createEvent({
        streamId: stream.id,
        actorId: alice.id,
        eventType: "message",
        content: "Hey @Bob!",
        mentions: [{ type: "user", id: bob.id, label: "Bob" }],
      })

      expect(event.mentions).toHaveLength(1)
      expect(event.mentions?.[0].id).toBe(bob.id)
    })
  })

  describe("getStreamEvents", () => {
    test("should return events in chronological order (oldest first)", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const stream = await createTestStream(pool, workspace.id, { visibility: "public" })
      await addUserToStream(pool, user.id, stream.id)

      // Create messages with different timestamps
      await createTestMessage(pool, stream.id, user.id, "First message", {
        createdAt: new Date("2024-01-01T10:00:00Z"),
      })
      await createTestMessage(pool, stream.id, user.id, "Second message", {
        createdAt: new Date("2024-01-01T11:00:00Z"),
      })
      await createTestMessage(pool, stream.id, user.id, "Third message", {
        createdAt: new Date("2024-01-01T12:00:00Z"),
      })

      const events = await streamService.getStreamEvents(stream.id, 10)

      expect(events.length).toBe(3)
      // Chronological order (oldest first)
      expect(events[0].content).toBe("First message")
      expect(events[1].content).toBe("Second message")
      expect(events[2].content).toBe("Third message")
    })

    test("should respect limit parameter", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const stream = await createTestStream(pool, workspace.id, { visibility: "public" })
      await addUserToStream(pool, user.id, stream.id)

      for (let i = 0; i < 10; i++) {
        await createTestMessage(pool, stream.id, user.id, `Message ${i}`)
      }

      const events = await streamService.getStreamEvents(stream.id, 5)
      expect(events.length).toBe(5)
    })

    test("should not return deleted events", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "Test",
        slug: "test",
        visibility: "public",
      })

      const event1 = await streamService.createEvent({
        streamId: stream.id,
        actorId: user.id,
        eventType: "message",
        content: "Keep this",
      })

      const event2 = await streamService.createEvent({
        streamId: stream.id,
        actorId: user.id,
        eventType: "message",
        content: "Delete this",
      })

      await streamService.deleteEvent(event2.id, user.id)

      const events = await streamService.getStreamEvents(stream.id, 10)
      // Filter to only message events (exclude stream_created)
      const messageEvents = events.filter((e) => e.eventType === "message")
      expect(messageEvents.length).toBe(1)
      expect(messageEvents[0].id).toBe(event1.id)
    })
  })

  describe("createThreadFromEvent", () => {
    test("should create a thread from an event", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const channel = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "General",
        slug: "general",
        visibility: "public",
      })

      const rootEvent = await streamService.createEvent({
        streamId: channel.id,
        actorId: user.id,
        eventType: "message",
        content: "This will start a thread",
      })

      const result = await streamService.createThreadFromEvent(rootEvent.id, user.id)

      expect(result.stream.streamType).toBe("thread")
      expect(result.stream.parentStreamId).toBe(channel.id)
      expect(result.stream.branchedFromEventId).toBe(rootEvent.id)
      expect(result.stream.visibility).toBe("inherit")
    })

    test("should return existing thread if already exists", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const channel = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "General",
        slug: "general",
        visibility: "public",
      })

      const rootEvent = await streamService.createEvent({
        streamId: channel.id,
        actorId: user.id,
        eventType: "message",
        content: "This will start a thread",
      })

      const result1 = await streamService.createThreadFromEvent(rootEvent.id, user.id)
      const result2 = await streamService.createThreadFromEvent(rootEvent.id, user.id)

      expect(result1.stream.id).toBe(result2.stream.id)
    })
  })

  describe("joinStream and leaveStream", () => {
    test("should allow user to join public stream", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const joiner = await createTestUser(pool, { name: "Joiner" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, joiner.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "Public Channel",
        slug: "public",
        visibility: "public",
      })

      const result = await streamService.joinStream(stream.id, joiner.id)

      expect(result.stream.id).toBe(stream.id)
      expect(result.event.eventType).toBe("member_joined")

      const members = await streamService.getStreamMembers(stream.id)
      expect(members.length).toBe(2)
      expect(members.some((m) => m.userId === joiner.id)).toBe(true)
    })

    test("should allow user to leave stream", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const member = await createTestUser(pool, { name: "Member" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, member.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "Test",
        slug: "test",
        visibility: "public",
      })

      await streamService.joinStream(stream.id, member.id)
      await streamService.leaveStream(stream.id, member.id)

      const members = await streamService.getStreamMembers(stream.id)
      expect(members.some((m) => m.userId === member.id)).toBe(false)
    })
  })

  describe("checkStreamAccess", () => {
    test("should allow member to access stream", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "Test",
        slug: "test",
        visibility: "public",
      })

      const access = await streamService.checkStreamAccess(stream.id, user.id)

      expect(access.hasAccess).toBe(true)
      expect(access.canPost).toBe(true)
      expect(access.isMember).toBe(true)
    })

    test("should allow non-member to read public stream but not post", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const viewer = await createTestUser(pool, { name: "Viewer" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, viewer.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "Public",
        slug: "public",
        visibility: "public",
      })

      const access = await streamService.checkStreamAccess(stream.id, viewer.id)

      expect(access.hasAccess).toBe(true)
      expect(access.canPost).toBe(false)
      expect(access.isMember).toBe(false)
    })

    test("should deny non-member access to private stream", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const outsider = await createTestUser(pool, { name: "Outsider" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, outsider.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "Private",
        slug: "private",
        visibility: "private",
      })

      const access = await streamService.checkStreamAccess(stream.id, outsider.id)

      expect(access.hasAccess).toBe(false)
      expect(access.canPost).toBe(false)
      expect(access.isMember).toBe(false)
    })

    test("should allow member access to private stream", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const member = await createTestUser(pool, { name: "Member" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, member.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "Private",
        slug: "private",
        visibility: "private",
      })

      await streamService.addMember(stream.id, member.id, owner.id)

      const access = await streamService.checkStreamAccess(stream.id, member.id)

      expect(access.hasAccess).toBe(true)
      expect(access.canPost).toBe(true)
      expect(access.isMember).toBe(true)
    })

    test("should allow parent channel member to access inherited thread", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const member = await createTestUser(pool, { name: "Member" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, member.id, workspace.id)

      const channel = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "General",
        slug: "general",
        visibility: "public",
      })

      // Create a message and thread BEFORE member joins channel
      const rootEvent = await streamService.createEvent({
        streamId: channel.id,
        actorId: owner.id,
        eventType: "message",
        content: "Starting a thread",
      })

      const { stream: thread } = await streamService.createThreadFromEvent(rootEvent.id, owner.id)

      // Now add member to channel (after thread was created)
      await streamService.joinStream(channel.id, member.id)

      // Member should have access through parent channel membership (not direct thread membership)
      const access = await streamService.checkStreamAccess(thread.id, member.id)

      expect(access.hasAccess).toBe(true)
      expect(access.canPost).toBe(true)
      expect(access.inheritedFrom).toBe(channel.id)
    })

    test("should allow thinking space owner to access threads within their thinking space", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      await addUserToWorkspace(pool, owner.id, workspace.id)

      // Create thinking space (owner becomes member automatically)
      const thinkingSpace = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "thinking_space",
        name: "My Space",
        visibility: "private",
      })

      // Create a message in the thinking space
      const rootEvent = await streamService.createEvent({
        streamId: thinkingSpace.id,
        actorId: owner.id,
        eventType: "message",
        content: "A thought to branch from",
      })

      // Create thread from the message
      const { stream: thread } = await streamService.createThreadFromEvent(rootEvent.id, owner.id)

      // Owner should have access to thread through thinking space membership
      const access = await streamService.checkStreamAccess(thread.id, owner.id)

      expect(access.hasAccess).toBe(true)
      expect(access.canPost).toBe(true)
    })

    test("should deny non-owner access to threads within private thinking space", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const outsider = await createTestUser(pool, { name: "Outsider" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, outsider.id, workspace.id)

      // Create thinking space (owner only)
      const thinkingSpace = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "thinking_space",
        name: "Private Space",
        visibility: "private",
      })

      // Create a message and thread
      const rootEvent = await streamService.createEvent({
        streamId: thinkingSpace.id,
        actorId: owner.id,
        eventType: "message",
        content: "Private thought",
      })

      const { stream: thread } = await streamService.createThreadFromEvent(rootEvent.id, owner.id)

      // Outsider should NOT have access
      const access = await streamService.checkStreamAccess(thread.id, outsider.id)

      expect(access.hasAccess).toBe(false)
    })

    test("should traverse nested threads to find root channel access", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const member = await createTestUser(pool, { name: "Member" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, member.id, workspace.id)

      // Create channel
      const channel = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "General",
        slug: "general",
        visibility: "public",
      })

      // Create first level thread BEFORE member joins
      const msg1 = await streamService.createEvent({
        streamId: channel.id,
        actorId: owner.id,
        eventType: "message",
        content: "Starting thread 1",
      })
      const { stream: thread1 } = await streamService.createThreadFromEvent(msg1.id, owner.id)

      // Create second level thread (nested) BEFORE member joins
      const msg2 = await streamService.createEvent({
        streamId: thread1.id,
        actorId: owner.id,
        eventType: "message",
        content: "Starting nested thread 2",
      })
      const { stream: thread2 } = await streamService.createThreadFromEvent(msg2.id, owner.id)

      // Now add member to channel (AFTER threads were created)
      await streamService.joinStream(channel.id, member.id)

      // Member should have access through channel membership (2 levels deep)
      // They are NOT a direct member of thread2 since they joined after it was created
      const access = await streamService.checkStreamAccess(thread2.id, member.id)

      expect(access.hasAccess).toBe(true)
      expect(access.canPost).toBe(true)
      expect(access.inheritedFrom).toBe(channel.id)
    })

    test("should return stream not found for non-existent stream", async () => {
      const user = await createTestUser(pool)

      const access = await streamService.checkStreamAccess("non_existent_stream_id", user.id)

      expect(access.hasAccess).toBe(false)
      expect(access.reason).toBe("Stream not found")
    })

    test("should allow read-only access to threads in public channels for non-members", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const viewer = await createTestUser(pool, { name: "Viewer" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, viewer.id, workspace.id)

      // Create PUBLIC channel
      const channel = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "Public",
        slug: "public",
        visibility: "public",
      })

      // Create thread (visibility: inherit)
      const msg = await streamService.createEvent({
        streamId: channel.id,
        actorId: owner.id,
        eventType: "message",
        content: "Thread starter",
      })
      const { stream: thread } = await streamService.createThreadFromEvent(msg.id, owner.id)

      // Viewer is NOT a member of channel or thread
      // Should have read-only access since parent channel is public
      const access = await streamService.checkStreamAccess(thread.id, viewer.id)

      expect(access.hasAccess).toBe(true)
      expect(access.canPost).toBe(false)
    })

    test("should deny access to threads in private channels for non-members", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const outsider = await createTestUser(pool, { name: "Outsider" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, outsider.id, workspace.id)

      // Create PRIVATE channel
      const channel = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "Private",
        slug: "private",
        visibility: "private",
      })

      // Create thread (visibility: inherit)
      const msg = await streamService.createEvent({
        streamId: channel.id,
        actorId: owner.id,
        eventType: "message",
        content: "Private thread",
      })
      const { stream: thread } = await streamService.createThreadFromEvent(msg.id, owner.id)

      // Outsider should NOT have access
      const access = await streamService.checkStreamAccess(thread.id, outsider.id)

      expect(access.hasAccess).toBe(false)
      expect(access.reason).toBe("This is a private channel")
    })
  })

  describe("checkEventAccess", () => {
    test("should allow member to reply to event via event access check", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const member = await createTestUser(pool, { name: "Member" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, member.id, workspace.id)

      const channel = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "General",
        slug: "general",
        visibility: "public",
      })

      await streamService.joinStream(channel.id, member.id)

      const event = await streamService.createEvent({
        streamId: channel.id,
        actorId: owner.id,
        eventType: "message",
        content: "Root message for pending thread",
      })

      // Check access via event ID (simulating pending thread scenario)
      const access = await streamService.checkEventAccess(event.id, member.id)

      expect(access.hasAccess).toBe(true)
      expect(access.canPost).toBe(true)
    })

    test("should deny non-member access to reply to event in private channel", async () => {
      const workspace = await createTestWorkspace(pool)
      const owner = await createTestUser(pool, { name: "Owner" })
      const outsider = await createTestUser(pool, { name: "Outsider" })
      await addUserToWorkspace(pool, owner.id, workspace.id)
      await addUserToWorkspace(pool, outsider.id, workspace.id)

      const channel = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: owner.id,
        streamType: "channel",
        name: "Private",
        slug: "private",
        visibility: "private",
      })

      const event = await streamService.createEvent({
        streamId: channel.id,
        actorId: owner.id,
        eventType: "message",
        content: "Private message",
      })

      // Outsider should NOT have access
      const access = await streamService.checkEventAccess(event.id, outsider.id)

      expect(access.hasAccess).toBe(false)
    })

    test("should return event not found for non-existent event", async () => {
      const user = await createTestUser(pool)

      const access = await streamService.checkEventAccess("non_existent_event_id", user.id)

      expect(access.hasAccess).toBe(false)
      expect(access.reason).toBe("Event not found")
    })
  })

  describe("cross-post access", () => {
    test("should allow access via cross-post from another channel", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      // Alice creates Channel 1 with a thread
      const channel1 = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: alice.id,
        streamType: "channel",
        name: "Channel 1",
        slug: "channel-1",
        visibility: "private",
      })

      const msg1 = await streamService.createEvent({
        streamId: channel1.id,
        actorId: alice.id,
        eventType: "message",
        content: "Thread starter in channel 1",
      })
      const { stream: thread1 } = await streamService.createThreadFromEvent(msg1.id, alice.id)

      // Bob creates Channel 2
      const channel2 = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: bob.id,
        streamType: "channel",
        name: "Channel 2",
        slug: "channel-2",
        visibility: "private",
      })

      // Bob creates a message in channel 2, then cross-posts it to thread1
      const msg2 = await streamService.createEvent({
        streamId: channel2.id,
        actorId: bob.id,
        eventType: "message",
        content: "Message from channel 2",
      })

      // Cross-post msg2 into thread1 (requires alice to have access to add content)
      await streamService.createEvent({
        streamId: thread1.id,
        actorId: alice.id,
        eventType: "shared",
        originalEventId: msg2.id,
      })

      // Now Bob should have access to thread1 via the cross-post
      const access = await streamService.checkStreamAccess(thread1.id, bob.id)

      expect(access.hasAccess).toBe(true)
      expect(access.canPost).toBe(true)
      // Access was granted via cross-post from channel2
      expect(access.inheritedFrom).toBe(channel2.id)
    })
  })

  describe("editEvent", () => {
    test("should allow user to edit their own message", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "Test",
        slug: "test",
        visibility: "public",
      })

      const event = await streamService.createEvent({
        streamId: stream.id,
        actorId: user.id,
        eventType: "message",
        content: "Original content",
      })

      const edited = await streamService.editEvent(event.id, user.id, "Edited content")

      expect(edited.content).toBe("Edited content")
      expect(edited.editedAt).toBeDefined()
    })

    test("should not allow user to edit another users message", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      const stream = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: alice.id,
        streamType: "channel",
        name: "Test",
        slug: "test",
        visibility: "public",
      })

      await streamService.joinStream(stream.id, bob.id)

      const event = await streamService.createEvent({
        streamId: stream.id,
        actorId: alice.id,
        eventType: "message",
        content: "Alice's message",
      })

      await expect(streamService.editEvent(event.id, bob.id, "Hacked!")).rejects.toThrow()
    })
  })

  describe("getStream and getStreamBySlug", () => {
    test("should get stream by ID", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const created = await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "Test",
        slug: "test",
        visibility: "public",
      })

      const fetched = await streamService.getStream(created.id)

      expect(fetched).not.toBeNull()
      expect(fetched?.id).toBe(created.id)
      expect(fetched?.name).toBe("Test")
    })

    test("should get stream by slug", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      await streamService.createStream({
        workspaceId: workspace.id,
        creatorId: user.id,
        streamType: "channel",
        name: "General",
        slug: "general",
        visibility: "public",
      })

      const fetched = await streamService.getStreamBySlug(workspace.id, "general")

      expect(fetched).not.toBeNull()
      expect(fetched?.slug).toBe("general")
    })

    test("should return null for non-existent stream", async () => {
      const fetched = await streamService.getStream("non-existent-id")
      expect(fetched).toBeNull()
    })
  })

  describe("DM creation", () => {
    test("should create a DM between two users", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      const result = await streamService.createDM(workspace.id, alice.id, [alice.id, bob.id])

      expect(result.stream.streamType).toBe("dm")
      expect(result.stream.visibility).toBe("private")
      expect(result.created).toBe(true)

      const members = await streamService.getStreamMembers(result.stream.id)
      expect(members.length).toBe(2)
      expect(members.some((m) => m.userId === alice.id)).toBe(true)
      expect(members.some((m) => m.userId === bob.id)).toBe(true)
    })

    test("should return existing DM if already exists", async () => {
      const workspace = await createTestWorkspace(pool)
      const alice = await createTestUser(pool, { name: "Alice" })
      const bob = await createTestUser(pool, { name: "Bob" })
      await addUserToWorkspace(pool, alice.id, workspace.id)
      await addUserToWorkspace(pool, bob.id, workspace.id)

      const result1 = await streamService.createDM(workspace.id, alice.id, [alice.id, bob.id])
      const result2 = await streamService.createDM(workspace.id, bob.id, [alice.id, bob.id])

      expect(result1.stream.id).toBe(result2.stream.id)
      expect(result1.created).toBe(true)
      expect(result2.created).toBe(false)
    })
  })
})
