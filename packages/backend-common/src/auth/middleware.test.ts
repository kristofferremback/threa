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
  async revokeSession(): Promise<boolean> {
    return false
  }
  async sendMagicAuthCode(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return { ok: true }
  }
  async authenticateWithMagicAuth(): Promise<AuthResult> {
    return this.result
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
    // cookies.ts captures SESSION_COOKIE_NAME at module load. Reuse whatever
    // value the module resolved to so this file works in isolation and when
    // cookies.test.ts has already locked the name in.
    process.env.SESSION_COOKIE_NAME ??= "wos_session_test_mw"
    sessionCookieName = (await import("../cookies")).SESSION_COOKIE_NAME
    createAuthMiddleware = (await import("./middleware")).createAuthMiddleware
  })

  test("populates req.authUser.permissions from the JWT permission claim", async () => {
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
    expect(req.authUser?.permissions?.slice().sort()).toEqual(["members:write", "messages:read"])
    expect(req.workosUserId).toBe("user_123")
  })

  test("empty permission claim is preserved as empty array (not coerced to null)", async () => {
    // Bootstrap callers rely on this distinction: `[]` means "WorkOS sent an
    // empty grant" (no fallback), `null` means "no claim — fall back to role".
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

    expect(req.authUser?.permissions).toEqual([])
  })

  test("absent permission claim surfaces as null so callers can fall back", async () => {
    const middleware = createAuthMiddleware({
      authService: new FakeAuthService({
        success: true,
        refreshed: false,
        user: {
          id: "user_123",
          email: "u@example.com",
          firstName: null,
          lastName: null,
          permissions: null,
        },
      }),
    })

    const req = { cookies: { [sessionCookieName]: "session" } } as unknown as Request
    await middleware(req, makeRes(), () => {})

    expect(req.authUser?.permissions).toBeNull()
  })
})
