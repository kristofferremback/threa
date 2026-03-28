import { describe, expect, test } from "bun:test"
import type { NextFunction, Request, Response } from "express"
import { StubApiKeyService } from "@threa/backend-common"
import { createPublicApiAuthMiddleware, requireApiKeyScope } from "./public-api-auth"
import { API_KEY_SCOPES } from "@threa/types"

// Minimal pool stub - just enough for getWorkosOrganizationId
function createPoolStub(orgId: string | null) {
  return {
    query: async () => ({
      rows: orgId ? [{ workos_organization_id: orgId }] : [],
      rowCount: orgId ? 1 : 0,
    }),
  } as any
}

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    params: {},
    ...overrides,
  } as Request
}

interface CapturedError {
  message: string
  status: number
  code?: string
}

function runMiddleware(middleware: any, req: Request): Promise<{ nextCalled: boolean; error: CapturedError | null }> {
  return new Promise((resolve) => {
    let nextCalled = false
    let error: CapturedError | null = null

    const next: NextFunction = (err?: any) => {
      nextCalled = true
      if (err) {
        error = { message: err.message, status: err.status, code: err.code }
      }
      resolve({ nextCalled, error })
    }

    const res = {} as Response
    const result = middleware(req, res, next)
    if (result && typeof result.then === "function") {
      result.then(() => {
        if (!nextCalled) resolve({ nextCalled, error })
      })
    }
  })
}

describe("createPublicApiAuthMiddleware", () => {
  const ORG_ID = "org_test_123"

  test("should return 401 for missing Authorization header", async () => {
    const apiKeyService = new StubApiKeyService()
    const middleware = createPublicApiAuthMiddleware({
      apiKeyService,
      userApiKeyService: { validateKey: async () => null } as any,
      pool: createPoolStub(ORG_ID),
    })

    const req = createReq({ params: { workspaceId: "ws_1" } })
    const { error } = await runMiddleware(middleware, req)

    expect(error).not.toBeNull()
    expect(error!.status).toBe(401)
  })

  test("should return 401 for non-Bearer Authorization header", async () => {
    const apiKeyService = new StubApiKeyService()
    const middleware = createPublicApiAuthMiddleware({
      apiKeyService,
      userApiKeyService: { validateKey: async () => null } as any,
      pool: createPoolStub(ORG_ID),
    })

    const req = createReq({
      headers: { authorization: "Basic abc123" } as any,
      params: { workspaceId: "ws_1" },
    })
    const { error } = await runMiddleware(middleware, req)

    expect(error).not.toBeNull()
    expect(error!.status).toBe(401)
  })

  test("should return 401 for invalid API key", async () => {
    const apiKeyService = new StubApiKeyService()
    const middleware = createPublicApiAuthMiddleware({
      apiKeyService,
      userApiKeyService: { validateKey: async () => null } as any,
      pool: createPoolStub(ORG_ID),
    })

    const req = createReq({
      headers: { authorization: "Bearer invalid_key" } as any,
      params: { workspaceId: "ws_1" },
    })
    const { error } = await runMiddleware(middleware, req)

    expect(error).not.toBeNull()
    expect(error!.status).toBe(401)
  })

  test("should return 403 for org mismatch", async () => {
    const apiKeyService = new StubApiKeyService()
    apiKeyService.addKey("valid_key", {
      id: "key_1",
      name: "Test Key",
      organizationId: "org_different",
      permissions: new Set(["messages:search"]),
    })

    const middleware = createPublicApiAuthMiddleware({
      apiKeyService,
      userApiKeyService: { validateKey: async () => null } as any,
      pool: createPoolStub(ORG_ID),
    })

    const req = createReq({
      headers: { authorization: "Bearer valid_key" } as any,
      params: { workspaceId: "ws_1" },
    })
    const { error } = await runMiddleware(middleware, req)

    expect(error).not.toBeNull()
    expect(error!.status).toBe(403)
  })

  test("should set req.apiKey and req.workspaceId on success", async () => {
    const apiKeyService = new StubApiKeyService()
    apiKeyService.addKey("valid_key", {
      id: "key_1",
      name: "Test Key",
      organizationId: ORG_ID,
      permissions: new Set(["messages:search"]),
    })

    const middleware = createPublicApiAuthMiddleware({
      apiKeyService,
      userApiKeyService: { validateKey: async () => null } as any,
      pool: createPoolStub(ORG_ID),
    })

    const req = createReq({
      headers: { authorization: "Bearer valid_key" } as any,
      params: { workspaceId: "ws_1" },
    })
    const { nextCalled, error } = await runMiddleware(middleware, req)

    expect(nextCalled).toBe(true)
    expect(error).toBeNull()
    expect(req.apiKey).toEqual({
      id: "key_1",
      name: "Test Key",
      permissions: new Set(["messages:search"]),
    })
    expect(req.workspaceId).toBe("ws_1")
  })
})

describe("requireApiKeyScope", () => {
  test("should pass when scope is present", () => {
    const middleware = requireApiKeyScope(API_KEY_SCOPES.MESSAGES_SEARCH)
    const req = createReq()
    req.apiKey = { id: "key_1", name: "Test", permissions: new Set(["messages:search"]) }

    let nextCalled = false
    let error: any = null
    const next: NextFunction = (err?: any) => {
      nextCalled = true
      error = err
    }
    middleware(req, {} as Response, next)

    expect(nextCalled).toBe(true)
    expect(error).toBeUndefined()
  })

  test("should return 403 when scope is missing", () => {
    const middleware = requireApiKeyScope(API_KEY_SCOPES.MESSAGES_SEARCH)
    const req = createReq()
    req.apiKey = { id: "key_1", name: "Test", permissions: new Set(["other:scope"]) }

    let error: any = null
    const next: NextFunction = (err?: any) => {
      error = err
    }
    middleware(req, {} as Response, next)

    expect(error).not.toBeNull()
    expect(error.status).toBe(403)
  })

  test("should return 401 when no apiKey on request", () => {
    const middleware = requireApiKeyScope(API_KEY_SCOPES.MESSAGES_SEARCH)
    const req = createReq()

    let error: any = null
    const next: NextFunction = (err?: any) => {
      error = err
    }
    middleware(req, {} as Response, next)

    expect(error).not.toBeNull()
    expect(error.status).toBe(401)
  })
})
