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

// Multi-account: one active session cookie (SESSION_COOKIE_NAME) plus up to
// MAX_ALT_SLOTS "parked" alt cookies. The cap is bounded by the Cloudflare
// Workers request-header limit (~32 KB total, ~16 KB per header) — the browser
// concatenates every cookie for the origin into a single `Cookie:` header, so
// that combined header is the binding constraint. We size conservatively from
// documented worst-case inputs (an empirical staging measurement is recorded
// in the PR); PR-5 may only relax MAX_ACCOUNTS upward with a fresh measurement.
const WORST_CASE_SEALED_BYTES = 3072
const PER_COOKIE_OVERHEAD_BYTES = 32
// Conservative reservation for session cookies within the single `Cookie:`
// header: 13 KB, ~81% of the ~16 KB (16384 B) Cloudflare per-header limit,
// leaving ~3 KB for any non-session cookies on the origin.
const CONSERVATIVE_COOKIE_HEADER_BUDGET = 13312
// Per cookie: 3072 + 32 = 3104 B. (1 active + 3 alts) · 3104 = 12416 B ≤ 13312 B
// budget; the next bump (MAX_ACCOUNTS=5 → 15520 B) trips the guard below.
// Source of truth (INV-33); MAX_ALT_SLOTS is always derived (INV-31).
export const MAX_ACCOUNTS = 4
export const MAX_ALT_SLOTS = MAX_ACCOUNTS - 1

// Fails the build if MAX_ACCOUNTS is bumped past the documented header budget.
if ((1 + MAX_ALT_SLOTS) * (WORST_CASE_SEALED_BYTES + PER_COOKIE_OVERHEAD_BYTES) > CONSERVATIVE_COOKIE_HEADER_BUDGET) {
  throw new Error(
    `[backend-common/cookies] MAX_ACCOUNTS=${MAX_ACCOUNTS} exceeds the conservative ` +
      `Cookie-header budget (${CONSERVATIVE_COOKIE_HEADER_BUDGET} B). Re-measure the ` +
      `sealed-session size before raising it.`
  )
}

export function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_ALT_SLOTS) {
    throw new RangeError(`alt slot out of range: ${slot} (expected 0..${MAX_ALT_SLOTS - 1})`)
  }
}

// Env-scoped: derived from SESSION_COOKIE_NAME so a staging process
// (wos_session_staging) never names or reads prod alt cookies and vice versa.
export function altSessionCookieName(slot: number): string {
  assertSlot(slot)
  return `${SESSION_COOKIE_NAME}_alt_${slot}`
}

function clearOptions(options: SessionCookieOptions): SessionCookieOptions {
  const { maxAge: _, ...rest } = options
  return rest
}

function hostOnlyOptions(options: SessionCookieOptions): SessionCookieOptions {
  const { domain: _, ...rest } = options
  return rest
}

function setNamedSessionCookie(
  res: Response,
  name: string,
  value: string,
  options: SessionCookieOptions = SESSION_COOKIE_CONFIG
): void {
  if (options.domain) {
    res.clearCookie(name, clearOptions(hostOnlyOptions(options)))
  }
  res.cookie(name, value, options)
}

function clearNamedSessionCookie(
  res: Response,
  name: string,
  options: SessionCookieOptions = SESSION_COOKIE_CONFIG
): void {
  res.clearCookie(name, clearOptions(options))
  if (options.domain) {
    res.clearCookie(name, clearOptions(hostOnlyOptions(options)))
  }
}

export function setSessionCookie(
  res: Response,
  session: string,
  options: SessionCookieOptions = SESSION_COOKIE_CONFIG
): void {
  setNamedSessionCookie(res, SESSION_COOKIE_NAME, session, options)
}

export function clearSessionCookie(res: Response, options: SessionCookieOptions = SESSION_COOKIE_CONFIG): void {
  clearNamedSessionCookie(res, SESSION_COOKIE_NAME, options)
}

export function setAltSessionCookie(
  res: Response,
  slot: number,
  session: string,
  options: SessionCookieOptions = SESSION_COOKIE_CONFIG
): void {
  setNamedSessionCookie(res, altSessionCookieName(slot), session, options)
}

export function clearAltSessionCookie(
  res: Response,
  slot: number,
  options: SessionCookieOptions = SESSION_COOKIE_CONFIG
): void {
  clearNamedSessionCookie(res, altSessionCookieName(slot), options)
}

// Extract occupied alt slots from already-parsed cookies. Env-scoped: matches
// exactly `${SESSION_COOKIE_NAME}_alt_<n>`, so the active cookie and the other
// environment's alt cookies are ignored. Returns slots sorted ascending.
export function readAltSessionCookies(cookies: Record<string, string>): Array<{ slot: number; sealed: string }> {
  const prefix = `${SESSION_COOKIE_NAME}_alt_`
  const result: Array<{ slot: number; sealed: string }> = []
  for (const [name, value] of Object.entries(cookies)) {
    if (!name.startsWith(prefix) || !value) continue
    const slotStr = name.slice(prefix.length)
    if (!/^\d+$/.test(slotStr)) continue
    const slot = Number(slotStr)
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_ALT_SLOTS) continue
    result.push({ slot, sealed: value })
  }
  return result.sort((a, b) => a.slot - b.slot)
}
