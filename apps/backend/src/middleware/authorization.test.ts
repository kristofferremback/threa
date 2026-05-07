import { describe, expect, test } from "bun:test"
import type { NextFunction, Request, Response } from "express"
import { HttpError } from "@threa/backend-common"
import { requireRole } from "./authorization"

function createReq(role?: "owner" | "admin" | "user"): Request {
  return {
    user: role
      ? ({
          id: "usr_1",
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

function run(req: Request): { nextArg: unknown; nextCalled: boolean } {
  const middleware = requireRole("admin")
  const res = {} as Response
  let nextCalled = false
  let nextArg: unknown = undefined
  const next: NextFunction = (err?: unknown) => {
    nextCalled = true
    nextArg = err
  }
  middleware(req, res, next)
  return { nextArg, nextCalled }
}

describe("requireRole", () => {
  test("authorization matrix for requireRole('admin')", () => {
    const ownerResult = run(createReq("owner"))
    expect(ownerResult.nextCalled).toBe(true)
    expect(ownerResult.nextArg).toBeUndefined()

    const adminResult = run(createReq("admin"))
    expect(adminResult.nextCalled).toBe(true)
    expect(adminResult.nextArg).toBeUndefined()

    const userResult = run(createReq("user"))
    expect(userResult.nextCalled).toBe(true)
    expect(userResult.nextArg).toBeInstanceOf(HttpError)
    const userErr = userResult.nextArg as HttpError
    expect(userErr.status).toBe(403)
    expect(userErr.code).toBe("FORBIDDEN")
    expect(userErr.message).toBe("Insufficient role")

    const noUserResult = run(createReq())
    expect(noUserResult.nextCalled).toBe(true)
    expect(noUserResult.nextArg).toBeInstanceOf(HttpError)
    const noUserErr = noUserResult.nextArg as HttpError
    expect(noUserErr.status).toBe(401)
    expect(noUserErr.code).toBe("UNAUTHORIZED")
  })
})
