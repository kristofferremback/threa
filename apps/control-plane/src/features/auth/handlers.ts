import type { Request, Response } from "express"
import { z } from "zod/v4"
import {
  HttpError,
  MAX_ALT_SLOTS,
  SESSION_COOKIE_NAME,
  clearAltSessionCookie,
  clearSessionCookie,
  decodeAndSanitizeRedirectState,
  displayNameFromWorkos,
  readAltSessionCookies,
  setAltSessionCookie,
  setSessionCookie,
  type AuthService,
} from "@threa/backend-common"

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
 * State carries `host|path` (forwarded-host redirect) and optionally a
 * trailing `|add` intent marker for the multi-account "Add account" flow.
 *
 * Format: base64( `host|path` ) or base64( `host|path|add` ) or base64( path ).
 * Detecting `|add` BY SUFFIX (not by pipe count) keeps the parser safe even if
 * a path itself contains a `|` — only the literal trailing `|add` triggers
 * intent handling.
 */
function parseCallbackState(state: string | undefined): { host: string | null; path: string; intent: "add" | null } {
  const decoded = state ? Buffer.from(state, "base64").toString("utf-8") : ""
  let intent: "add" | null = null
  let body = decoded
  if (body.endsWith("|add")) {
    intent = "add"
    body = body.slice(0, -"|add".length)
  }
  const pipeIndex = body.indexOf("|")
  if (pipeIndex !== -1) {
    const host = body.substring(0, pipeIndex)
    const path = decodeAndSanitizeRedirectState(Buffer.from(body.substring(pipeIndex + 1)).toString("base64"))
    return { host, path, intent }
  }
  const path = body ? decodeAndSanitizeRedirectState(Buffer.from(body).toString("base64")) : "/"
  return { host: null, path, intent }
}

/**
 * Park the currently-active sealed session into a free alt slot and set the
 * newly authenticated sealed session as active. Coalesce by userId — if the
 * new user already matches the active user or any parked alt's user, we
 * simply set them as active without duplicating a slot.
 */
async function parkActiveAndSetNewImpl(
  req: Request,
  res: Response,
  authService: AuthService,
  newUserId: string,
  newSealed: string
): Promise<void> {
  const currentActive = req.cookies[SESSION_COOKIE_NAME] as string | undefined

  // Coalesce against the current active user: if they're the same user, do
  // nothing exotic — just refresh the active cookie with the new sealed value.
  if (currentActive) {
    const activeAuth = await authService.authenticateSession(currentActive)
    if (activeAuth.success && activeAuth.user?.id === newUserId) {
      setSessionCookie(res, newSealed)
      return
    }
  }

  // Coalesce against any parked alt: if the new user matches a parked one,
  // swap them with the current active rather than burn an additional slot.
  const altCookies = readAltSessionCookies(req.cookies as Record<string, string | undefined>)
  for (let i = 0; i < altCookies.length; i++) {
    const altSealed = altCookies[i]
    if (!altSealed) continue
    const altAuth = await authService.authenticateSession(altSealed)
    if (altAuth.success && altAuth.user?.id === newUserId) {
      // Park the current active into slot i (where the duplicate was),
      // and set the new sealed as active. The alt cookie is overwritten
      // with the (different) current active session — keeps slot count
      // stable.
      if (currentActive) {
        setAltSessionCookie(res, i, currentActive)
      } else {
        // No active to park — just clear the alt slot since we promoted it.
        clearAltSessionCookie(res, i)
      }
      setSessionCookie(res, newSealed)
      return
    }
  }

  // New user — find a free slot to park the current active into.
  if (currentActive) {
    let freeSlot = -1
    for (let i = 0; i < altCookies.length; i++) {
      if (!altCookies[i]) {
        freeSlot = i
        break
      }
    }
    if (freeSlot === -1) {
      throw new HttpError("Account slots full — remove an account first", {
        status: 409,
        code: "MAX_ACCOUNTS_REACHED",
      })
    }
    setAltSessionCookie(res, freeSlot, currentActive)
  }
  setSessionCookie(res, newSealed)
}

export function createControlPlaneAuthHandlers({
  authService,
  frontendUrl,
  allowedRedirectDomain,
  dedicatedRedirectHosts,
}: Dependencies) {
  const parkActiveAndSetNew = (req: Request, res: Response, newUserId: string, newSealed: string) =>
    parkActiveAndSetNewImpl(req, res, authService, newUserId, newSealed)
  return {
    async login(req: Request, res: Response) {
      const redirectTo = req.query.redirect_to as string | undefined
      // `intent=add` is the multi-account "Add another account" flow: park the
      // currently-active sealed session into a free alt slot when the callback
      // lands and request `prompt=login` so WorkOS doesn't silently reuse the
      // tenant SSO session for the same user.
      const intent = req.query.intent === "add" ? "add" : null

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
      if (intent === "add") {
        // Suffix-encode intent so the parser can detect it without depending on
        // pipe count (path may itself contain `|`).
        statePayload = `${statePayload ?? "/"}|add`
      }

      const url = authService.getAuthorizationUrl(
        statePayload,
        redirectUriOverride,
        intent === "add" ? { prompt: "login" } : undefined
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

      const { host, path, intent } = parseCallbackState(state)
      const resolveRedirect = (): string => {
        if (host && isTrustedHost(host, allowedRedirectDomain, dedicatedRedirectHosts)) {
          return `https://${host}${path}`
        }
        return frontendUrl ? `${frontendUrl}${path}` : path
      }
      const redirectUrl = resolveRedirect()

      if (intent === "add") {
        // Multi-account add flow: park the currently-active session (if any
        // and it's a *different* user) into a free alt slot, then promote
        // the newly authenticated session as active. Coalesce by userId so
        // adding the same user twice doesn't duplicate slots.
        await parkActiveAndSetNew(req, res, result.user.id, result.sealedSession)
      } else {
        setSessionCookie(res, result.sealedSession)
      }
      res.redirect(redirectUrl)
    },

    async logout(req: Request, res: Response) {
      const session = req.cookies[SESSION_COOKIE_NAME]

      clearSessionCookie(res)
      // Full logout wipes every parked alt too so the next visit is a clean
      // logged-out state. Partial single-account removal goes through
      // POST /api/accounts/remove instead.
      for (let i = 0; i < MAX_ALT_SLOTS; i++) {
        clearAltSessionCookie(res, i)
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
