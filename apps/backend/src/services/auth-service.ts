import { WorkOS } from "@workos-inc/node"
import { logger } from "../lib/logger"
import type { WorkosConfig } from "../lib/env"

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

export interface AuthService {
  authenticateSession(sealedSession: string): Promise<AuthResult>
  authenticateWithCode(code: string): Promise<AuthResult>
  getAuthorizationUrl(redirectTo?: string): string
  getLogoutUrl(sealedSession: string): Promise<string | null>
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

    if (authRes.reason !== "no_session_cookie_provided") {
      try {
        const refreshResult = await session.refresh({
          cookiePassword: this.cookiePassword,
        })
        if (refreshResult.authenticated && refreshResult.sealedSession) {
          logger.debug(
            { email: refreshResult.user.email },
            "Session refreshed successfully",
          )
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
        logger.error(
          { err: error, reason: authRes.reason },
          "Session refresh error",
        )
      }
    }

    return {
      success: false,
      refreshed: false,
      reason: authRes.reason,
    }
  }

  async authenticateWithCode(code: string): Promise<AuthResult> {
    try {
      const { user, sealedSession } =
        await this.workos.userManagement.authenticateWithCode({
          code,
          clientId: this.clientId,
          session: { sealSession: true, cookiePassword: this.cookiePassword },
        })

      logger.info(
        { email: user.email, sealedSession: !!sealedSession },
        "User authenticated with code",
      )

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

  getAuthorizationUrl(redirectTo?: string): string {
    return this.workos.userManagement.getAuthorizationUrl({
      provider: "authkit",
      redirectUri: this.redirectUri,
      clientId: this.clientId,
      state: redirectTo ? Buffer.from(redirectTo).toString("base64") : undefined,
    })
  }

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
