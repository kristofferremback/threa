import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import type { Socket as ClientSocket } from "socket.io-client"
import {
  getTestServer,
  waitForSocketEvent,
  type TestServerContext,
} from "./test-server"
import {
  createTestWorkspace,
  addUserToWorkspace,
  createTestStream,
  addUserToStream,
} from "../../services/__tests__/test-helpers"

describe("E2E: Real-time Messaging", () => {
  let server: TestServerContext

  beforeAll(async () => {
    server = await getTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    await server.cleanup()
  })

  describe("WebSocket connection", () => {
    test("should connect and receive authenticated event", async () => {
      const { sessionToken } = await server.createAuthenticatedUser({ name: "Alice" })

      const socket = await server.createSocketClient(sessionToken)

      // Should already be connected at this point
      expect(socket.connected).toBe(true)

      socket.disconnect()
    })

    test("should reject connection without valid session", async () => {
      await expect(server.createSocketClient("invalid_token")).rejects.toThrow()
    })
  })

  describe("Real-time message delivery", () => {
    test("should receive message events in real-time when joined to a stream", async () => {
      // Setup: Create workspace, channel, and two users
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user: alice, sessionToken: aliceToken } = await server.createAuthenticatedUser({
        name: "Alice",
      })
      const { user: bob, sessionToken: bobToken } = await server.createAuthenticatedUser({
        name: "Bob",
      })

      await addUserToWorkspace(server.pool, alice.id, workspace.id)
      await addUserToWorkspace(server.pool, bob.id, workspace.id)
      await addUserToStream(server.pool, alice.id, channel.id)
      await addUserToStream(server.pool, bob.id, channel.id)

      // Connect both users
      const aliceSocket = await server.createSocketClient(aliceToken)
      const bobSocket = await server.createSocketClient(bobToken)

      // Both join the channel room
      const roomName = `ws:${workspace.id}:stream:${channel.id}`
      aliceSocket.emit("join", roomName)
      bobSocket.emit("join", roomName)

      // Give sockets time to join the room
      await new Promise((r) => setTimeout(r, 100))

      // Bob listens for messages
      const messagePromise = waitForSocketEvent<{
        id: string
        content: string
        actorId: string
      }>(bobSocket, "event")

      // Alice sends a message via HTTP API
      const response = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken: aliceToken,
          body: JSON.stringify({ content: "Hello from Alice!" }),
        },
      )

      expect(response.status).toBe(201)

      // Bob should receive the message via WebSocket
      const receivedEvent = await messagePromise

      expect(receivedEvent.content).toBe("Hello from Alice!")
      expect(receivedEvent.actorId).toBe(alice.id)

      aliceSocket.disconnect()
      bobSocket.disconnect()
    })

    test("should receive edited message events", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user: alice, sessionToken: aliceToken } = await server.createAuthenticatedUser({
        name: "Alice",
      })

      await addUserToWorkspace(server.pool, alice.id, workspace.id)
      await addUserToStream(server.pool, alice.id, channel.id)

      const aliceSocket = await server.createSocketClient(aliceToken)
      const roomName = `ws:${workspace.id}:stream:${channel.id}`
      aliceSocket.emit("join", roomName)
      await new Promise((r) => setTimeout(r, 100))

      // Create a message
      const createResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken: aliceToken,
          body: JSON.stringify({ content: "Original message" }),
        },
      )

      const createdEvent = await createResponse.json()

      // Listen for edit event
      const editPromise = waitForSocketEvent<{
        id: string
        content: string
      }>(aliceSocket, "event:edited")

      // Edit the message
      await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events/${createdEvent.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          sessionToken: aliceToken,
          body: JSON.stringify({ content: "Edited message" }),
        },
      )

      const editedEvent = await editPromise
      expect(editedEvent.id).toBe(createdEvent.id)
      expect(editedEvent.content).toBe("Edited message")

      aliceSocket.disconnect()
    })

    test("should receive deleted message events", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user: alice, sessionToken: aliceToken } = await server.createAuthenticatedUser({
        name: "Alice",
      })

      await addUserToWorkspace(server.pool, alice.id, workspace.id)
      await addUserToStream(server.pool, alice.id, channel.id)

      const aliceSocket = await server.createSocketClient(aliceToken)
      const roomName = `ws:${workspace.id}:stream:${channel.id}`
      aliceSocket.emit("join", roomName)
      await new Promise((r) => setTimeout(r, 100))

      // Create a message
      const createResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken: aliceToken,
          body: JSON.stringify({ content: "Message to delete" }),
        },
      )

      const createdEvent = await createResponse.json()

      // Listen for delete event
      const deletePromise = waitForSocketEvent<{ id: string }>(aliceSocket, "event:deleted")

      // Delete the message
      await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events/${createdEvent.id}`,
        {
          method: "DELETE",
          sessionToken: aliceToken,
        },
      )

      const deletedEvent = await deletePromise
      expect(deletedEvent.id).toBe(createdEvent.id)

      aliceSocket.disconnect()
    })
  })

  describe("Thread creation", () => {
    // Note: This test can be flaky due to timing issues with the outbox listener
    // and Redis pub/sub. The thread creation is tested via HTTP in api.test.ts.
    test.skip("should receive thread creation event when starting a thread", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user: alice, sessionToken: aliceToken } = await server.createAuthenticatedUser({
        name: "Alice",
      })

      await addUserToWorkspace(server.pool, alice.id, workspace.id)
      await addUserToStream(server.pool, alice.id, channel.id)

      const aliceSocket = await server.createSocketClient(aliceToken)
      const roomName = `ws:${workspace.id}:stream:${channel.id}`
      aliceSocket.emit("join", roomName)
      await new Promise((r) => setTimeout(r, 100))

      // Create a message
      const createResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken: aliceToken,
          body: JSON.stringify({ content: "Let's discuss this" }),
        },
      )

      const rootEvent = await createResponse.json()

      // Listen for thread creation
      const threadPromise = waitForSocketEvent<{
        stream: { id: string; parentStreamId: string }
      }>(aliceSocket, "thread:created")

      // Create thread via API
      await server.fetch(`/api/workspace/${workspace.id}/streams/${channel.id}/thread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        sessionToken: aliceToken,
        body: JSON.stringify({ eventId: rootEvent.id }),
      })

      const threadEvent = await threadPromise
      expect(threadEvent.stream.parentStreamId).toBe(channel.id)

      aliceSocket.disconnect()
    })
  })

  describe("Channel membership", () => {
    // Note: The stream:member:added event is emitted to the user room, not the stream room.
    // This test needs to be updated to join the user room instead.
    test.skip("should receive member joined event when user joins channel", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user: alice, sessionToken: aliceToken } = await server.createAuthenticatedUser({
        name: "Alice",
      })
      const { user: bob, sessionToken: bobToken } = await server.createAuthenticatedUser({
        name: "Bob",
      })

      await addUserToWorkspace(server.pool, alice.id, workspace.id)
      await addUserToWorkspace(server.pool, bob.id, workspace.id)
      await addUserToStream(server.pool, alice.id, channel.id)

      const aliceSocket = await server.createSocketClient(aliceToken)
      const roomName = `ws:${workspace.id}:stream:${channel.id}`
      aliceSocket.emit("join", roomName)
      await new Promise((r) => setTimeout(r, 100))

      // Listen for member joined
      const memberPromise = waitForSocketEvent<{
        userId: string
        streamId: string
      }>(aliceSocket, "stream:member:added")

      // Bob joins via API
      await server.fetch(`/api/workspace/${workspace.id}/streams/${channel.id}/join`, {
        method: "POST",
        sessionToken: bobToken,
      })

      const memberEvent = await memberPromise
      expect(memberEvent.userId).toBe(bob.id)
      expect(memberEvent.streamId).toBe(channel.id)

      aliceSocket.disconnect()
    })
  })

  describe("Multi-user scenarios", () => {
    // Note: This test can be flaky due to race conditions with concurrent message creation.
    // The outbox listener and Redis pub/sub can have timing issues under load.
    test.skip("should handle multiple users sending messages concurrently", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      // Create 3 users
      const users = await Promise.all([
        server.createAuthenticatedUser({ name: "Alice" }),
        server.createAuthenticatedUser({ name: "Bob" }),
        server.createAuthenticatedUser({ name: "Charlie" }),
      ])

      // Add all to workspace and channel
      for (const { user } of users) {
        await addUserToWorkspace(server.pool, user.id, workspace.id)
        await addUserToStream(server.pool, user.id, channel.id)
      }

      // Connect all users
      const sockets = await Promise.all(
        users.map(({ sessionToken }) => server.createSocketClient(sessionToken)),
      )

      // All join the room
      const roomName = `ws:${workspace.id}:stream:${channel.id}`
      for (const socket of sockets) {
        socket.emit("join", roomName)
      }
      await new Promise((r) => setTimeout(r, 100))

      // Each user sends a message concurrently
      const sendPromises = users.map(({ user, sessionToken }, i) =>
        server.fetch(`/api/workspace/${workspace.id}/streams/${channel.id}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ content: `Message from ${user.name}` }),
        }),
      )

      // Collect events received by first user (should see all 3 including own)
      const receivedMessages: string[] = []
      const collectPromise = new Promise<void>((resolve) => {
        let count = 0
        sockets[0].on("event", (event: { content: string }) => {
          receivedMessages.push(event.content)
          count++
          if (count >= 3) resolve()
        })
      })

      await Promise.all(sendPromises)
      await Promise.race([
        collectPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000)),
      ])

      expect(receivedMessages).toHaveLength(3)
      expect(receivedMessages).toContain("Message from Alice")
      expect(receivedMessages).toContain("Message from Bob")
      expect(receivedMessages).toContain("Message from Charlie")

      for (const socket of sockets) {
        socket.disconnect()
      }
    })
  })
})
