import { describe, test, expect } from "bun:test"
import type { NextFunction, Request, Response } from "express"
import { WORKSPACE_PERMISSION_SCOPES } from "@threa/types"
import { HttpError } from "../../src/lib/errors"
import { createRequireWorkspacePermission } from "../../src/middleware/workspace-permission"

async function runMiddleware(
  middleware: ReturnType<ReturnType<typeof createRequireWorkspacePermission>>,
  req: Request
): Promise<{ allowed: boolean; error: HttpError | null }> {
  let nextArg: unknown
  let nextCalled = false
  const next: NextFunction = (err) => {
    nextCalled = true
    nextArg = err
  }
  await middleware(req, {} as Response, next)
  if (!nextCalled) {
    throw new Error("middleware did not call next")
  }
  if (nextArg === undefined) {
    return { allowed: true, error: null }
  }
  if (nextArg instanceof HttpError) {
    return { allowed: false, error: nextArg }
  }
  throw new Error(`middleware passed non-HttpError to next: ${String(nextArg)}`)
}

describe("requireWorkspacePermission", () => {
  const requireWorkspacePermission = createRequireWorkspacePermission()

  test("session path: JWT permission grants access without DB lookup", async () => {
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE)
    const req = {
      authUser: { permissions: [WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE, WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ] },
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(true)
  })

  test("session path: missing permission returns 403", async () => {
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE)
    const req = {
      authUser: { permissions: [WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ] },
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(false)
    expect(result.error?.status).toBe(403)
  })

  test("user API key: granted when slug is in pre-clamped key scopes", async () => {
    // `public-api-auth.ts` clamps `req.userApiKey.scopes` against the owner
    // permission mirror at auth time, so this middleware checks the
    // pre-intersected set directly — no second mirror lookup.
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE)
    const req = {
      userApiKey: { scopes: new Set([WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE]) },
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(true)
  })

  test("user API key: denied with 403 when slug is missing from clamped scopes", async () => {
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE)
    const req = {
      userApiKey: { scopes: new Set([WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ]) },
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(false)
    expect(result.error?.status).toBe(403)
  })

  test("bot API key: granted when slug is in stored scopes", async () => {
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MESSAGES_WRITE)
    const req = {
      botApiKey: { scopes: new Set([WORKSPACE_PERMISSION_SCOPES.MESSAGES_WRITE]) },
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(true)
  })

  test("bot API key: denied when slug is missing from stored scopes", async () => {
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MESSAGES_WRITE)
    const req = {
      botApiKey: { scopes: new Set([WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ]) },
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(false)
    expect(result.error?.status).toBe(403)
  })

  test("returns 401 when no auth surface is present", async () => {
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE)
    const req = {} as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(false)
    expect(result.error?.status).toBe(401)
  })
})
