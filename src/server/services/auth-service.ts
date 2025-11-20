import { WorkOS } from "@workos-inc/node"
import { WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD, WORKOS_REDIRECT_URI } from "../config"
import { logger } from "../lib/logger"

export interface AuthResult {
  success: boolean
  user?: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
  }
  sealedSession?: string
  refreshed: boolean
  reason?: string
}

export class AuthService {
  private workos: WorkOS
  private clientId: string
  private cookiePassword: string
  private redirectUri: string

  constructor() {
    this.clientId = WORKOS_CLIENT_ID
    this.cookiePassword = WORKOS_COOKIE_PASSWORD!
    this.redirectUri = WORKOS_REDIRECT_URI || "http://localhost:3000/api/auth/callback"
    this.workos = new WorkOS(WORKOS_API_KEY, { clientId: this.clientId })
  }

  /**
   * Authenticate a user from a sealed session cookie
   * Automatically refreshes if the access token expired but session is still valid
   */
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
        user: {
          id: authRes.user.id,
          email: authRes.user.email,
          firstName: authRes.user.firstName,
          lastName: authRes.user.lastName,
        },
        refreshed: false,
      }
    }

    // If authentication failed, try to refresh the session
    // This handles the case where access token expired (5 min) but session is still valid (30 days)
    if (authRes.reason !== "no_session_cookie_provided") {
      try {
        const refreshResult = await session.refresh({ cookiePassword: this.cookiePassword })
        if (refreshResult.authenticated && refreshResult.sealedSession) {
          logger.debug({ email: refreshResult.user.email }, "Session refreshed successfully")
          return {
            success: true,
            user: {
              id: refreshResult.user.id,
              email: refreshResult.user.email,
              firstName: refreshResult.user.firstName,
              lastName: refreshResult.user.lastName,
            },
            sealedSession: refreshResult.sealedSession,
            refreshed: true,
          }
        }
      } catch (error) {
        logger.error({ err: error, reason: authRes.reason }, "Session refresh error")
      }
    }

    // Authentication failed and refresh didn't work
    return {
      success: false,
      refreshed: false,
      reason: authRes.reason,
    }
  }

  /**
   * Authenticate a user with an authorization code (OAuth callback)
   */
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
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
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

  /**
   * Get the authorization URL for login
   */
  getAuthorizationUrl(): string {
    return this.workos.userManagement.getAuthorizationUrl({
      provider: "authkit",
      redirectUri: this.redirectUri,
      clientId: this.clientId,
    })
  }

  /**
   * Get the logout URL for a session
   */
  async getLogoutUrl(sealedSession: string): Promise<string | null> {
    try {
      const session = this.workos.userManagement.loadSealedSession({
        sessionData: sealedSession,
        cookiePassword: this.cookiePassword,
      })

      return await session.getLogoutUrl()
    } catch (error) {
      logger.error({ err: error }, "Failed to get logout URL")
      return null
    }
  }
}
