import type { AuthResult, AuthService } from "./auth-service"

/**
 * A stub AuthService for e2e testing that bypasses WorkOS entirely.
 * Users are identified by a simple token format: "test_session_<userId>"
 */
export class StubAuthService implements Pick<AuthService, keyof AuthService> {
  private users: Map<string, { id: string; email: string; firstName: string | null; lastName: string | null }> =
    new Map()

  /**
   * Register a test user that can authenticate.
   * Returns the session token to use in cookies.
   */
  registerTestUser(user: {
    id: string
    email: string
    firstName?: string | null
    lastName?: string | null
  }): string {
    this.users.set(user.id, {
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
    })
    return `test_session_${user.id}`
  }

  /**
   * Clear all registered test users
   */
  clearUsers(): void {
    this.users.clear()
  }

  async authenticateSession(sealedSession: string): Promise<AuthResult> {
    if (!sealedSession) {
      return { success: false, refreshed: false, reason: "no_session_cookie_provided" }
    }

    // Extract user ID from test session token
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
    // For testing OAuth flow - code format: "test_code_<userId>"
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
