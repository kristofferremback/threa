import type { CookieOptions, Response } from "express"

const isProduction = process.env.NODE_ENV === "production"

export const parseCookies = (cookieHeader: string): Record<string, string> => {
  return cookieHeader.split(";").reduce(
    (acc, cookie) => {
      const [key, ...rest] = cookie.trim().split("=")
      const value = rest.join("=")
      if (key && value) {
        acc[key] = decodeURIComponent(value)
      }
      return acc
    },
    {} as Record<string, string>
  )
}

// Per-environment cookie name so staging and production sessions don't collide
// in a browser that has both open. Set `SESSION_COOKIE_NAME=wos_session` in
// production and `wos_session_staging` in staging.
//
// INV-11: the fallback default is intentionally loud — when the env var is
// unset we log a warning at module load so misconfiguration is observable
// (e.g. staging forgetting to override the value would otherwise silently
// reuse `wos_session` and clobber the prod cookie at `.threa.io`).
function resolveSessionCookieName(): string {
  const configured = process.env.SESSION_COOKIE_NAME
  if (configured) return configured
  console.warn(
    "[backend-common/cookies] SESSION_COOKIE_NAME is unset, falling back to 'wos_session'. " +
      "Set it explicitly per environment (prod: 'wos_session', staging: 'wos_session_staging')."
  )
  return "wos_session"
}

export const SESSION_COOKIE_NAME = resolveSessionCookieName()

/**
 * Max concurrent accounts in a single browser: 1 active + 7 parked alts.
 * Slot indices 0..6 map to cookies `${SESSION_COOKIE_NAME}_alt_${i}`.
 */
export const MAX_ACCOUNTS = 8
export const MAX_ALT_SLOTS = MAX_ACCOUNTS - 1

/** Cookie name for parked alt at index `slot` (0..MAX_ALT_SLOTS-1). */
export function altSessionCookieName(slot: number): string {
  return `${SESSION_COOKIE_NAME}_alt_${slot}`
}

export const SESSION_COOKIE_CONFIG = {
  path: "/",
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 30 * 1000, // 30 days
  // Honor COOKIE_DOMAIN whenever it's set. Staging needs this too so the
  // session set at staging.threa.io during the WorkOS callback is visible on
  // sibling PR subdomains like pr-204-staging.threa.io.
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
}

export type SessionCookieOptions = CookieOptions

function clearOptions(options: SessionCookieOptions): SessionCookieOptions {
  const { maxAge: _, ...rest } = options
  return rest
}

function hostOnlyOptions(options: SessionCookieOptions): SessionCookieOptions {
  const { domain: _, ...rest } = options
  return rest
}

export function setSessionCookie(
  res: Response,
  session: string,
  options: SessionCookieOptions = SESSION_COOKIE_CONFIG
): void {
  if (options.domain) {
    res.clearCookie(SESSION_COOKIE_NAME, clearOptions(hostOnlyOptions(options)))
  }
  res.cookie(SESSION_COOKIE_NAME, session, options)
}

export function clearSessionCookie(res: Response, options: SessionCookieOptions = SESSION_COOKIE_CONFIG): void {
  res.clearCookie(SESSION_COOKIE_NAME, clearOptions(options))
  if (options.domain) {
    res.clearCookie(SESSION_COOKIE_NAME, clearOptions(hostOnlyOptions(options)))
  }
}

/**
 * Set a parked alt-slot session cookie. Same flags/domain handling as the
 * active cookie — when COOKIE_DOMAIN is set we also clear any host-only
 * cookie that might be present so the browser doesn't end up with two cookies
 * of the same name at different scopes.
 */
export function setAltSessionCookie(
  res: Response,
  slot: number,
  session: string,
  options: SessionCookieOptions = SESSION_COOKIE_CONFIG
): void {
  assertSlot(slot)
  const name = altSessionCookieName(slot)
  if (options.domain) {
    res.clearCookie(name, clearOptions(hostOnlyOptions(options)))
  }
  res.cookie(name, session, options)
}

export function clearAltSessionCookie(
  res: Response,
  slot: number,
  options: SessionCookieOptions = SESSION_COOKIE_CONFIG
): void {
  assertSlot(slot)
  const name = altSessionCookieName(slot)
  res.clearCookie(name, clearOptions(options))
  if (options.domain) {
    res.clearCookie(name, clearOptions(hostOnlyOptions(options)))
  }
}

/**
 * Read every parked alt-slot session cookie from the request. Returns a sparse
 * array keyed by slot index — missing slots are `undefined`.
 */
export function readAltSessionCookies(cookies: Record<string, string | undefined>): Array<string | undefined> {
  const out: Array<string | undefined> = new Array(MAX_ALT_SLOTS)
  for (let i = 0; i < MAX_ALT_SLOTS; i++) {
    out[i] = cookies[altSessionCookieName(i)]
  }
  return out
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_ALT_SLOTS) {
    throw new Error(`Invalid alt session slot: ${slot} (expected 0..${MAX_ALT_SLOTS - 1})`)
  }
}
