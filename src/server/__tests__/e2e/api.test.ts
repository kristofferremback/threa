import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { getTestServer, type TestServerContext } from "./test-server"
import {
  createTestWorkspace,
  addUserToWorkspace,
  createTestStream,
  addUserToStream,
  createTestMessage,
} from "../../services/__tests__/test-helpers"

describe("E2E: HTTP API", () => {
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

  describe("Authentication", () => {
    test("should reject unauthenticated requests to protected endpoints", async () => {
      // Use redirect: "manual" to not follow redirects
      const response = await fetch(`${server.baseUrl}/api/workspace/ws_123/streams/stream_123/events`, {
        redirect: "manual",
      })
      // Should redirect to login (302)
      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toContain("/api/auth/login")
    })

    test("should return user info on /api/auth/me", async () => {
      const { user, sessionToken } = await server.createAuthenticatedUser({
        name: "Alice",
        email: "alice@test.com",
      })

      const response = await server.fetch("/api/auth/me", { sessionToken })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.id).toBe(user.id)
      expect(data.email).toBe("alice@test.com")
    })
  })

  describe("Stream Events (Messages)", () => {
    test("should create and retrieve a message", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user, sessionToken } = await server.createAuthenticatedUser({ name: "Alice" })
      await addUserToWorkspace(server.pool, user.id, workspace.id)
      await addUserToStream(server.pool, user.id, channel.id)

      // Create message
      const createResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ content: "Hello, world!" }),
        },
      )

      expect(createResponse.status).toBe(201)
      const event = await createResponse.json()
      expect(event.content).toBe("Hello, world!")
      expect(event.actorId).toBe(user.id)

      // Retrieve messages
      const getResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        { sessionToken },
      )

      expect(getResponse.status).toBe(200)
      const { events } = await getResponse.json()
      expect(events.some((e: any) => e.content === "Hello, world!")).toBe(true)
    })

    test("should edit own message", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user, sessionToken } = await server.createAuthenticatedUser({ name: "Alice" })
      await addUserToWorkspace(server.pool, user.id, workspace.id)
      await addUserToStream(server.pool, user.id, channel.id)

      // Create message
      const createResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ content: "Original" }),
        },
      )

      const event = await createResponse.json()

      // Edit message (uses PATCH, not PUT)
      const editResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events/${event.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ content: "Edited" }),
        },
      )

      expect(editResponse.status).toBe(200)
      const edited = await editResponse.json()
      expect(edited.content).toBe("Edited")
      expect(edited.editedAt).toBeDefined()
    })

    test("should not edit another users message", async () => {
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

      // Alice creates message
      const createResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken: aliceToken,
          body: JSON.stringify({ content: "Alice's message" }),
        },
      )

      const event = await createResponse.json()

      // Bob tries to edit (uses PATCH)
      const editResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events/${event.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          sessionToken: bobToken,
          body: JSON.stringify({ content: "Hacked!" }),
        },
      )

      expect(editResponse.status).toBe(403)
    })

    test("should delete own message", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user, sessionToken } = await server.createAuthenticatedUser({ name: "Alice" })
      await addUserToWorkspace(server.pool, user.id, workspace.id)
      await addUserToStream(server.pool, user.id, channel.id)

      // Create message
      const createResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ content: "Delete me" }),
        },
      )

      const event = await createResponse.json()

      // Delete message (returns 204 No Content)
      const deleteResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events/${event.id}`,
        {
          method: "DELETE",
          sessionToken,
        },
      )

      expect(deleteResponse.status).toBe(204)

      // Verify it's gone from listing
      const getResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        { sessionToken },
      )

      const { events } = await getResponse.json()
      expect(events.find((e: any) => e.id === event.id)).toBeUndefined()
    })
  })

  describe("Stream Access Control", () => {
    test("should allow reading public channel without membership", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const publicChannel = await createTestStream(server.pool, workspace.id, {
        slug: "public-channel",
        visibility: "public",
      })

      const { user: owner } = await server.createAuthenticatedUser({ name: "Owner" })
      const { user: viewer, sessionToken: viewerToken } = await server.createAuthenticatedUser({
        name: "Viewer",
      })

      await addUserToWorkspace(server.pool, owner.id, workspace.id)
      await addUserToWorkspace(server.pool, viewer.id, workspace.id)
      await addUserToStream(server.pool, owner.id, publicChannel.id)

      // Owner creates a message
      await createTestMessage(server.pool, publicChannel.id, owner.id, "Public message")

      // Viewer (not a member) can read
      const response = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${publicChannel.id}/events`,
        { sessionToken: viewerToken },
      )

      expect(response.status).toBe(200)
      const { events } = await response.json()
      expect(events.some((e: any) => e.content === "Public message")).toBe(true)
    })

    test("should deny reading private channel without membership", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const privateChannel = await createTestStream(server.pool, workspace.id, {
        slug: "private-channel",
        visibility: "private",
      })

      const { user: owner } = await server.createAuthenticatedUser({ name: "Owner" })
      const { user: outsider, sessionToken: outsiderToken } = await server.createAuthenticatedUser({
        name: "Outsider",
      })

      await addUserToWorkspace(server.pool, owner.id, workspace.id)
      await addUserToWorkspace(server.pool, outsider.id, workspace.id)
      await addUserToStream(server.pool, owner.id, privateChannel.id)

      // Owner creates a message
      await createTestMessage(server.pool, privateChannel.id, owner.id, "Secret message")

      // Outsider cannot read
      const response = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${privateChannel.id}/events`,
        { sessionToken: outsiderToken },
      )

      expect(response.status).toBe(403)
    })

    test("should deny posting to public channel without membership", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const publicChannel = await createTestStream(server.pool, workspace.id, {
        slug: "public-channel",
        visibility: "public",
      })

      const { user: owner } = await server.createAuthenticatedUser({ name: "Owner" })
      const { user: viewer, sessionToken: viewerToken } = await server.createAuthenticatedUser({
        name: "Viewer",
      })

      await addUserToWorkspace(server.pool, owner.id, workspace.id)
      await addUserToWorkspace(server.pool, viewer.id, workspace.id)
      await addUserToStream(server.pool, owner.id, publicChannel.id)

      // Viewer tries to post
      const response = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${publicChannel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken: viewerToken,
          body: JSON.stringify({ content: "I shouldn't be able to post" }),
        },
      )

      expect(response.status).toBe(403)
    })
  })

  describe("Channel Operations", () => {
    test("should join a public channel", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user: owner } = await server.createAuthenticatedUser({ name: "Owner" })
      const { user: joiner, sessionToken: joinerToken } = await server.createAuthenticatedUser({
        name: "Joiner",
      })

      await addUserToWorkspace(server.pool, owner.id, workspace.id)
      await addUserToWorkspace(server.pool, joiner.id, workspace.id)
      await addUserToStream(server.pool, owner.id, channel.id)

      // Join
      const joinResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/join`,
        {
          method: "POST",
          sessionToken: joinerToken,
        },
      )

      expect(joinResponse.status).toBe(200)

      // Now can post
      const postResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken: joinerToken,
          body: JSON.stringify({ content: "I joined!" }),
        },
      )

      expect(postResponse.status).toBe(201)
    })

    test("should leave a channel", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user, sessionToken } = await server.createAuthenticatedUser({ name: "User" })
      await addUserToWorkspace(server.pool, user.id, workspace.id)
      await addUserToStream(server.pool, user.id, channel.id)

      // Leave
      const leaveResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/leave`,
        {
          method: "POST",
          sessionToken,
        },
      )

      expect(leaveResponse.status).toBe(200)

      // Can still read (public) but not post
      const postResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ content: "Can I still post?" }),
        },
      )

      expect(postResponse.status).toBe(403)
    })
  })

  describe("Threads", () => {
    test("should create a thread from a message", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user, sessionToken } = await server.createAuthenticatedUser({ name: "Alice" })
      await addUserToWorkspace(server.pool, user.id, workspace.id)
      await addUserToStream(server.pool, user.id, channel.id)

      // Create root message
      const createResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ content: "Let's discuss this in a thread" }),
        },
      )

      const rootEvent = await createResponse.json()

      // Create thread
      const threadResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/thread`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ eventId: rootEvent.id }),
        },
      )

      expect(threadResponse.status).toBe(201)
      const { stream: thread } = await threadResponse.json()
      expect(thread.streamType).toBe("thread")
      expect(thread.parentStreamId).toBe(channel.id)
      expect(thread.branchedFromEventId).toBe(rootEvent.id)
    })

    test("should post to thread and update reply count", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user, sessionToken } = await server.createAuthenticatedUser({ name: "Alice" })
      await addUserToWorkspace(server.pool, user.id, workspace.id)
      await addUserToStream(server.pool, user.id, channel.id)

      // Create root message
      const createResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ content: "Start thread" }),
        },
      )

      const rootEvent = await createResponse.json()

      // Create thread
      const threadResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${channel.id}/thread`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ eventId: rootEvent.id }),
        },
      )

      const { stream: thread } = await threadResponse.json()

      // Post replies
      for (let i = 1; i <= 3; i++) {
        await server.fetch(`/api/workspace/${workspace.id}/streams/${thread.id}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          sessionToken,
          body: JSON.stringify({ content: `Reply ${i}` }),
        })
      }

      // Get thread events and verify count
      const eventsResponse = await server.fetch(
        `/api/workspace/${workspace.id}/streams/${thread.id}/events`,
        { sessionToken },
      )

      const { events } = await eventsResponse.json()
      // Should have 3 reply messages
      const replyMessages = events.filter((e: any) => e.eventType === "message")
      expect(replyMessages.length).toBe(3)
    })
  })

  describe("Search", () => {
    // Note: This test requires Ollama to be running with nomic-embed-text model.
    // The test server calls checkOllamaHealth() to enable local embeddings.
    // Skipped in CI via SKIP_OLLAMA_TESTS env var.
    const testFn = process.env.SKIP_OLLAMA_TESTS ? test.skip : test
    testFn("should search messages", async () => {
      const workspace = await createTestWorkspace(server.pool)
      const channel = await createTestStream(server.pool, workspace.id, {
        slug: "general",
        visibility: "public",
      })

      const { user, sessionToken } = await server.createAuthenticatedUser({ name: "Alice" })
      await addUserToWorkspace(server.pool, user.id, workspace.id)
      await addUserToStream(server.pool, user.id, channel.id)

      // Create messages via API (to ensure search_vector trigger fires)
      await server.fetch(`/api/workspace/${workspace.id}/streams/${channel.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        sessionToken,
        body: JSON.stringify({ content: "The quick brown fox" }),
      })
      await server.fetch(`/api/workspace/${workspace.id}/streams/${channel.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        sessionToken,
        body: JSON.stringify({ content: "jumps over the lazy dog" }),
      })
      await server.fetch(`/api/workspace/${workspace.id}/streams/${channel.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        sessionToken,
        body: JSON.stringify({ content: "Hello world" }),
      })

      // Search (uses 'query' param, not 'q' due to stream-routes taking precedence)
      const response = await server.fetch(
        `/api/workspace/${workspace.id}/search?query=fox`,
        { sessionToken },
      )

      expect(response.status).toBe(200)
      const { results } = await response.json()
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.some((r: any) => r.content.includes("fox"))).toBe(true)
    })
  })
})
