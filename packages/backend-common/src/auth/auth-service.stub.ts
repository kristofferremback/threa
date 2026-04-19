import type { AuthResult, AuthService } from "./auth-service"
import type { WorkosOrgService } from "./workos-org-service"

export interface DevLoginResult {
  user: { id: string; email: string; name: string }
  session: string
}

interface StubSessionPayload {
  userId: string
  organizationId?: string | null
  role?: string | null
  roles?: string[]
  permissions?: string[]
}

interface OrgSessionClaims {
  organizationId: string
  role: string | null
  roles: string[]
  permissions: string[]
}

function encodeStubSession(payload: StubSessionPayload): string {
  return `test_session_${Buffer.from(JSON.stringify(payload)).toString("base64url")}`
}

function decodeStubSession(sealedSession: string): StubSessionPayload | null {
  const match = sealedSession.match(/^test_session_(.+)$/)
  if (!match) {
    return null
  }

  try {
    const decoded = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as StubSessionPayload
    if (typeof decoded?.userId === "string" && decoded.userId.length > 0) {
      return decoded
    }
  } catch {
    // Fall through to the legacy `test_session_<userId>` format.
  }

  return { userId: match[1] }
}

/**
 * A stub AuthService for e2e testing that bypasses WorkOS entirely.
 * Users are identified by a simple token format: "test_session_<userId>"
 * or an encoded JSON payload for org-scoped session refresh flows.
 */
export class StubAuthService implements AuthService {
  private users: Map<string, { id: string; email: string; firstName: string | null; lastName: string | null }> =
    new Map()
  private workosOrgService: WorkosOrgService | null

  constructor(options: { workosOrgService?: WorkosOrgService } = {}) {
    this.workosOrgService = options.workosOrgService ?? null
  }

  /**
   * Look up the user's claims in the given org by reading the stub WorkOS
   * mirror: role slugs on their membership, then the permission set defined by
   * the org's role catalog. Real WorkOS embeds these in the sealed session;
   * mirroring that lets middleware treat stub sessions like real ones.
   */
  private async deriveOrgClaims(organizationId: string, userId: string): Promise<OrgSessionClaims> {
    if (!this.workosOrgService) {
      return { organizationId, role: null, roles: [], permissions: [] }
    }

    const [membership, orgRoles] = await Promise.all([
      this.workosOrgService.getOrganizationMembership({ organizationId, userId }),
      this.workosOrgService.listRolesForOrganization(organizationId),
    ])

    const membershipRoleSlugs = membership?.roles?.map((role) => role.slug) ?? []
    const roleSlugs =
      membershipRoleSlugs.length > 0 ? membershipRoleSlugs : membership?.role ? [membership.role.slug] : []

    const rolesBySlug = new Map(orgRoles.map((role) => [role.slug, role]))
    const permissions = Array.from(new Set(roleSlugs.flatMap((slug) => rolesBySlug.get(slug)?.permissions ?? [])))

    return {
      organizationId,
      role: roleSlugs[0] ?? null,
      roles: roleSlugs,
      permissions,
    }
  }

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
  }

  async authenticateSession(sealedSession: string): Promise<AuthResult> {
    if (!sealedSession) {
      return {
        success: false,
        refreshed: false,
        reason: "no_session_cookie_provided",
      }
    }

    const session = decodeStubSession(sealedSession)
    if (!session) {
      return { success: false, refreshed: false, reason: "invalid_session_format" }
    }

    const userId = session.userId
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
      user,
      session: {
        organizationId: session.organizationId ?? null,
        role: session.role ?? null,
        roles: [...(session.roles ?? [])],
        permissions: [...(session.permissions ?? [])],
      },
      refreshed: false,
    }
  }

  async refreshSession(params: { sealedSession: string; organizationId?: string }): Promise<AuthResult> {
    const authenticated = await this.authenticateSession(params.sealedSession)
    if (!authenticated.success || !authenticated.user) {
      return authenticated
    }

    const organizationId = params.organizationId ?? authenticated.session?.organizationId ?? null
    const claims: OrgSessionClaims | null = organizationId
      ? await this.deriveOrgClaims(organizationId, authenticated.user.id)
      : null

    return {
      success: true,
      user: authenticated.user,
      session: {
        organizationId,
        role: claims?.role ?? null,
        roles: claims?.roles ?? [],
        permissions: claims?.permissions ?? [],
      },
      sealedSession: encodeStubSession({
        userId: authenticated.user.id,
        organizationId,
        role: claims?.role ?? null,
        roles: claims?.roles ?? [],
        permissions: claims?.permissions ?? [],
      }),
      refreshed: true,
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

  getAuthorizationUrl(redirectTo?: string, redirectUri?: string): string {
    // Encode both state and (optional) redirect_uri into the stub login URL so
    // tests can assert on either. The stub login page ignores redirect_uri.
    const state = redirectTo ? Buffer.from(redirectTo).toString("base64") : ""
    const params = new URLSearchParams({ state })
    if (redirectUri) {
      params.set("redirect_uri", redirectUri)
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
