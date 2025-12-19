import type { AuthResult, AuthService } from "./auth-service"
import type { UserService } from "./user-service"

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

  /**
   * Dev login endpoint - creates/ensures user in DB and registers for auth.
   * Returns user data and session token for cookie.
   */
  async devLogin(userService: UserService, options: { email?: string; name?: string } = {}): Promise<DevLoginResult> {
    const email = options.email || "test@example.com"
    const name = options.name || "Test User"

    // Generate a fake WorkOS user ID for testing - this mimics how real auth works
    const fakeWorkosUserId = `workos_test_${email.replace(/[^a-z0-9]/gi, "_")}`

    const user = await userService.ensureUser({ email, name, workosUserId: fakeWorkosUserId })

    // Register with the fake WorkOS ID - this is what authenticateSession will return
    // and what socket.ts will use to look up the user
    const session = this.registerTestUser({
      id: fakeWorkosUserId,
      email: user.email,
      firstName: name,
    })

    return {
      user: { id: user.id, email: user.email, name: user.name },
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

    const userId = match[1]
    const user = this.users.get(userId)

    if (!user) {
      return { success: false, refreshed: false, reason: "user_not_found" }
    }

    return {
      success: true,
      user,
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
      user,
      sealedSession: `test_session_${userId}`,
      refreshed: false,
    }
  }

  getAuthorizationUrl(redirectTo?: string): string {
    const state = redirectTo ? Buffer.from(redirectTo).toString("base64") : ""
    return `/test-auth-login?state=${state}`
  }

  async getLogoutUrl(_sealedSession: string): Promise<string | null> {
    return "/test-logged-out"
  }
}
