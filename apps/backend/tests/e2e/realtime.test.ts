/**
 * Real-time E2E tests using socket.io-client.
 *
 * Tests verify that:
 * 1. Socket.io authentication works with session cookies
 * 2. Room authorization is enforced
 * 3. Events are broadcast correctly to the right rooms
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { io, Socket } from "socket.io-client"
import {
  TestClient,
  loginAs,
  createWorkspace,
  createScratchpad,
  createChannel,
  sendMessage,
  addReaction,
  removeReaction,
  updateMessage,
  deleteMessage,
} from "../client"

function getBaseUrl(): string {
  return process.env.TEST_BASE_URL || "http://localhost:3001"
}

/**
 * Creates an authenticated socket connection using the same session as the HTTP client.
 */
function createSocket(client: TestClient): Socket {
  // Extract cookies from the client's internal state via a test request
  // This is a bit hacky but works for testing
  const socket = io(getBaseUrl(), {
    // Socket.io-client will use these cookies for authentication
    extraHeaders: {
      Cookie: (client as any).cookies
        ? Array.from((client as any).cookies.entries())
            .map(([k, v]: [string, string]) => `${k}=${v}`)
            .join("; ")
        : "",
    },
    transports: ["websocket"],
    autoConnect: false,
  })
  return socket
}

/**
 * Waits for a specific event with optional timeout.
 */
function waitForEvent<T = unknown>(socket: Socket, eventName: string, timeoutMs: number = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler)
      reject(new Error(`Timeout waiting for event: ${eventName}`))
    }, timeoutMs)

    const handler = (data: T) => {
      clearTimeout(timeout)
      socket.off(eventName, handler)
      resolve(data)
    }

    socket.on(eventName, handler)
  })
}

/**
 * Waits for socket connection with error handling.
 */
async function connectSocket(socket: Socket, timeoutMs: number = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Socket connection timeout"))
    }, timeoutMs)

    socket.on("connect", () => {
      clearTimeout(timeout)
      resolve()
    })

    socket.on("connect_error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    socket.connect()
  })
}

describe("Real-time Events", () => {
  let client: TestClient
  let socket: Socket
  let workspaceId: string
  let userId: string

  beforeAll(async () => {
    client = new TestClient()
    const user = await loginAs(client, "realtime-test@example.com", "Realtime Test User")
    userId = user.id
    const workspace = await createWorkspace(client, "Realtime Test Workspace")
    workspaceId = workspace.id
  })

  beforeEach(async () => {
    socket = createSocket(client)
    await connectSocket(socket)
  })

  afterEach(() => {
    if (socket) {
      socket.disconnect()
    }
  })

  describe("Authentication", () => {
    test("should connect with valid session cookie", async () => {
      expect(socket.connected).toBe(true)
    })

    test("should reject connection without session cookie", async () => {
      const unauthSocket = io(getBaseUrl(), {
        transports: ["websocket"],
        autoConnect: false,
      })

      try {
        await connectSocket(unauthSocket)
        expect(true).toBe(false) // Should not reach here
      } catch (err: any) {
        expect(err.message).toContain("No session cookie")
      } finally {
        unauthSocket.disconnect()
      }
    })
  })

  describe("Room Authorization", () => {
    test("should allow joining workspace room when member", async () => {
      // If join fails, an error event is emitted within ~50ms
      // We wait for either an error or a short timeout (no error = success)
      const errorPromise = waitForEvent(socket, "error", 500).catch(() => null)

      socket.emit("join", `ws:${workspaceId}`)

      const error = await errorPromise
      expect(error).toBeNull()
    })

    test("should reject joining workspace room when not member", async () => {
      // Create a second user who is not a member
      const otherClient = new TestClient()
      await loginAs(otherClient, "other-user@example.com", "Other User")
      const otherSocket = createSocket(otherClient)
      await connectSocket(otherSocket)

      try {
        const errorPromise = waitForEvent<{ message: string }>(otherSocket, "error", 2000)
        otherSocket.emit("join", `ws:${workspaceId}`)

        const error = await errorPromise
        expect(error.message).toContain("Not authorized")
      } finally {
        otherSocket.disconnect()
      }
    })

    test("should allow joining stream room when member", async () => {
      const stream = await createScratchpad(client, workspaceId)

      const errorPromise = waitForEvent(socket, "error", 500).catch(() => null)
      socket.emit("join", `ws:${workspaceId}:stream:${stream.id}`)

      const error = await errorPromise
      expect(error).toBeNull()
    })
  })

  describe("Message Events", () => {
    test("should receive message:created event in stream room", async () => {
      const stream = await createScratchpad(client, workspaceId)
      socket.emit("join", `ws:${workspaceId}:stream:${stream.id}`)

      const eventPromise = waitForEvent<{ event: any }>(socket, "message:created")

      await sendMessage(client, workspaceId, stream.id, "Hello, real-time!")

      const event = await eventPromise

      expect(event).toMatchObject({
        workspaceId,
        streamId: stream.id,
      })
      expect(event.event).toMatchObject({
        eventType: "message_created",
        actorId: userId,
      })
      expect(event.event.payload).toMatchObject({
        contentMarkdown: "Hello, real-time!",
      })
    })

    test("should receive message:edited event", async () => {
      const stream = await createScratchpad(client, workspaceId)
      socket.emit("join", `ws:${workspaceId}:stream:${stream.id}`)

      const message = await sendMessage(client, workspaceId, stream.id, "Original content")

      const eventPromise = waitForEvent<{ event: any }>(socket, "message:edited")

      await updateMessage(client, workspaceId, message.id, "Updated content")

      const event = await eventPromise

      expect(event).toMatchObject({
        workspaceId,
        streamId: stream.id,
      })
      expect(event.event.payload).toMatchObject({
        messageId: message.id,
        contentMarkdown: "Updated content",
      })
    })

    test("should receive message:deleted event", async () => {
      const stream = await createScratchpad(client, workspaceId)
      socket.emit("join", `ws:${workspaceId}:stream:${stream.id}`)

      const message = await sendMessage(client, workspaceId, stream.id, "To be deleted")

      const eventPromise = waitForEvent<{ messageId: string }>(socket, "message:deleted")

      await deleteMessage(client, workspaceId, message.id)

      const event = await eventPromise

      expect(event).toMatchObject({
        workspaceId,
        streamId: stream.id,
        messageId: message.id,
      })
    })
  })

  describe("Reaction Events", () => {
    test("should receive reaction:added event", async () => {
      const stream = await createScratchpad(client, workspaceId)
      socket.emit("join", `ws:${workspaceId}:stream:${stream.id}`)

      const message = await sendMessage(client, workspaceId, stream.id, "React to me")

      const eventPromise = waitForEvent<{ emoji: string; userId: string }>(socket, "reaction:added")

      await addReaction(client, workspaceId, message.id, "👍")

      const event = await eventPromise

      expect(event).toMatchObject({
        workspaceId,
        streamId: stream.id,
        messageId: message.id,
        // Emoji gets normalized to shortcode format
        emoji: ":+1:",
        userId,
      })
    })

    test("should receive reaction:removed event", async () => {
      const stream = await createScratchpad(client, workspaceId)
      socket.emit("join", `ws:${workspaceId}:stream:${stream.id}`)

      const message = await sendMessage(client, workspaceId, stream.id, "Unreact from me")
      await addReaction(client, workspaceId, message.id, "❤️")

      const eventPromise = waitForEvent<{ emoji: string; userId: string }>(socket, "reaction:removed")

      await removeReaction(client, workspaceId, message.id, "❤️")

      const event = await eventPromise

      expect(event).toMatchObject({
        workspaceId,
        streamId: stream.id,
        messageId: message.id,
        // Emoji gets normalized to shortcode format
        emoji: ":heart:",
        userId,
      })
    })
  })

  describe("Stream Events", () => {
    test("should receive stream:created event in workspace room", async () => {
      socket.emit("join", `ws:${workspaceId}`)

      const eventPromise = waitForEvent<{ stream: any }>(socket, "stream:created")

      const stream = await createChannel(client, workspaceId, `test-channel-${Date.now()}`)

      const event = await eventPromise

      expect(event).toMatchObject({
        workspaceId,
        streamId: stream.id,
      })
      expect(event.stream).toMatchObject({
        id: stream.id,
        type: "channel",
      })
    })

    test("should receive stream:updated event in workspace room", async () => {
      const stream = await createScratchpad(client, workspaceId)

      socket.emit("join", `ws:${workspaceId}`)

      const eventPromise = waitForEvent<{ stream: any }>(socket, "stream:updated")

      // Update companion mode triggers stream:updated
      await client.patch(`/api/workspaces/${workspaceId}/streams/${stream.id}/companion`, {
        companionMode: "off",
      })

      const event = await eventPromise

      expect(event).toMatchObject({
        workspaceId,
        streamId: stream.id,
      })
      expect(event.stream.companionMode).toBe("off")
    })
  })

  describe("Room Scoping", () => {
    test("should not receive events for streams not joined", async () => {
      const stream1 = await createScratchpad(client, workspaceId)
      const stream2 = await createScratchpad(client, workspaceId)

      // Disable companion mode for stream2 to prevent companion job dispatch
      await client.patch(`/api/workspaces/${workspaceId}/streams/${stream2.id}/companion`, {
        companionMode: "off",
      })

      // Only join stream1
      socket.emit("join", `ws:${workspaceId}:stream:${stream1.id}`)

      // Send message to stream1 - should receive both user message and companion response
      const event1Promise = waitForEvent<{ event: any }>(socket, "message:created")
      const companionPromise = waitForEvent<{ event: any }>(socket, "message:created")
      await sendMessage(client, workspaceId, stream1.id, "Message to stream 1")
      const event1 = await event1Promise
      expect(event1.streamId).toBe(stream1.id)
      // Wait for companion response before testing stream2
      const companionEvent = await companionPromise
      expect(companionEvent.streamId).toBe(stream1.id)

      // Send message to stream2 - should NOT receive (not joined)
      // To verify nothing is received, we use a short timeout
      const noEventPromise = waitForEvent(socket, "message:created", 300).catch(() => "no-event")
      await sendMessage(client, workspaceId, stream2.id, "Message to stream 2")
      const result = await noEventPromise
      expect(result).toBe("no-event")
    })

    test("should receive workspace events even if not in stream room", async () => {
      // Join workspace room only
      socket.emit("join", `ws:${workspaceId}`)

      const eventPromise = waitForEvent<{ stream: any }>(socket, "stream:created")

      await createScratchpad(client, workspaceId)

      const event = await eventPromise
      expect(event.workspaceId).toBe(workspaceId)
    })

    test("should not receive workspace events if only in stream room", async () => {
      const existingStream = await createScratchpad(client, workspaceId)

      // Only join stream room, not workspace room
      socket.emit("join", `ws:${workspaceId}:stream:${existingStream.id}`)

      // To verify nothing is received, we use a short timeout
      const noEventPromise = waitForEvent(socket, "stream:created", 300).catch(() => "no-event")

      // Create new stream - should NOT receive in stream room
      await createScratchpad(client, workspaceId)

      const result = await noEventPromise
      expect(result).toBe("no-event")
    })
  })

  describe("Multi-client Scenarios", () => {
    test("should broadcast events to multiple clients in same room", async () => {
      const stream = await createScratchpad(client, workspaceId)

      // Create a second authenticated client/socket
      const client2 = new TestClient()
      await loginAs(client2, "realtime-user2@example.com", "User 2")
      // User 2 needs to be added to workspace - for now, create their own workspace
      // and we'll test with the first user's socket

      // Connect both sockets to same stream room
      const socket2 = createSocket(client)
      await connectSocket(socket2)

      try {
        socket.emit("join", `ws:${workspaceId}:stream:${stream.id}`)
        socket2.emit("join", `ws:${workspaceId}:stream:${stream.id}`)

        const event1Promise = waitForEvent<{ event: any }>(socket, "message:created")
        const event2Promise = waitForEvent<{ event: any }>(socket2, "message:created")

        await sendMessage(client, workspaceId, stream.id, "Broadcast test")

        const [event1, event2] = await Promise.all([event1Promise, event2Promise])

        expect(event1.event.payload.contentMarkdown).toBe("Broadcast test")
        expect(event2.event.payload.contentMarkdown).toBe("Broadcast test")
      } finally {
        socket2.disconnect()
      }
    })
  })
})
