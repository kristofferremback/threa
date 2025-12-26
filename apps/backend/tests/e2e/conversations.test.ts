/**
 * Conversation API E2E Tests
 *
 * Tests verify:
 * 1. List conversations by stream endpoint
 * 2. Get conversation by ID endpoint
 * 3. Status filtering
 * 4. Error responses for not found
 *
 * Note: Conversations are created asynchronously by the boundary extraction
 * worker when messages are sent. Tests wait for conversations to appear.
 */

import { describe, test, expect } from "bun:test"
import {
  TestClient,
  loginAs,
  createWorkspace,
  createScratchpad,
  sendMessage,
  listConversations,
  getConversation,
} from "../client"

const testRunId = Math.random().toString(36).substring(7)
const testEmail = (name: string) => `${name}-${testRunId}@test.com`

/**
 * Wait for at least one conversation to appear in the stream.
 * The boundary extraction worker processes messages asynchronously.
 */
async function waitForConversations(
  client: TestClient,
  workspaceId: string,
  streamId: string,
  options?: { timeoutMs?: number; minCount?: number }
): Promise<void> {
  // Boundary extraction uses LLM which can be slow in CI - use 15s like companion tests
  const timeout = options?.timeoutMs ?? 15000
  const minCount = options?.minCount ?? 1
  const start = Date.now()

  while (Date.now() - start < timeout) {
    const conversations = await listConversations(client, workspaceId, streamId)
    if (conversations.length >= minCount) {
      return
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  throw new Error(`Timed out waiting for ${minCount} conversations after ${timeout}ms`)
}

describe("Conversation API E2E Tests", () => {
  describe("GET /api/workspaces/:workspaceId/streams/:streamId/conversations", () => {
    test("returns empty array for stream without conversations", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("conv-empty"), "Conv Empty Test")
      const workspace = await createWorkspace(client, `Conv Empty WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      const conversations = await listConversations(client, workspace.id, scratchpad.id)

      expect(conversations).toEqual([])
    })

    test("returns conversations after message is sent", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("conv-msg"), "Conv Msg Test")
      const workspace = await createWorkspace(client, `Conv Msg WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      await sendMessage(client, workspace.id, scratchpad.id, "Hello, this starts a conversation!")

      // Wait for boundary extraction to process
      await waitForConversations(client, workspace.id, scratchpad.id)

      const conversations = await listConversations(client, workspace.id, scratchpad.id)

      expect(conversations.length).toBeGreaterThanOrEqual(1)
      expect(conversations[0].id).toMatch(/^conv_/)
      expect(conversations[0].streamId).toBe(scratchpad.id)
      expect(conversations[0].workspaceId).toBe(workspace.id)
      expect(conversations[0].messageIds.length).toBeGreaterThanOrEqual(1)
      expect(conversations[0].status).toBe("active")
    })

    test("includes temporal staleness fields", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("conv-stale"), "Conv Stale Test")
      const workspace = await createWorkspace(client, `Conv Stale WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      await sendMessage(client, workspace.id, scratchpad.id, "Testing staleness fields")

      await waitForConversations(client, workspace.id, scratchpad.id)

      const conversations = await listConversations(client, workspace.id, scratchpad.id)
      const conv = conversations[0]

      // Temporal staleness should be 0 (fresh) since we just created it
      expect(typeof conv.temporalStaleness).toBe("number")
      expect(conv.temporalStaleness).toBe(0)

      // Effective completeness = completenessScore + temporalStaleness, capped at 7
      expect(typeof conv.effectiveCompleteness).toBe("number")
      expect(conv.effectiveCompleteness).toBe(conv.completenessScore + conv.temporalStaleness)
    })

    test("filters by status", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("conv-filter"), "Conv Filter Test")
      const workspace = await createWorkspace(client, `Conv Filter WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      await sendMessage(client, workspace.id, scratchpad.id, "Filter test message")
      await waitForConversations(client, workspace.id, scratchpad.id)

      // Filter for active conversations (which is the default status for new conversations)
      const activeConversations = await listConversations(client, workspace.id, scratchpad.id, {
        status: "active",
      })
      expect(activeConversations.length).toBeGreaterThanOrEqual(1)

      // Filter for resolved conversations (should be empty for new conversation)
      const resolvedConversations = await listConversations(client, workspace.id, scratchpad.id, {
        status: "resolved",
      })
      expect(resolvedConversations.length).toBe(0)
    })

    test("respects limit parameter", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("conv-limit"), "Conv Limit Test")
      const workspace = await createWorkspace(client, `Conv Limit WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      // Send multiple messages to create conversations
      await sendMessage(client, workspace.id, scratchpad.id, "First message topic A")
      await waitForConversations(client, workspace.id, scratchpad.id)

      const allConversations = await listConversations(client, workspace.id, scratchpad.id)
      const limitedConversations = await listConversations(client, workspace.id, scratchpad.id, {
        limit: 1,
      })

      expect(limitedConversations.length).toBeLessThanOrEqual(1)
      if (allConversations.length > 1) {
        expect(limitedConversations.length).toBeLessThan(allConversations.length)
      }
    })

    test("rejects invalid status parameter", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("conv-invalid"), "Conv Invalid Test")
      const workspace = await createWorkspace(client, `Conv Invalid WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      const { status, data } = await client.get<{ error: string }>(
        `/api/workspaces/${workspace.id}/streams/${scratchpad.id}/conversations?status=invalid`
      )

      expect(status).toBe(400)
      expect(data.error).toBe("Validation failed")
    })
  })

  describe("GET /api/workspaces/:workspaceId/conversations/:conversationId", () => {
    test("returns conversation by ID", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("conv-get"), "Conv Get Test")
      const workspace = await createWorkspace(client, `Conv Get WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      await sendMessage(client, workspace.id, scratchpad.id, "Get by ID test message")
      await waitForConversations(client, workspace.id, scratchpad.id)

      const conversations = await listConversations(client, workspace.id, scratchpad.id)
      const convId = conversations[0].id

      const conversation = await getConversation(client, workspace.id, convId)

      expect(conversation.id).toBe(convId)
      expect(conversation.streamId).toBe(scratchpad.id)
      expect(typeof conversation.temporalStaleness).toBe("number")
      expect(typeof conversation.effectiveCompleteness).toBe("number")
    })

    test("returns 404 for non-existent conversation", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("conv-404"), "Conv 404 Test")
      const workspace = await createWorkspace(client, `Conv 404 WS ${testRunId}`)

      const { status, data } = await client.get<{ error: string }>(
        `/api/workspaces/${workspace.id}/conversations/conv_nonexistent`
      )

      expect(status).toBe(404)
      expect(data.error).toBe("Conversation not found")
    })
  })
})
