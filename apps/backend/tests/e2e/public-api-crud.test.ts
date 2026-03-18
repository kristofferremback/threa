/**
 * E2E tests for public API v1 — CRUD endpoints.
 *
 * Run with: bun test --preload ./tests/setup.ts tests/e2e/public-api-crud.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test"
import { TestClient, loginAs, createWorkspace, createChannel, sendMessage } from "../client"

const testRunId = Math.random().toString(36).substring(7)
const testEmail = (name: string) => `${name}-crud-${testRunId}@test.com`

const TEST_ORG_ID = `org_crud_${testRunId}`

// API keys with various scopes (stub auth parses these)
const ALL_SCOPES_KEY = `test__${TEST_ORG_ID}__streams:read,messages:read,messages:write,users:read`
const STREAMS_READ_KEY = `test__${TEST_ORG_ID}__streams:read`
const MESSAGES_READ_KEY = `test__${TEST_ORG_ID}__messages:read`
const MESSAGES_WRITE_KEY = `test__${TEST_ORG_ID}__messages:write`
const USERS_READ_KEY = `test__${TEST_ORG_ID}__users:read`
const NO_SCOPE_KEY = `test__${TEST_ORG_ID}__messages:search`
// Different permissions string → stub resolves to a different key ID
const SECOND_WRITE_KEY = `test__${TEST_ORG_ID}__messages:write,messages:read`

// Stub API key service returns "Test API Key" as the name for all test keys
const STUB_API_KEY_NAME = "Test API Key"

interface TestContext {
  workspaceId: string
  publicChannelId: string
  publicChannelSlug: string
  privateChannelId: string
  publicMessageId: string
  publicMessageSequence: string
  userId: string
  userName: string
}

const baseUrl = () => process.env.TEST_BASE_URL || "http://localhost:3001"

function apiGet(path: string, apiKey: string) {
  return fetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  })
}

function apiPost(path: string, body: unknown, apiKey: string) {
  return fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
}

function apiPatch(path: string, body: unknown, apiKey: string) {
  return fetch(`${baseUrl()}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
}

function apiDelete(path: string, apiKey: string) {
  return fetch(`${baseUrl()}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  })
}

async function setupTestWorkspace(): Promise<TestContext> {
  const client = new TestClient()
  const user = await loginAs(client, testEmail("setup"), `CrudUser ${testRunId}`)
  const workspace = await createWorkspace(client, `CRUD WS ${testRunId}`)

  // Set org ID for API key matching
  await client.post(`/api/dev/workspaces/${workspace.id}/set-org-id`, { orgId: TEST_ORG_ID })

  const slug = `pub-crud-${testRunId}`
  const publicChannel = await createChannel(client, workspace.id, slug, "public")
  const privateChannel = await createChannel(client, workspace.id, `priv-crud-${testRunId}`, "private")

  const msg = await sendMessage(client, workspace.id, publicChannel.id, `Test message ${testRunId}`)

  // Get workspace user ID
  const { data: bootstrapData } = await client.get<{
    data: { users: Array<{ id: string; name: string; workosUserId: string }> }
  }>(`/api/workspaces/${workspace.id}/bootstrap`)
  const wsUser = bootstrapData.data.users[0]

  return {
    workspaceId: workspace.id,
    publicChannelId: publicChannel.id,
    publicChannelSlug: slug,
    privateChannelId: privateChannel.id,
    publicMessageId: msg.id,
    publicMessageSequence: msg.sequence,
    userId: wsUser.id,
    userName: wsUser.name,
  }
}

describe("Public API v1 — CRUD Endpoints", () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupTestWorkspace()
  })

  describe("List Streams", () => {
    test("should return accessible streams", async () => {
      const res = await apiGet(`/api/v1/workspaces/${ctx.workspaceId}/streams`, STREAMS_READ_KEY)
      expect(res.status).toBe(200)

      const body = (await res.json()) as { data: Array<{ id: string; type: string; visibility: string }> }
      expect(body.data.length).toBeGreaterThanOrEqual(1)

      // Public channel should be accessible
      const pub = body.data.find((s) => s.id === ctx.publicChannelId)
      expect(pub).toBeDefined()
      expect(pub!.visibility).toBe("public")

      // Private channel should NOT be accessible (no grant)
      const priv = body.data.find((s) => s.id === ctx.privateChannelId)
      expect(priv).toBeUndefined()
    })

    test("should filter by type", async () => {
      const res = await apiGet(`/api/v1/workspaces/${ctx.workspaceId}/streams?type=channel`, STREAMS_READ_KEY)
      expect(res.status).toBe(200)

      const body = (await res.json()) as { data: Array<{ type: string }> }
      for (const stream of body.data) {
        expect(stream.type).toBe("channel")
      }
    })

    test("should search by name", async () => {
      const res = await apiGet(
        `/api/v1/workspaces/${ctx.workspaceId}/streams?query=pub-crud-${testRunId}`,
        STREAMS_READ_KEY
      )
      expect(res.status).toBe(200)

      const body = (await res.json()) as { data: Array<{ id: string }> }
      expect(body.data.length).toBeGreaterThanOrEqual(1)
      expect(body.data.some((s) => s.id === ctx.publicChannelId)).toBe(true)
    })

    test("should return #slug as displayName for channels", async () => {
      const res = await apiGet(`/api/v1/workspaces/${ctx.workspaceId}/streams`, STREAMS_READ_KEY)
      expect(res.status).toBe(200)

      const body = (await res.json()) as { data: Array<{ id: string; displayName: string; slug: string }> }
      const pub = body.data.find((s) => s.id === ctx.publicChannelId)
      expect(pub).toBeDefined()
      expect(pub!.displayName).toBe(`#${ctx.publicChannelSlug}`)
      expect(pub!.slug).toBe(ctx.publicChannelSlug)
    })

    test("should return 403 without streams:read scope", async () => {
      const res = await apiGet(`/api/v1/workspaces/${ctx.workspaceId}/streams`, NO_SCOPE_KEY)
      expect(res.status).toBe(403)
    })
  })

  describe("Read Messages", () => {
    test("should return messages from accessible stream", async () => {
      const res = await apiGet(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        MESSAGES_READ_KEY
      )
      expect(res.status).toBe(200)

      const body = (await res.json()) as {
        data: Array<{ id: string; content: string; sequence: string }>
        hasMore: boolean
      }
      expect(body.data.length).toBeGreaterThanOrEqual(1)
      expect(typeof body.hasMore).toBe("boolean")

      const msg = body.data.find((m) => m.id === ctx.publicMessageId)
      expect(msg).toBeDefined()
      expect(msg!.content).toContain(testRunId)
    })

    test("should paginate with before cursor", async () => {
      // Use a large sequence to get all messages before it
      const res = await apiGet(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages?before=999999999`,
        MESSAGES_READ_KEY
      )
      expect(res.status).toBe(200)

      const body = (await res.json()) as { data: Array<{ sequence: string }> }
      expect(body.data.length).toBeGreaterThanOrEqual(1)
    })

    test("should paginate with after cursor", async () => {
      // Use sequence 0 to get all messages after it
      const res = await apiGet(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages?after=0`,
        MESSAGES_READ_KEY
      )
      expect(res.status).toBe(200)

      const body = (await res.json()) as { data: Array<{ sequence: string }> }
      expect(body.data.length).toBeGreaterThanOrEqual(1)
    })

    test("should return 403 for inaccessible stream", async () => {
      const res = await apiGet(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.privateChannelId}/messages`,
        MESSAGES_READ_KEY
      )
      expect(res.status).toBe(403)
    })

    test("should return 403 without messages:read scope", async () => {
      const res = await apiGet(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        NO_SCOPE_KEY
      )
      expect(res.status).toBe(403)
    })
  })

  describe("Send Message", () => {
    test("should create a bot message with name from API key", async () => {
      const res = await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        { content: `Bot message ${testRunId}` },
        MESSAGES_WRITE_KEY
      )
      expect(res.status).toBe(201)

      const body = (await res.json()) as {
        data: {
          id: string
          authorId: string
          authorType: string
          authorDisplayName: string
          content: string
        }
      }
      expect(body.data.authorType).toBe("bot")
      expect(body.data.authorDisplayName).toBe(STUB_API_KEY_NAME)
      expect(body.data.authorId).toMatch(/^bot_/)
      expect(body.data.content).toContain(`Bot message ${testRunId}`)
    })

    test("should resolve bot display name in listMessages", async () => {
      // Send a bot message
      await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        { content: `List test ${testRunId}` },
        MESSAGES_WRITE_KEY
      )

      // Fetch messages and verify authorDisplayName is resolved for bot messages
      const res = await apiGet(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        ALL_SCOPES_KEY
      )
      expect(res.status).toBe(200)

      const body = (await res.json()) as {
        data: Array<{ authorType: string; authorDisplayName: string | null; content: string }>
      }

      // The bot message should have authorDisplayName resolved
      const botMsg = body.data.find((m) => m.content.includes(`List test ${testRunId}`))
      expect(botMsg).toBeDefined()
      expect(botMsg!.authorDisplayName).toBe(STUB_API_KEY_NAME)

      // User messages should have null authorDisplayName
      const userMsg = body.data.find((m) => m.authorType === "user")
      expect(userMsg).toBeDefined()
      expect(userMsg!.authorDisplayName).toBeNull()
    })

    test("should return 403 for inaccessible stream", async () => {
      const res = await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.privateChannelId}/messages`,
        { content: "test" },
        MESSAGES_WRITE_KEY
      )
      expect(res.status).toBe(403)
    })

    test("should return 403 without messages:write scope", async () => {
      const res = await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        { content: "test" },
        NO_SCOPE_KEY
      )
      expect(res.status).toBe(403)
    })

    test("should return 400 for empty content", async () => {
      const res = await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        { content: "" },
        MESSAGES_WRITE_KEY
      )
      expect(res.status).toBe(400)
    })
  })

  describe("Update Message", () => {
    let botMessageId: string

    beforeAll(async () => {
      // Create a bot message to update
      const res = await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        { content: `To update ${testRunId}` },
        MESSAGES_WRITE_KEY
      )
      const body = (await res.json()) as { data: { id: string } }
      botMessageId = body.data.id
    })

    test("should update own bot message", async () => {
      const res = await apiPatch(
        `/api/v1/workspaces/${ctx.workspaceId}/messages/${botMessageId}`,
        { content: `Updated content ${testRunId}` },
        MESSAGES_WRITE_KEY
      )
      expect(res.status).toBe(200)

      const body = (await res.json()) as { data: { content: string; editedAt: string | null } }
      expect(body.data.content).toContain(`Updated content ${testRunId}`)
      expect(body.data.editedAt).not.toBeNull()
    })

    test("should return 403 when updating message created by different API key", async () => {
      // botMessageId was created by MESSAGES_WRITE_KEY; SECOND_WRITE_KEY has a
      // different stub key ID (different permissions string → different ID)
      const res = await apiPatch(
        `/api/v1/workspaces/${ctx.workspaceId}/messages/${botMessageId}`,
        { content: "hacked" },
        SECOND_WRITE_KEY
      )
      expect(res.status).toBe(403)
    })

    test("should return 403 when updating message created by a user (not via API)", async () => {
      const res = await apiPatch(
        `/api/v1/workspaces/${ctx.workspaceId}/messages/${ctx.publicMessageId}`,
        { content: "hacked" },
        MESSAGES_WRITE_KEY
      )
      expect(res.status).toBe(403)
    })

    test("should return 404 for non-existent message", async () => {
      const res = await apiPatch(
        `/api/v1/workspaces/${ctx.workspaceId}/messages/msg_nonexistent_12345`,
        { content: "nope" },
        MESSAGES_WRITE_KEY
      )
      expect(res.status).toBe(404)
    })

    test("should return 404 when updating a soft-deleted message", async () => {
      // Create and delete a message, then try updating
      const createRes = await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        { content: `Soft-delete update test ${testRunId}` },
        MESSAGES_WRITE_KEY
      )
      const createBody = (await createRes.json()) as { data: { id: string } }

      await apiDelete(`/api/v1/workspaces/${ctx.workspaceId}/messages/${createBody.data.id}`, MESSAGES_WRITE_KEY)

      const res = await apiPatch(
        `/api/v1/workspaces/${ctx.workspaceId}/messages/${createBody.data.id}`,
        { content: "revived" },
        MESSAGES_WRITE_KEY
      )
      expect(res.status).toBe(404)
    })
  })

  describe("Delete Message", () => {
    let botMessageId: string

    beforeAll(async () => {
      // Create a bot message to delete
      const res = await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        { content: `To delete ${testRunId}` },
        MESSAGES_WRITE_KEY
      )
      const body = (await res.json()) as { data: { id: string } }
      botMessageId = body.data.id
    })

    test("should delete own bot message and return 204", async () => {
      const res = await apiDelete(`/api/v1/workspaces/${ctx.workspaceId}/messages/${botMessageId}`, MESSAGES_WRITE_KEY)
      expect(res.status).toBe(204)
    })

    test("should return 403 when deleting message created by different API key", async () => {
      // Create a message with MESSAGES_WRITE_KEY, try to delete with SECOND_WRITE_KEY
      const createRes = await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        { content: `Cross-key delete test ${testRunId}` },
        MESSAGES_WRITE_KEY
      )
      const createBody = (await createRes.json()) as { data: { id: string } }

      const res = await apiDelete(
        `/api/v1/workspaces/${ctx.workspaceId}/messages/${createBody.data.id}`,
        SECOND_WRITE_KEY
      )
      expect(res.status).toBe(403)
    })

    test("should return 403 when deleting message not created via API", async () => {
      const res = await apiDelete(
        `/api/v1/workspaces/${ctx.workspaceId}/messages/${ctx.publicMessageId}`,
        MESSAGES_WRITE_KEY
      )
      expect(res.status).toBe(403)
    })

    test("should return 404 when deleting an already-deleted message", async () => {
      // Create and delete a message, then try deleting again
      const createRes = await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        { content: `Double-delete test ${testRunId}` },
        MESSAGES_WRITE_KEY
      )
      const createBody = (await createRes.json()) as { data: { id: string } }

      const firstDelete = await apiDelete(
        `/api/v1/workspaces/${ctx.workspaceId}/messages/${createBody.data.id}`,
        MESSAGES_WRITE_KEY
      )
      expect(firstDelete.status).toBe(204)

      const secondDelete = await apiDelete(
        `/api/v1/workspaces/${ctx.workspaceId}/messages/${createBody.data.id}`,
        MESSAGES_WRITE_KEY
      )
      expect(secondDelete.status).toBe(404)
    })

    test("should return 404 for non-existent message", async () => {
      const res = await apiDelete(
        `/api/v1/workspaces/${ctx.workspaceId}/messages/msg_nonexistent_12345`,
        MESSAGES_WRITE_KEY
      )
      expect(res.status).toBe(404)
    })
  })

  describe("List Users", () => {
    test("should return workspace users", async () => {
      const res = await apiGet(`/api/v1/workspaces/${ctx.workspaceId}/users`, USERS_READ_KEY)
      expect(res.status).toBe(200)

      const body = (await res.json()) as {
        data: Array<{ id: string; name: string; email: string; role: string }>
      }
      expect(body.data.length).toBeGreaterThanOrEqual(1)

      const user = body.data.find((u) => u.id === ctx.userId)
      expect(user).toBeDefined()
      expect(user!.name).toBe(ctx.userName)
    })

    test("should search users by name", async () => {
      const res = await apiGet(`/api/v1/workspaces/${ctx.workspaceId}/users?query=CrudUser`, USERS_READ_KEY)
      expect(res.status).toBe(200)

      const body = (await res.json()) as { data: Array<{ id: string }> }
      expect(body.data.length).toBeGreaterThanOrEqual(1)
    })

    test("should return 403 without users:read scope", async () => {
      const res = await apiGet(`/api/v1/workspaces/${ctx.workspaceId}/users`, NO_SCOPE_KEY)
      expect(res.status).toBe(403)
    })
  })

  describe("Bootstrap includes bots", () => {
    test("should include bots array in workspace bootstrap after bot message is sent", async () => {
      // Ensure at least one bot exists by sending a message
      await apiPost(
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.publicChannelId}/messages`,
        { content: `Bootstrap bot test ${testRunId}` },
        MESSAGES_WRITE_KEY
      )

      // Fetch bootstrap as the authenticated user
      const client = new TestClient()
      await loginAs(client, testEmail("setup"), `CrudUser ${testRunId}`)
      const { data: bootstrapData } = await client.get<{
        data: { bots: Array<{ id: string; name: string; workspaceId: string }> }
      }>(`/api/workspaces/${ctx.workspaceId}/bootstrap`)

      expect(bootstrapData.data.bots).toBeDefined()
      expect(Array.isArray(bootstrapData.data.bots)).toBe(true)
      expect(bootstrapData.data.bots.length).toBeGreaterThanOrEqual(1)

      const bot = bootstrapData.data.bots[0]
      expect(bot.id).toMatch(/^bot_/)
      expect(bot.name).toBe(STUB_API_KEY_NAME)
      expect(bot.workspaceId).toBe(ctx.workspaceId)
    })
  })
})
