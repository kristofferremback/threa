import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import type { NextFunction, Request, Response } from "express"
import type { Pool } from "pg"
import { WORKSPACE_PERMISSION_SCOPES, WORKSPACE_ROLE_SLUGS } from "@threa/types"
import { HttpError } from "../../src/lib/errors"
import { createRequireWorkspacePermission } from "../../src/middleware/workspace-permission"
import { WorkspaceUserPermissionsRepository } from "../../src/features/workspace-authz"
import { setupTestDatabase } from "./setup"

const WORKSPACE_ID = "ws_authz_mw_test"
const USER_ID = "workos_user_authz_mw_test"

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
  let pool: Pool
  let requireWorkspacePermission: ReturnType<typeof createRequireWorkspacePermission>

  beforeAll(async () => {
    pool = await setupTestDatabase()
    requireWorkspacePermission = createRequireWorkspacePermission({ pool })
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM workspace_user_permissions WHERE workspace_id = $1", [WORKSPACE_ID])
  })

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

  test("user API key: granted when key scope ∩ owner permissions includes slug", async () => {
    await WorkspaceUserPermissionsRepository.upsert(pool, {
      workspaceId: WORKSPACE_ID,
      workosUserId: USER_ID,
      roleSlugs: [WORKSPACE_ROLE_SLUGS.ADMIN],
      status: "active",
      lastEventAt: new Date(),
    })
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE)
    const req = {
      userApiKey: { scopes: new Set([WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE]) },
      user: { workosUserId: USER_ID },
      workspaceId: WORKSPACE_ID,
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(true)
  })

  test("user API key: denied when slug is in mirror but not key scopes", async () => {
    await WorkspaceUserPermissionsRepository.upsert(pool, {
      workspaceId: WORKSPACE_ID,
      workosUserId: USER_ID,
      roleSlugs: [WORKSPACE_ROLE_SLUGS.ADMIN],
      status: "active",
      lastEventAt: new Date(),
    })
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE)
    const req = {
      userApiKey: { scopes: new Set([WORKSPACE_PERMISSION_SCOPES.MESSAGES_READ]) },
      user: { workosUserId: USER_ID },
      workspaceId: WORKSPACE_ID,
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(false)
    expect(result.error?.status).toBe(403)
  })

  test("user API key: denied when slug is in key scopes but owner role does not grant it", async () => {
    await WorkspaceUserPermissionsRepository.upsert(pool, {
      workspaceId: WORKSPACE_ID,
      workosUserId: USER_ID,
      roleSlugs: [WORKSPACE_ROLE_SLUGS.MEMBER],
      status: "active",
      lastEventAt: new Date(),
    })
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE)
    const req = {
      userApiKey: { scopes: new Set([WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE]) },
      user: { workosUserId: USER_ID },
      workspaceId: WORKSPACE_ID,
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(false)
    expect(result.error?.status).toBe(403)
  })

  test("user API key: 401 when owner mirror row is missing", async () => {
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE)
    const req = {
      userApiKey: { scopes: new Set([WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE]) },
      user: { workosUserId: USER_ID },
      workspaceId: WORKSPACE_ID,
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(false)
    expect(result.error?.status).toBe(401)
    expect(result.error?.code).toBe("OWNER_INACTIVE")
  })

  test("user API key: 401 when owner mirror row is inactive", async () => {
    await WorkspaceUserPermissionsRepository.upsert(pool, {
      workspaceId: WORKSPACE_ID,
      workosUserId: USER_ID,
      roleSlugs: [WORKSPACE_ROLE_SLUGS.ADMIN],
      status: "inactive",
      lastEventAt: new Date(),
    })
    const middleware = requireWorkspacePermission(WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE)
    const req = {
      userApiKey: { scopes: new Set([WORKSPACE_PERMISSION_SCOPES.MEMBERS_WRITE]) },
      user: { workosUserId: USER_ID },
      workspaceId: WORKSPACE_ID,
    } as unknown as Request

    const result = await runMiddleware(middleware, req)
    expect(result.allowed).toBe(false)
    expect(result.error?.status).toBe(401)
    expect(result.error?.code).toBe("OWNER_INACTIVE")
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
