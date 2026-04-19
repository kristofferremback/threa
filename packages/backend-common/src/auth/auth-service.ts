import { WorkOS } from "@workos-inc/node"
import { logger } from "../logger"
import type { WorkosConfig } from "./types"

export interface AuthenticatedUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

export interface AuthSessionClaims {
  organizationId: string | null
  role: string | null
  roles: string[]
  permissions: string[]
}

export interface AuthResult {
  success: boolean
  user?: AuthenticatedUser
  session?: AuthSessionClaims
  sealedSession?: string
  refreshed: boolean
  reason?: string
}

export interface AuthService {
  authenticateSession(sealedSession: string): Promise<AuthResult>
  refreshSession(params: { sealedSession: string; organizationId?: string }): Promise<AuthResult>
  authenticateWithCode(code: string): Promise<AuthResult>
  /**
   * Build the WorkOS authorization URL.
   *
   * @param redirectTo  Optional path/state passed through to the callback.
   * @param redirectUri Optional per-request redirect URI override. When set,
   *                    WorkOS will redirect back to this URI instead of the
   *                    service's default `WORKOS_REDIRECT_URI`. Used by the
   *                    control-plane to support multiple origins (e.g. the
   *                    backoffice on a different TLD) without cookie-domain
   *                    gymnastics.
   */
  getAuthorizationUrl(redirectTo?: string, redirectUri?: string): string
  /**
   * Build a WorkOS single-logout URL.
   *
   * @param sealedSession The encrypted session cookie value.
   * @param returnTo      Optional origin to redirect to after WorkOS clears
   *                      the session. Defaults to the configured
   *                      `WORKOS_REDIRECT_URI`'s origin. Pass a dedicated
   *                      origin (e.g. `https://admin.threa.io`) to send the
   *                      user back to the same origin they started on when
   *                      it can't share cookies with the default.
   */
  getLogoutUrl(sealedSession: string, returnTo?: string): Promise<string | null>
}

export class WorkosAuthService implements AuthService {
  private workos: WorkOS
  private clientId: string
  private cookiePassword: string
  private redirectUri: string

  constructor(config: WorkosConfig) {
    this.clientId = config.clientId
    this.cookiePassword = config.cookiePassword
    this.redirectUri = config.redirectUri
    this.workos = new WorkOS(config.apiKey, { clientId: this.clientId })
  }

  private mapUser(user: AuthenticatedUser): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    }
  }

  private mapSessionClaims(session: {
    organizationId?: string
    role?: string | null
    roles?: string[]
    permissions?: string[]
  }): AuthSessionClaims {
    return {
      organizationId: session.organizationId ?? null,
      role: session.role ?? null,
      roles: [...(session.roles ?? [])],
      permissions: [...(session.permissions ?? [])],
    }
  }

  async authenticateSession(sealedSession: string): Promise<AuthResult> {
    if (!sealedSession) {
      return {
        success: false,
        refreshed: false,
        reason: "no_session_cookie_provided",
      }
    }

    const session = this.workos.userManagement.loadSealedSession({
      sessionData: sealedSession,
      cookiePassword: this.cookiePassword,
    })

    const authRes = await session.authenticate()

    if (authRes.authenticated) {
      return {
        success: true,
        user: this.mapUser(authRes.user),
        session: this.mapSessionClaims(authRes),
        refreshed: false,
      }
    }

    if (authRes.reason !== "no_session_cookie_provided") {
      try {
        const refreshResult = await session.refresh({
          cookiePassword: this.cookiePassword,
        })
        if (refreshResult.authenticated && refreshResult.sealedSession) {
          logger.debug({ email: refreshResult.user.email }, "Session refreshed successfully")
          return {
            success: true,
            user: this.mapUser(refreshResult.user),
            session: this.mapSessionClaims(refreshResult),
            sealedSession: refreshResult.sealedSession,
            refreshed: true,
          }
        }
      } catch (error) {
        logger.error({ err: error, reason: authRes.reason }, "Session refresh error")
      }
    }

    return {
      success: false,
      refreshed: false,
      reason: authRes.reason,
    }
  }

  async refreshSession(params: { sealedSession: string; organizationId?: string }): Promise<AuthResult> {
    if (!params.sealedSession) {
      return {
        success: false,
        refreshed: false,
        reason: "no_session_cookie_provided",
      }
    }

    try {
      const session = this.workos.userManagement.loadSealedSession({
        sessionData: params.sealedSession,
        cookiePassword: this.cookiePassword,
      })

      const refreshResult = await session.refresh({
        cookiePassword: this.cookiePassword,
        organizationId: params.organizationId,
      })

      if (!refreshResult.authenticated) {
        return {
          success: false,
          refreshed: false,
          reason: refreshResult.reason,
        }
      }

      if (refreshResult.sealedSession) {
        return {
          success: true,
          user: this.mapUser(refreshResult.user),
          session: this.mapSessionClaims(refreshResult),
          sealedSession: refreshResult.sealedSession,
          refreshed: true,
        }
      }

      return {
        success: true,
        user: this.mapUser(refreshResult.user),
        session: this.mapSessionClaims(refreshResult),
        refreshed: true,
      }
    } catch (error) {
      logger.error({ err: error, organizationId: params.organizationId }, "Session refresh error")
      return {
        success: false,
        refreshed: false,
        reason: "session_refresh_failed",
      }
    }
  }

  async authenticateWithCode(code: string): Promise<AuthResult> {
    try {
      const { user, sealedSession } = await this.workos.userManagement.authenticateWithCode({
        code,
        clientId: this.clientId,
        session: { sealSession: true, cookiePassword: this.cookiePassword },
      })

      logger.info({ email: user.email, sealedSession: !!sealedSession }, "User authenticated with code")

      return {
        success: true,
        user: this.mapUser(user),
        sealedSession: sealedSession!,
        refreshed: false,
      }
    } catch (error) {
      logger.error({ err: error }, "Authentication with code failed")
      return {
        success: false,
        refreshed: false,
        reason: "authentication_failed",
      }
    }
  }

  getAuthorizationUrl(redirectTo?: string, redirectUri?: string): string {
    return this.workos.userManagement.getAuthorizationUrl({
      provider: "authkit",
      redirectUri: redirectUri ?? this.redirectUri,
      clientId: this.clientId,
      state: redirectTo ? Buffer.from(redirectTo).toString("base64") : undefined,
    })
  }

  async getLogoutUrl(sealedSession: string, returnTo?: string): Promise<string | null> {
    try {
      const session = this.workos.userManagement.loadSealedSession({
        sessionData: sealedSession,
        cookiePassword: this.cookiePassword,
      })

      const resolvedReturnTo = returnTo ?? new URL(this.redirectUri).origin
      return await session.getLogoutUrl({ returnTo: resolvedReturnTo })
    } catch (error) {
      logger.error({ err: error }, "Failed to get logout URL")
      return null
    }
  }
}
