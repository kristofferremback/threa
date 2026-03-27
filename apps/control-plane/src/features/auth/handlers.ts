import type { Request, Response } from "express"
import { z } from "zod/v4"
import {
  HttpError,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_CONFIG,
  decodeAndSanitizeRedirectState,
  displayNameFromWorkos,
  type AuthService,
} from "@threa/backend-common"

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
})

/**
 * Validate that a forwarded host is an allowed staging subdomain.
 * Prevents open redirect via X-Forwarded-Host spoofing.
 */
function isAllowedForwardedHost(host: string, allowedDomain: string): boolean {
  return host === allowedDomain || host.endsWith(`.${allowedDomain}`)
}

interface Dependencies {
  authService: AuthService
  /** Base URL of the frontend app (e.g. "https://threa-staging.pages.dev"). Empty string for same-origin. */
  frontendUrl: string
  /** Allowed staging domain for forwarded-host redirects (e.g. "staging.threa.io") */
  allowedRedirectDomain: string
}

export function createControlPlaneAuthHandlers({ authService, frontendUrl, allowedRedirectDomain }: Dependencies) {
  return {
    async login(req: Request, res: Response) {
      const redirectTo = req.query.redirect_to as string | undefined

      // Capture the forwarded host so the callback can redirect back to the correct origin.
      // The workspace-router sets X-Forwarded-Host on all proxied requests.
      const forwardedHost = req.headers["x-forwarded-host"] as string | undefined
      let statePayload = redirectTo
      if (forwardedHost && allowedRedirectDomain && isAllowedForwardedHost(forwardedHost, allowedRedirectDomain)) {
        statePayload = `${forwardedHost}|${redirectTo || "/"}`
      }

      const url = authService.getAuthorizationUrl(statePayload)
      res.redirect(url)
    },

    async callback(req: Request, res: Response) {
      const raw = { code: req.query.code || req.body?.code, state: req.query.state || req.body?.state }
      const parsed = callbackSchema.safeParse(raw)
      if (!parsed.success) {
        throw new HttpError("Missing or invalid authorization code", { status: 400, code: "INVALID_CALLBACK" })
      }

      const { code, state } = parsed.data
      const result = await authService.authenticateWithCode(code)

      if (!result.success || !result.user || !result.sealedSession) {
        throw new HttpError("Authentication failed", { status: 401, code: "AUTH_FAILED" })
      }

      let redirectUrl: string
      const decoded = state ? Buffer.from(state, "base64").toString("utf-8") : ""
      const pipeIndex = decoded.indexOf("|")

      if (pipeIndex !== -1) {
        // State contains "host|path" — redirect to the original forwarded host
        const host = decoded.substring(0, pipeIndex)
        const path = decodeAndSanitizeRedirectState(Buffer.from(decoded.substring(pipeIndex + 1)).toString("base64"))
        if (isAllowedForwardedHost(host, allowedRedirectDomain)) {
          redirectUrl = `https://${host}${path}`
        } else {
          redirectUrl = frontendUrl ? `${frontendUrl}${path}` : path
        }
      } else {
        const path = state ? decodeAndSanitizeRedirectState(state) : "/"
        redirectUrl = frontendUrl ? `${frontendUrl}${path}` : path
      }

      res.cookie(SESSION_COOKIE_NAME, result.sealedSession, SESSION_COOKIE_CONFIG)
      res.redirect(redirectUrl)
    },

    async logout(req: Request, res: Response) {
      const session = req.cookies[SESSION_COOKIE_NAME]

      const { maxAge: _, ...clearOpts } = SESSION_COOKIE_CONFIG
      res.clearCookie(SESSION_COOKIE_NAME, clearOpts)

      if (session) {
        const logoutUrl = await authService.getLogoutUrl(session)
        if (logoutUrl) {
          return res.redirect(logoutUrl)
        }
      }

      // Redirect to the forwarded host if available, otherwise frontendUrl or "/"
      const forwardedHost = req.headers["x-forwarded-host"] as string | undefined
      if (forwardedHost && allowedRedirectDomain && isAllowedForwardedHost(forwardedHost, allowedRedirectDomain)) {
        return res.redirect(`https://${forwardedHost}`)
      }
      res.redirect(frontendUrl || "/")
    },

    async me(req: Request, res: Response) {
      const authUser = req.authUser
      if (!authUser) {
        throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
      }

      const name = displayNameFromWorkos(authUser)
      res.json({
        id: authUser.id,
        email: authUser.email,
        name,
      })
    },
  }
}
