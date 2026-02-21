import { describe, expect, test } from "bun:test"
import type { NextFunction, Request, Response } from "express"
import { requireRole } from "./authorization"

interface MockResponse {
  statusCode: number
  body: unknown
}

function createReq(role?: "owner" | "admin" | "member"): Request {
  return {
    user: role
      ? ({
          id: "member_1",
          workspaceId: "ws_1",
          workosUserId: "workos_user_1",
          role,
          slug: role,
          timezone: null,
          locale: null,
          name: role,
          email: `${role}@example.com`,
          joinedAt: new Date(),
        } as Request["user"])
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
  const middleware = requireRole("admin")
  const res = createRes()
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }
  middleware(req, res, next)
  return { nextCalled, res }
}

describe("requireRole", () => {
  test("authorization matrix for requireRole('admin')", () => {
    const ownerResult = run(createReq("owner"))
    expect(ownerResult.nextCalled).toBe(true)
    expect(ownerResult.res.statusCode).toBe(200)

    const adminResult = run(createReq("admin"))
    expect(adminResult.nextCalled).toBe(true)
    expect(adminResult.res.statusCode).toBe(200)

    const memberResult = run(createReq("member"))
    expect(memberResult.nextCalled).toBe(false)
    expect(memberResult.res.statusCode).toBe(403)
    expect(memberResult.res.body).toEqual({ error: "Insufficient role" })

    const noUserResult = run(createReq())
    expect(noUserResult.nextCalled).toBe(false)
    expect(noUserResult.res.statusCode).toBe(401)
  })
})
