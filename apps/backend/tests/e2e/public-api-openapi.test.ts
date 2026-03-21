/**
 * E2E tests for OpenAPI spec accuracy.
 *
 * Validates that the generated OpenAPI spec matches actual API behavior by:
 * 1. Calling every documented endpoint
 * 2. Validating response shapes against the route registry's Zod schemas
 * 3. Verifying status codes, content types, and error responses
 *
 * Run with: bun test --preload ./tests/setup.ts tests/e2e/public-api-openapi.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test"
import { TestClient, loginAs, createWorkspace, createChannel, sendMessage } from "../client"
import {
  PUBLIC_API_ROUTES,
  streamSchema,
  messageSchema,
  searchResultSchema,
  memberSchema,
  userSchema,
} from "../../src/features/public-api/routes"
import { readFileSync } from "fs"
import { resolve } from "path"
import { z } from "zod"

const testRunId = Math.random().toString(36).substring(7)
const testEmail = (name: string) => `${name}-openapi-${testRunId}@test.com`
const TEST_ORG_ID = `org_openapi_${testRunId}`

const ALL_SCOPES_KEY = `test__${TEST_ORG_ID}__streams:read,messages:read,messages:write,users:read,messages:search`

interface TestContext {
  workspaceId: string
  channelId: string
  messageId: string
  userId: string
}

const baseUrl = () => process.env.TEST_BASE_URL || "http://localhost:3001"

function apiRequest(method: string, path: string, apiKey: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
  if (body) headers["Content-Type"] = "application/json"
  return fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function setupTestWorkspace(): Promise<TestContext> {
  const client = new TestClient()
  const user = await loginAs(client, testEmail("setup"), `OpenAPIUser ${testRunId}`)
  const workspace = await createWorkspace(client, `OpenAPI WS ${testRunId}`)

  await client.post(`/api/dev/workspaces/${workspace.id}/set-org-id`, { orgId: TEST_ORG_ID })

  const channel = await createChannel(client, workspace.id, `oa-chan-${testRunId}`, "public")
  const msg = await sendMessage(client, workspace.id, channel.id, `OpenAPI test message ${testRunId}`)

  const { data: bootstrapData } = await client.get<{
    data: { users: Array<{ id: string }> }
  }>(`/api/workspaces/${workspace.id}/bootstrap`)

  return {
    workspaceId: workspace.id,
    channelId: channel.id,
    messageId: msg.id,
    userId: bootstrapData.data.users[0].id,
  }
}

describe("Public API — OpenAPI Spec Validation", () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupTestWorkspace()
  })

  test("openapi.json file exists and is valid JSON", () => {
    const specPath = resolve(import.meta.dirname!, "../../../../docs/public-api/openapi.json")
    const raw = readFileSync(specPath, "utf-8")
    const spec = JSON.parse(raw)
    expect(spec.openapi).toBe("3.0.3")
    expect(spec.info.title).toBe("Threa Public API")
  })

  test("spec covers all routes in the registry", () => {
    const specPath = resolve(import.meta.dirname!, "../../../../docs/public-api/openapi.json")
    const spec = JSON.parse(readFileSync(specPath, "utf-8"))

    for (const route of PUBLIC_API_ROUTES) {
      const pathObj = spec.paths[route.path]
      expect(pathObj).toBeDefined()
      expect(pathObj[route.method]).toBeDefined()
      expect(pathObj[route.method].operationId).toBe(route.operationId)
    }
  })

  test("spec declares correct scopes for each operation", () => {
    const specPath = resolve(import.meta.dirname!, "../../../../docs/public-api/openapi.json")
    const spec = JSON.parse(readFileSync(specPath, "utf-8"))

    for (const route of PUBLIC_API_ROUTES) {
      const op = spec.paths[route.path][route.method]
      const declaredScopes = op.security?.[0]?.apiKey ?? []
      expect(declaredScopes).toEqual(route.scopes)
    }
  })

  describe("Response shape validation", () => {
    test("GET /streams returns data matching streamSchema", async () => {
      const res = await apiRequest("GET", `/api/v1/workspaces/${ctx.workspaceId}/streams`, ALL_SCOPES_KEY)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.data).toBeArray()
      expect(body).toHaveProperty("hasMore")
      expect(body).toHaveProperty("cursor")

      for (const item of body.data) {
        const parsed = streamSchema.safeParse(item)
        expect(parsed.success).toBe(true)
      }
    })

    test("GET /streams/:streamId returns data matching streamSchema", async () => {
      const res = await apiRequest(
        "GET",
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.channelId}`,
        ALL_SCOPES_KEY
      )
      expect(res.status).toBe(200)

      const body = await res.json()
      const parsed = streamSchema.safeParse(body.data)
      expect(parsed.success).toBe(true)
    })

    test("GET /streams/:streamId/members returns data matching memberSchema", async () => {
      const res = await apiRequest(
        "GET",
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.channelId}/members`,
        ALL_SCOPES_KEY
      )
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.data).toBeArray()
      expect(body).toHaveProperty("hasMore")

      for (const item of body.data) {
        const parsed = memberSchema.safeParse(item)
        expect(parsed.success).toBe(true)
      }
    })

    test("GET /streams/:streamId/messages returns data matching messageSchema", async () => {
      const res = await apiRequest(
        "GET",
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.channelId}/messages`,
        ALL_SCOPES_KEY
      )
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.data).toBeArray()
      expect(body).toHaveProperty("hasMore")

      for (const item of body.data) {
        const parsed = messageSchema.safeParse(item)
        expect(parsed.success).toBe(true)
      }
    })

    test("POST /streams/:streamId/messages returns data matching messageSchema", async () => {
      const res = await apiRequest(
        "POST",
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.channelId}/messages`,
        ALL_SCOPES_KEY,
        { content: `OpenAPI send test ${testRunId}` }
      )
      expect(res.status).toBe(201)

      const body = await res.json()
      const parsed = messageSchema.safeParse(body.data)
      expect(parsed.success).toBe(true)

      // Use the created message for update/delete tests
      ctx.messageId = body.data.id
    })

    test("PATCH /messages/:messageId returns data matching messageSchema", async () => {
      // First send a message via API so we own it
      const sendRes = await apiRequest(
        "POST",
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.channelId}/messages`,
        ALL_SCOPES_KEY,
        { content: `Will be updated ${testRunId}` }
      )
      const sentMsg = (await sendRes.json()).data

      const res = await apiRequest(
        "PATCH",
        `/api/v1/workspaces/${ctx.workspaceId}/messages/${sentMsg.id}`,
        ALL_SCOPES_KEY,
        { content: `Updated content ${testRunId}` }
      )
      expect(res.status).toBe(200)

      const body = await res.json()
      const parsed = messageSchema.safeParse(body.data)
      expect(parsed.success).toBe(true)
      expect(body.data.content).toContain("Updated content")
    })

    test("DELETE /messages/:messageId returns 204", async () => {
      // Send a message to delete
      const sendRes = await apiRequest(
        "POST",
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.channelId}/messages`,
        ALL_SCOPES_KEY,
        { content: `Will be deleted ${testRunId}` }
      )
      const sentMsg = (await sendRes.json()).data

      const res = await apiRequest(
        "DELETE",
        `/api/v1/workspaces/${ctx.workspaceId}/messages/${sentMsg.id}`,
        ALL_SCOPES_KEY
      )
      expect(res.status).toBe(204)
    })

    test("POST /messages/search returns data matching searchResultSchema", async () => {
      const res = await apiRequest("POST", `/api/v1/workspaces/${ctx.workspaceId}/messages/search`, ALL_SCOPES_KEY, {
        query: "OpenAPI test message",
      })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.data).toBeArray()

      for (const item of body.data) {
        const parsed = searchResultSchema.safeParse(item)
        expect(parsed.success).toBe(true)
      }
    })

    test("GET /users returns data matching userSchema", async () => {
      const res = await apiRequest("GET", `/api/v1/workspaces/${ctx.workspaceId}/users`, ALL_SCOPES_KEY)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.data).toBeArray()
      expect(body).toHaveProperty("hasMore")

      for (const item of body.data) {
        const parsed = userSchema.safeParse(item)
        expect(parsed.success).toBe(true)
      }
    })
  })

  describe("Error response validation", () => {
    test("401 for missing auth header", async () => {
      const res = await fetch(`${baseUrl()}/api/v1/workspaces/${ctx.workspaceId}/streams`)
      expect(res.status).toBe(401)
    })

    test("403 for insufficient scope", async () => {
      const readOnlyKey = `test__${TEST_ORG_ID}__streams:read`
      const res = await apiRequest(
        "POST",
        `/api/v1/workspaces/${ctx.workspaceId}/streams/${ctx.channelId}/messages`,
        readOnlyKey,
        { content: "should fail" }
      )
      expect(res.status).toBe(403)
    })

    test("400 for invalid request body", async () => {
      const res = await apiRequest(
        "POST",
        `/api/v1/workspaces/${ctx.workspaceId}/messages/search`,
        ALL_SCOPES_KEY,
        { query: "" } // empty query violates min(1)
      )
      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body).toHaveProperty("error")
    })
  })
})
