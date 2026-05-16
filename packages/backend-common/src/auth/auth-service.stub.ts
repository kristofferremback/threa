import type { AuthResult, AuthService } from "./auth-service"

// Stub sessions deliberately surface no JWT permission claim
// (`permissions: null`). Production OAuth-callback sessions also start with
// `permissions: null` until the next refresh, so this exercises a real
// production code path — the role-derived fallback inside
// `requireWorkspacePermission`. Returning the owner permission set here would
// short-circuit the JWT-claim branch and silently elevate every test session,
// which would break the role-based e2e tests in `apps/backend/tests/e2e/rbac.test.ts`
// (member/admin/owner differentiation depends on the role-derived path).
// The JWT-claim-present branch is exercised by
// `apps/backend/tests/integration/workspace-permission-middleware.test.ts`.
export interface DevLoginResult {
  user: { id: string; email: string; name: string }
  session: string
}

/**
 * A stub AuthService for e2e testing that bypasses WorkOS entirely.
 * Users are identified by a simple token format: "test_session_<userId>"
 */
export class StubAuthService implements AuthService {
  private users: Map<string, { id: string; email: string; firstName: string | null; lastName: string | null }> =
    new Map()
  private revoked = new Set<string>()

  /**
   * Dev login endpoint - creates/ensures in-memory auth user and registers session.
   * Returns user data and session token for cookie.
   */
  async devLogin(options: { email?: string; name?: string } = {}): Promise<DevLoginResult> {
    const email = options.email || "test@example.com"
    const name = options.name || "Test User"

    // Generate a fake WorkOS user ID — base64url-encode the email so it's safely reversible
    const fakeWorkosUserId = `workos_test_${Buffer.from(email).toString("base64url")}`

    // Register with the fake WorkOS ID - this is what authenticateSession will return
    // and what socket.ts will use to look up the user
    const session = this.registerTestUser({
      id: fakeWorkosUserId,
      email,
      firstName: name,
    })

    return {
      user: { id: fakeWorkosUserId, email, name },
      session,
    }
  }

  /**
   * Register a test user that can authenticate.
   * Returns the session token to use in cookies.
   */
  registerTestUser(user: { id: string; email: string; firstName?: string | null; lastName?: string | null }): string {
    this.users.set(user.id, {
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
    })
    return `test_session_${user.id}`
  }

  clearUsers(): void {
    this.users.clear()
    this.revoked.clear()
  }

  async revokeSession(sealedSession: string): Promise<boolean> {
    if (!/^test_session_(.+)$/.test(sealedSession)) return false
    this.revoked.add(sealedSession)
    return true
  }

  async authenticateSession(sealedSession: string): Promise<AuthResult> {
    if (!sealedSession) {
      return {
        success: false,
        refreshed: false,
        reason: "no_session_cookie_provided",
      }
    }

    const match = sealedSession.match(/^test_session_(.+)$/)
    if (!match) {
      return { success: false, refreshed: false, reason: "invalid_session_format" }
    }

    if (this.revoked.has(sealedSession)) {
      return { success: false, refreshed: false, reason: "session_revoked" }
    }

    const userId = match[1]
    let user = this.users.get(userId)

    // Auto-register from session token for cross-process stub auth.
    // When the control-plane sets the session cookie, the regional backend
    // (a separate process with its own StubAuthService) needs to trust it.
    if (!user && userId?.startsWith("workos_test_")) {
      const emailPart = userId.slice("workos_test_".length)
      const email = Buffer.from(emailPart, "base64url").toString()
      user = { id: userId, email, firstName: null, lastName: null }
      this.users.set(userId, user)
    }

    if (!user) {
      return { success: false, refreshed: false, reason: "user_not_found" }
    }

    return {
      success: true,
      user: { ...user, permissions: null },
      refreshed: false,
    }
  }

  async authenticateWithCode(code: string): Promise<AuthResult> {
    const match = code.match(/^test_code_(.+)$/)
    if (!match) {
      return { success: false, refreshed: false, reason: "invalid_code" }
    }

    const userId = match[1]
    const user = this.users.get(userId)

    if (!user) {
      return { success: false, refreshed: false, reason: "user_not_found" }
    }

    return {
      success: true,
      user: { ...user, permissions: null },
      sealedSession: `test_session_${userId}`,
      refreshed: false,
    }
  }

  getAuthorizationUrl(redirectTo?: string, redirectUri?: string, options?: { prompt?: string }): string {
    // Encode state, optional redirect_uri, and optional prompt into the stub
    // login URL so tests can assert on any of them. The stub login page
    // ignores redirect_uri and prompt.
    const state = redirectTo ? Buffer.from(redirectTo).toString("base64") : ""
    const params = new URLSearchParams({ state })
    if (redirectUri) {
      params.set("redirect_uri", redirectUri)
    }
    if (options?.prompt) {
      params.set("prompt", options.prompt)
    }
    return `/test-auth-login?${params.toString()}`
  }

  async getLogoutUrl(_sealedSession: string, returnTo?: string): Promise<string | null> {
    // Encode returnTo as a query param so tests can assert on it.
    if (returnTo) {
      const params = new URLSearchParams({ return_to: returnTo })
      return `/test-logged-out?${params.toString()}`
    }
    return "/test-logged-out"
  }
}
