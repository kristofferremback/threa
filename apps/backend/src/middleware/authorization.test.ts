import { describe, expect, test } from "bun:test"
import type { NextFunction, Request, RequestHandler, Response } from "express"
import { permissionsForRole, type WorkspacePermissionSlug, type WorkspaceRoleSlug } from "@threa/types"
import { createRequireRole } from "./authorization"
import type { RequireWorkspacePermission } from "./workspace-permission"

interface MockResponse {
  statusCode: number
  body: unknown
}

function createReq(role?: WorkspaceRoleSlug): Request {
  if (!role) return {} as Request
  const permissions = permissionsForRole(role) as WorkspacePermissionSlug[]
  return {
    authUser: {
      userId: "workos_user_1",
      organizationId: "ws_1",
      sealedSession: "sealed",
      permissions,
    },
  } as unknown as Request
}

function createRes(): Response & MockResponse {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
    end() {
      return res
    },
  }
  return res as unknown as Response & MockResponse
}

// Stand up the shim against a real createRequireWorkspacePermission-style
// dependency so this test exercises the full shim → permission middleware path.
const fakeRequireWorkspacePermission: RequireWorkspacePermission = (slug) => {
  const handler: RequestHandler = (req, res, next) => {
    if (req.authUser?.permissions?.includes(slug)) {
      next()
      return
    }
    if (!req.authUser) {
      res.status(401).json({ error: "Not authenticated" })
      return
    }
    res.status(403).json({ error: "Insufficient permissions" })
  }
  return handler
}

const requireRole = createRequireRole({ requireWorkspacePermission: fakeRequireWorkspacePermission })

async function run(req: Request): Promise<{ nextCalled: boolean; res: Response & MockResponse }> {
  const middleware = requireRole("admin")
  const res = createRes()
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }
  await middleware(req, res, next)
  return { nextCalled, res }
}

describe("requireRole shim", () => {
  test("admin marker grants admin and owner; denies member; 401 when unauthenticated", async () => {
    const ownerResult = await run(createReq("owner"))
    expect(ownerResult.nextCalled).toBe(true)
    expect(ownerResult.res.statusCode).toBe(200)

    const adminResult = await run(createReq("admin"))
    expect(adminResult.nextCalled).toBe(true)
    expect(adminResult.res.statusCode).toBe(200)

    const memberResult = await run(createReq("member"))
    expect(memberResult.nextCalled).toBe(false)
    expect(memberResult.res.statusCode).toBe(403)

    const noUserResult = await run(createReq())
    expect(noUserResult.nextCalled).toBe(false)
    expect(noUserResult.res.statusCode).toBe(401)
  })
})
