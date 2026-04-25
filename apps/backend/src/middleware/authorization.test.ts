import { describe, expect, test } from "bun:test"
import type { NextFunction, Request, Response } from "express"
import { requireWorkspacePermission } from "./authorization"

interface MockResponse {
  statusCode: number
  body: unknown
}

function createReq(permissions?: string[]): Request {
  return {
    authz: permissions
      ? {
          source: "session",
          organizationId: "org_1",
          organizationMembershipId: "om_1",
          permissions: new Set(permissions as Array<"messages:read" | "workspace:admin">),
          assignedRoles: [{ slug: "member", name: "Member" }],
          canEditRole: true,
        }
      : undefined,
  } as Request
}

function createRes(): Response & MockResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  } as Response & MockResponse
}

function run(req: Request): { nextCalled: boolean; res: Response & MockResponse } {
  const middleware = requireWorkspacePermission("workspace:admin")
  const res = createRes()
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }
  middleware(req, res, next)
  return { nextCalled, res }
}

describe("requireWorkspacePermission", () => {
  test("passes when permission is present", () => {
    const result = run(createReq(["workspace:admin"]))
    expect(result.nextCalled).toBe(true)
    expect(result.res.statusCode).toBe(200)
  })

  test("returns 403 when permission is missing", () => {
    const result = run(createReq(["messages:read"]))
    expect(result.nextCalled).toBe(false)
    expect(result.res.statusCode).toBe(403)
    expect(result.res.body).toEqual({ error: "Missing required permission: workspace:admin" })
  })

  test("returns 401 when authz context is missing", () => {
    const result = run(createReq())
    expect(result.nextCalled).toBe(false)
    expect(result.res.statusCode).toBe(401)
  })
})
