/**
 * E2E tests for public API v1 — message search with API key auth.
 *
 * Run with: bun test --preload ./tests/setup.ts tests/e2e/public-api-search.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test"
import { TestClient, loginAs, createWorkspace, createChannel, sendMessage } from "../client"

const testRunId = Math.random().toString(36).substring(7)
const testEmail = (name: string) => `${name}-pubapi-${testRunId}@test.com`

const TEST_ORG_ID = `org_test_${testRunId}`
const VALID_API_KEY = `test__${TEST_ORG_ID}__messages:search`
const NO_SCOPE_API_KEY = `test__${TEST_ORG_ID}__streams:list`
const WRONG_ORG_API_KEY = `test__org_wrong__messages:search`

interface TestContext {
  workspaceId: string
  publicChannelId: string
  privateChannelId: string
  keyword: string
}

async function setupTestWorkspace(): Promise<TestContext> {
  const client = new TestClient()
  await loginAs(client, testEmail("setup"), "Setup User")
  const workspace = await createWorkspace(client, `PubAPI WS ${testRunId}`)

  // Set the workspace org ID for API key matching
  await client.post(`/api/dev/workspaces/${workspace.id}/set-org-id`, { orgId: TEST_ORG_ID })

  const publicChannel = await createChannel(client, workspace.id, `public-${testRunId}`, "public")
  const privateChannel = await createChannel(client, workspace.id, `private-${testRunId}`, "private")

  const keyword = `testword${testRunId}`
  await sendMessage(client, workspace.id, publicChannel.id, `Public message about ${keyword}`)
  await sendMessage(client, workspace.id, privateChannel.id, `Private message about ${keyword}`)

  return {
    workspaceId: workspace.id,
    publicChannelId: publicChannel.id,
    privateChannelId: privateChannel.id,
    keyword,
  }
}

function publicApiRequest(workspaceId: string, body: unknown, apiKey: string) {
  const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3001"
  return fetch(`${baseUrl}/api/v1/workspaces/${workspaceId}/messages/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
}

describe("Public API v1 — Message Search", () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupTestWorkspace()
  })

  describe("Authentication", () => {
    test("should return 401 for missing Authorization header", async () => {
      const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3001"
      const res = await fetch(`${baseUrl}/api/v1/workspaces/${ctx.workspaceId}/messages/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      })
      expect(res.status).toBe(401)
    })

    test("should return 401 for invalid API key", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: "test" }, "invalid_key_value")
      expect(res.status).toBe(401)
    })

    test("should return 403 for API key from wrong organization", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: "test" }, WRONG_ORG_API_KEY)
      expect(res.status).toBe(403)
    })

    test("should return 403 for API key missing required scope", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: "test" }, NO_SCOPE_API_KEY)
      expect(res.status).toBe(403)
    })
  })

  describe("Search Results", () => {
    test("should return results from public channels", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: ctx.keyword }, VALID_API_KEY)
      expect(res.status).toBe(200)

      const data = (await res.json()) as { results: Array<{ streamId: string; content: string }> }
      expect(data.results.length).toBeGreaterThanOrEqual(1)

      const publicResults = data.results.filter((r) => r.streamId === ctx.publicChannelId)
      expect(publicResults.length).toBe(1)
      expect(publicResults[0].content).toContain(ctx.keyword)
    })

    test("should NOT return results from private channels without grant", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: ctx.keyword }, VALID_API_KEY)
      const data = (await res.json()) as { results: Array<{ streamId: string }> }

      const privateResults = data.results.filter((r) => r.streamId === ctx.privateChannelId)
      expect(privateResults.length).toBe(0)
    })
  })

  describe("Validation", () => {
    test("should return 400 for empty query", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: "" }, VALID_API_KEY)
      expect(res.status).toBe(400)
    })

    test("should return 400 for missing query", async () => {
      const res = await publicApiRequest(ctx.workspaceId, {}, VALID_API_KEY)
      expect(res.status).toBe(400)
    })

    test("should respect limit parameter", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: ctx.keyword, limit: 1 }, VALID_API_KEY)
      expect(res.status).toBe(200)

      const data = (await res.json()) as { results: unknown[] }
      expect(data.results.length).toBeLessThanOrEqual(1)
    })

    test("should reject limit above maximum", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: "test", limit: 100 }, VALID_API_KEY)
      expect(res.status).toBe(400)
    })
  })

  describe("Semantic Search", () => {
    test("should accept semantic flag and return results", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: ctx.keyword, semantic: true }, VALID_API_KEY)
      expect(res.status).toBe(200)

      const data = (await res.json()) as { results: Array<{ streamId: string }> }
      expect(data.results.length).toBeGreaterThanOrEqual(1)
    })

    test("should default to keyword-only search when semantic is false", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: ctx.keyword, semantic: false }, VALID_API_KEY)
      expect(res.status).toBe(200)

      const data = (await res.json()) as { results: Array<{ streamId: string }> }
      expect(data.results.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("Filters", () => {
    test("should filter by stream type", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: ctx.keyword, type: ["channel"] }, VALID_API_KEY)
      expect(res.status).toBe(200)

      const data = (await res.json()) as { results: Array<{ streamId: string }> }
      expect(data.results.length).toBeGreaterThanOrEqual(1)
    })

    test("should filter by specific streams", async () => {
      const res = await publicApiRequest(
        ctx.workspaceId,
        { query: ctx.keyword, streams: [ctx.publicChannelId] },
        VALID_API_KEY
      )
      expect(res.status).toBe(200)

      const data = (await res.json()) as { results: Array<{ streamId: string }> }
      for (const result of data.results) {
        expect(result.streamId).toBe(ctx.publicChannelId)
      }
    })

    test("should filter by date range", async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString()
      const res = await publicApiRequest(ctx.workspaceId, { query: ctx.keyword, after: futureDate }, VALID_API_KEY)
      expect(res.status).toBe(200)

      const data = (await res.json()) as { results: unknown[] }
      expect(data.results.length).toBe(0)
    })
  })

  describe("Response Format", () => {
    test("should return properly formatted results", async () => {
      const res = await publicApiRequest(ctx.workspaceId, { query: ctx.keyword }, VALID_API_KEY)
      const data = (await res.json()) as {
        results: Array<{
          id: string
          streamId: string
          content: string
          authorId: string
          authorType: string
          createdAt: string
          rank: number
        }>
      }

      expect(data).toHaveProperty("results")

      if (data.results.length > 0) {
        const result = data.results[0]
        expect(result).toHaveProperty("id")
        expect(result).toHaveProperty("streamId")
        expect(result).toHaveProperty("content")
        expect(result).toHaveProperty("authorId")
        expect(result).toHaveProperty("authorType")
        expect(result).toHaveProperty("createdAt")
        expect(result).toHaveProperty("rank")
      }
    })
  })
})
