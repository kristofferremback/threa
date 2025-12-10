/**
 * E2E API tests - black box testing via HTTP.
 *
 * Requires server running at localhost:3001 with USE_STUB_AUTH=true.
 * Run with: bun test tests/api.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test"
import {
  TestClient,
  loginAs,
  createWorkspace,
  createScratchpad,
  sendMessage,
  listMessages,
} from "./client"

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3001"

// Generate unique identifier for this test run to avoid collisions
const testRunId = Math.random().toString(36).substring(7)
const testEmail = (name: string) => `${name}-${testRunId}@test.com`

describe("API E2E Tests", () => {
  beforeAll(async () => {
    // Verify server is running
    try {
      const response = await fetch(`${BASE_URL}/health`)
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`)
      }
    } catch (error) {
      throw new Error(
        `Server not reachable at ${BASE_URL}. Start it with: cd apps/backend && bun run dev`
      )
    }
  })

  describe("Health", () => {
    test("should return ok", async () => {
      const response = await fetch(`${BASE_URL}/health`)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.status).toBe("ok")
    })
  })

  describe("Authentication", () => {
    test("should reject unauthenticated requests", async () => {
      const client = new TestClient()
      const { status } = await client.get("/api/workspaces")
      expect(status).toBe(401)
    })

    test("should login and access protected routes", async () => {
      const client = new TestClient()
      const user = await loginAs(client, testEmail("auth"), "Auth Test User")

      expect(user.id).toMatch(/^usr_/)
      expect(user.email).toBe(testEmail("auth"))

      // Verify session works
      const { status, data } = await client.get<{ id: string }>("/api/auth/me")
      expect(status).toBe(200)
      expect(data.id).toBe(user.id)
    })

    test("should maintain session across requests", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("session"), "Session Test")

      // Multiple requests should work
      const r1 = await client.get("/api/auth/me")
      const r2 = await client.get("/api/workspaces")

      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)
    })
  })

  describe("Workspaces", () => {
    test("should create and retrieve workspace", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("workspace"), "Workspace Test")

      const workspace = await createWorkspace(client, `Test Workspace ${testRunId}`)

      expect(workspace.id).toMatch(/^ws_/)
      expect(workspace.name).toBe(`Test Workspace ${testRunId}`)
      expect(workspace.slug).toMatch(/^test-workspace-/)

      // Retrieve it
      const { status, data } = await client.get<{ workspace: typeof workspace }>(
        `/api/workspaces/${workspace.id}`
      )
      expect(status).toBe(200)
      expect(data.workspace.id).toBe(workspace.id)
    })

    test("should list user workspaces", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("wslist"), "WS List Test")

      await createWorkspace(client, `List Test WS ${testRunId}`)

      const { status, data } = await client.get<{ workspaces: unknown[] }>(
        "/api/workspaces"
      )
      expect(status).toBe(200)
      expect(data.workspaces.length).toBeGreaterThan(0)
    })
  })

  describe("Scratchpads", () => {
    test("should create scratchpad with companion mode", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("scratchpad"), "Scratchpad Test")
      const workspace = await createWorkspace(client, `SP Test WS ${testRunId}`)

      const scratchpad = await createScratchpad(
        client,
        workspace.id,
        `My Scratchpad ${testRunId}`,
        "on"
      )

      expect(scratchpad.id).toMatch(/^stream_/)
      expect(scratchpad.type).toBe("scratchpad")
      expect(scratchpad.name).toBe(`My Scratchpad ${testRunId}`)
      expect(scratchpad.companionMode).toBe("on")
    })

    test("should list scratchpads in workspace", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("splist"), "SP List Test")
      const workspace = await createWorkspace(client, `SP List WS ${testRunId}`)

      await createScratchpad(client, workspace.id, `Pad 1 ${testRunId}`)
      await createScratchpad(client, workspace.id, `Pad 2 ${testRunId}`)

      const { status, data } = await client.get<{ streams: unknown[] }>(
        `/api/workspaces/${workspace.id}/scratchpads`
      )
      expect(status).toBe(200)
      expect(data.streams.length).toBe(2)
    })

    test("should update companion mode", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("companion"), "Companion Test")
      const workspace = await createWorkspace(client, `Companion WS ${testRunId}`)
      const scratchpad = await createScratchpad(
        client,
        workspace.id,
        `Companion Pad ${testRunId}`,
        "off"
      )

      expect(scratchpad.companionMode).toBe("off")

      const { status, data } = await client.patch<{ stream: { companionMode: string } }>(
        `/api/streams/${scratchpad.id}/companion`,
        { companionMode: "on" }
      )

      expect(status).toBe(200)
      expect(data.stream.companionMode).toBe("on")
    })
  })

  describe("Messages", () => {
    test("should send and retrieve messages", async () => {
      const client = new TestClient()
      const user = await loginAs(client, testEmail("messages"), "Messages Test")
      const workspace = await createWorkspace(client, `Msg WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, `Msg Pad ${testRunId}`)

      const message = await sendMessage(client, scratchpad.id, `Hello ${testRunId}!`)

      expect(message.id).toMatch(/^msg_/)
      expect(message.content).toBe(`Hello ${testRunId}!`)
      expect(message.sequence).toBe("1")
      expect(message.authorId).toBe(user.id)

      const messages = await listMessages(client, scratchpad.id)
      expect(messages.length).toBe(1)
      expect(messages[0].id).toBe(message.id)
    })

    test("should maintain message sequence", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("sequence"), "Sequence Test")
      const workspace = await createWorkspace(client, `Seq WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, `Seq Pad ${testRunId}`)

      const m1 = await sendMessage(client, scratchpad.id, "First")
      const m2 = await sendMessage(client, scratchpad.id, "Second")
      const m3 = await sendMessage(client, scratchpad.id, "Third")

      expect(m1.sequence).toBe("1")
      expect(m2.sequence).toBe("2")
      expect(m3.sequence).toBe("3")
    })

    test("should edit message", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("edit"), "Edit Test")
      const workspace = await createWorkspace(client, `Edit WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, `Edit Pad ${testRunId}`)
      const message = await sendMessage(client, scratchpad.id, "Original content")

      const { status, data } = await client.patch<{ message: { content: string } }>(
        `/api/messages/${message.id}`,
        { content: "Updated content" }
      )

      expect(status).toBe(200)
      expect(data.message.content).toBe("Updated content")
    })

    test("should delete message", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("delete"), "Delete Test")
      const workspace = await createWorkspace(client, `Del WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, `Del Pad ${testRunId}`)
      const message = await sendMessage(client, scratchpad.id, "To be deleted")

      const { status } = await client.delete(`/api/messages/${message.id}`)
      expect(status).toBe(204)

      // Verify message is no longer in the list (soft deleted)
      const messages = await listMessages(client, scratchpad.id)
      const found = messages.find((m) => m.id === message.id)
      expect(found).toBeUndefined()
    })
  })

  describe("Full Flow", () => {
    test("should complete entire user journey", async () => {
      const client = new TestClient()

      // 1. Login
      const user = await loginAs(client, testEmail("journey"), "Journey User")
      expect(user.id).toMatch(/^usr_/)

      // 2. Create workspace
      const workspace = await createWorkspace(client, `Journey WS ${testRunId}`)
      expect(workspace.id).toMatch(/^ws_/)

      // 3. Create scratchpad with AI companion
      const scratchpad = await createScratchpad(
        client,
        workspace.id,
        `My Ideas ${testRunId}`,
        "on"
      )
      expect(scratchpad.companionMode).toBe("on")

      // 4. Send messages
      const m1 = await sendMessage(client, scratchpad.id, "I need to plan my startup")
      const m2 = await sendMessage(client, scratchpad.id, "First step: validate the idea")
      const m3 = await sendMessage(client, scratchpad.id, "Second step: find customers")

      // 5. Verify all messages exist
      const messages = await listMessages(client, scratchpad.id)
      expect(messages.length).toBe(3)
      expect(messages.map((m) => m.content)).toEqual([
        "I need to plan my startup",
        "First step: validate the idea",
        "Second step: find customers",
      ])

      // 6. Edit a message
      await client.patch(`/api/messages/${m2.id}`, {
        content: "First step: talk to potential customers",
      })

      // 7. Verify edit
      const updatedMessages = await listMessages(client, scratchpad.id)
      expect(updatedMessages[1].content).toBe("First step: talk to potential customers")
    })
  })
})
