import { beforeAll, describe, expect, test } from "bun:test"
import type { Request, Response } from "express"
import type { AuthResult, AuthService } from "./auth-service"

class FakeAuthService implements AuthService {
  constructor(private result: AuthResult) {}
  async authenticateSession(): Promise<AuthResult> {
    return this.result
  }
  async authenticateWithCode(): Promise<AuthResult> {
    return this.result
  }
  getAuthorizationUrl(): string {
    return "/login"
  }
  async getLogoutUrl(): Promise<string | null> {
    return null
  }
}

function makeRes(): Response {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
    clearCookie() {
      return this
    },
    cookie() {
      return this
    },
  }
  return res as unknown as Response
}

describe("createAuthMiddleware", () => {
  let createAuthMiddleware: typeof import("./middleware").createAuthMiddleware
  let sessionCookieName: string

  beforeAll(async () => {
    // The cookies module captures SESSION_COOKIE_NAME at first import; when
    // this test runs alongside cookies.test.ts the value may already be set.
    // Read whatever the module resolved to and key our request fixtures off it.
    process.env.SESSION_COOKIE_NAME ??= "wos_session_test_mw"
    sessionCookieName = (await import("../cookies")).SESSION_COOKIE_NAME
    createAuthMiddleware = (await import("./middleware")).createAuthMiddleware
  })

  test("populates req.workosPermissions from the JWT permission claim", async () => {
    const middleware = createAuthMiddleware({
      authService: new FakeAuthService({
        success: true,
        refreshed: false,
        user: {
          id: "user_123",
          email: "u@example.com",
          firstName: null,
          lastName: null,
          permissions: ["messages:read", "members:write"],
        },
      }),
    })

    const req = { cookies: { [sessionCookieName]: "session" } } as unknown as Request
    let nextCalled = false
    await middleware(req, makeRes(), () => {
      nextCalled = true
    })

    expect(nextCalled).toBe(true)
    expect(req.workosPermissions).toBeInstanceOf(Set)
    expect(Array.from(req.workosPermissions!).sort()).toEqual(["members:write", "messages:read"])
    expect(req.workosUserId).toBe("user_123")
  })

  test("empty permission claim yields an empty set, not undefined", async () => {
    const middleware = createAuthMiddleware({
      authService: new FakeAuthService({
        success: true,
        refreshed: false,
        user: {
          id: "user_123",
          email: "u@example.com",
          firstName: null,
          lastName: null,
          permissions: [],
        },
      }),
    })

    const req = { cookies: { [sessionCookieName]: "session" } } as unknown as Request
    await middleware(req, makeRes(), () => {})

    expect(req.workosPermissions).toBeInstanceOf(Set)
    expect(req.workosPermissions!.size).toBe(0)
  })
})
