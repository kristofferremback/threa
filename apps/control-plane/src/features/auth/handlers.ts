import type { Request, Response } from "express"
import { z } from "zod/v4"
import {
  HttpError,
  SESSION_COOKIE_NAME,
  clearAltSessionCookie,
  clearSessionCookie,
  decodeAndSanitizeRedirectState,
  displayNameFromWorkos,
  readAltSessionCookies,
  setSessionCookie,
  type AuthService,
} from "@threa/backend-common"
import type { AccountsService } from "../accounts"

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
})

/**
 * Validate that a forwarded host is an allowed staging subdomain.
 * Prevents open redirect via X-Forwarded-Host spoofing.
 *
 * Matches both nested subdomains (foo.staging.threa.io) and flat PR subdomains
 * (pr-123-staging.threa.io) which are siblings of the allowed domain, not children.
 */
function isAllowedForwardedHost(host: string, allowedDomain: string): boolean {
  if (host === allowedDomain) return true
  // Nested subdomain: foo.staging.threa.io
  if (host.endsWith(`.${allowedDomain}`)) return true
  // Flat PR subdomain: pr-N-staging.threa.io is a sibling of staging.threa.io
  // under the same base domain. Match the explicit PR pattern only.
  const prPrefix = /^pr-\d+-/
  if (prPrefix.test(host) && host.endsWith(`-${allowedDomain}`)) return true
  return false
}

interface Dependencies {
  authService: AuthService
  /** Owns the park/coalesce cookie-mutation sequence for the add-account flow. */
  accountsService: AccountsService
  /** Base URL of the frontend app (e.g. "https://threa-staging.pages.dev"). Empty string for same-origin. */
  frontendUrl: string
  /** Allowed staging domain for forwarded-host redirects (e.g. "staging.threa.io") */
  allowedRedirectDomain: string
  /**
   * Forwarded hosts that get a dedicated WorkOS redirect URI (and are trusted
   * as redirect targets in the callback independent of `allowedRedirectDomain`).
   * Used for origins that can't share cookies with the default redirect host,
   * e.g. the backoffice at admin.threa.io.
   */
  dedicatedRedirectHosts: string[]
}

/** Is `host` a trusted redirect target? */
function isTrustedHost(host: string, allowedDomain: string, dedicatedHosts: string[]): boolean {
  if (dedicatedHosts.includes(host)) return true
  if (allowedDomain && isAllowedForwardedHost(host, allowedDomain)) return true
  return false
}

/**
 * Peel the optional `add|` multi-account sentinel off the OAuth `state`.
 *
 * `login` prefixes a literal `add|` onto the *plaintext* state when
 * `intent=add`; `getAuthorizationUrl` then base64-encodes the whole thing.
 * Here we decode once, strip the sentinel, and re-encode the inner plaintext
 * so the existing host/path decode logic runs on a byte-identical payload.
 * For the non-add path `innerState` is the original `state` untouched, keeping
 * single-account decoding exactly as it was.
 */
function parseCallbackState(state: string | undefined): { isAdd: boolean; innerState: string | undefined } {
  if (!state) return { isAdd: false, innerState: state }
  const decoded = Buffer.from(state, "base64").toString("utf-8")
  if (decoded.startsWith("add|")) {
    const inner = decoded.slice("add|".length)
    return { isAdd: true, innerState: Buffer.from(inner, "utf-8").toString("base64") }
  }
  return { isAdd: false, innerState: state }
}

export function createControlPlaneAuthHandlers({
  authService,
  accountsService,
  frontendUrl,
  allowedRedirectDomain,
  dedicatedRedirectHosts,
}: Dependencies) {
  return {
    async login(req: Request, res: Response) {
      const redirectTo = req.query.redirect_to as string | undefined

      // Capture the forwarded host so the callback can redirect back to the correct origin.
      // The workspace-router (and backoffice-router) set X-Forwarded-Host on all proxied
      // requests; we cross-check against the allow-list before trusting it.
      const forwardedHost = req.headers["x-forwarded-host"] as string | undefined
      const hostTrusted = !!forwardedHost && isTrustedHost(forwardedHost, allowedRedirectDomain, dedicatedRedirectHosts)

      let statePayload = redirectTo
      let redirectUriOverride: string | undefined
      if (hostTrusted && forwardedHost) {
        statePayload = `${forwardedHost}|${redirectTo || "/"}`
        // Hosts on the dedicated list get their own WorkOS redirect URI so the
        // session cookie lands on the correct origin directly — the default
        // "single canonical callback + state redirect" flow can't work across
        // origins that don't share a cookie domain.
        if (dedicatedRedirectHosts.includes(forwardedHost)) {
          redirectUriOverride = `https://${forwardedHost}/api/auth/callback`
        }
      }

      // Multi-account add flow: prefix an `add|` sentinel onto the plaintext
      // state (callback peels it back off) and force an AuthKit re-prompt so
      // the hosted session isn't silently reused for the second account.
      const isAdd = typeof req.query.intent === "string" && req.query.intent === "add"
      if (isAdd) {
        statePayload = `add|${statePayload ?? ""}`
      }

      const url = authService.getAuthorizationUrl(
        statePayload,
        redirectUriOverride,
        isAdd ? { prompt: "login" } : undefined
      )
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

      const { isAdd, innerState } = parseCallbackState(state)

      let appOrigin: string
      let redirectPath: string
      const decoded = innerState ? Buffer.from(innerState, "base64").toString("utf-8") : ""
      const pipeIndex = decoded.indexOf("|")

      if (pipeIndex !== -1) {
        // State contains "host|path" — redirect to the original forwarded host
        const host = decoded.substring(0, pipeIndex)
        redirectPath = decodeAndSanitizeRedirectState(Buffer.from(decoded.substring(pipeIndex + 1)).toString("base64"))
        appOrigin = isTrustedHost(host, allowedRedirectDomain, dedicatedRedirectHosts) ? `https://${host}` : frontendUrl
      } else {
        redirectPath = innerState ? decodeAndSanitizeRedirectState(innerState) : "/"
        appOrigin = frontendUrl
      }

      if (isAdd) {
        const parked = await accountsService.addAndParkActive(
          res,
          req.cookies,
          req.cookies[SESSION_COOKIE_NAME] as string | undefined,
          result.sealedSession,
          result.user.id
        )
        if (parked.ok) {
          // A successful add makes the just-authenticated account active. The
          // pre-add state path belongs to the previous (now parked) account;
          // routing there 403s and bounces straight back via the workspace
          // resolve→switchAccount path, silently undoing the add. Land on the
          // workspace picker instead; ?accountAdded=1 lets the app drop its
          // stale last-workspace pointer so it can't redirect into the old account.
          redirectPath = "/workspaces?accountAdded=1"
        } else {
          // No throw mid-OAuth-callback: the user keeps their existing session
          // and the frontend surfaces the refusal from the query param.
          redirectPath += `${redirectPath.includes("?") ? "&" : "?"}accountError=${encodeURIComponent(parked.code)}`
        }
      } else {
        setSessionCookie(res, result.sealedSession)
      }
      res.redirect(`${appOrigin}${redirectPath}`)
    },

    async logout(req: Request, res: Response) {
      const session = req.cookies[SESSION_COOKIE_NAME]

      clearSessionCookie(res)

      // Logout ≠ remove: clear every parked alt cookie too, but leave their
      // WorkOS sessions intact (explicit revoke is the /api/accounts/remove
      // path). This just empties the local cookie jar of all accounts.
      for (const { slot } of readAltSessionCookies(req.cookies)) {
        clearAltSessionCookie(res, slot)
      }

      const forwardedHost = req.headers["x-forwarded-host"] as string | undefined

      if (session) {
        // For dedicated-redirect-host sessions, tell WorkOS to single-logout
        // back to the same origin the user started on. Without this override,
        // WorkOS would redirect to the default `WORKOS_REDIRECT_URI`'s origin
        // and the user would land on the wrong frontend (e.g. the main app
        // when they started on the backoffice).
        const returnTo =
          forwardedHost && dedicatedRedirectHosts.includes(forwardedHost) ? `https://${forwardedHost}` : undefined
        const logoutUrl = await authService.getLogoutUrl(session, returnTo)
        if (logoutUrl) {
          return res.redirect(logoutUrl)
        }
      }

      // Fallback when there's no session or getLogoutUrl returned null.
      if (forwardedHost && isTrustedHost(forwardedHost, allowedRedirectDomain, dedicatedRedirectHosts)) {
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
