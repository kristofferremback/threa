# PR-1 — Backend-common multi-account primitives

## Context

This is the first implementation slice of the multi-account login split
(`docs/plans/multi-account-login-split.md`, PR #535). Multi-account login lets
one browser/PWA hold several authenticated accounts at once and switch between
them without logging out. The full feature is split into seven slices; PR-1 is
the foundational primitive layer.

**Why this slice exists / intended outcome:** ship the cookie + auth-URL
primitives every later slice depends on, as a *pure addition* with **no
callers, no behavior change, and the auth middleware untouched** — so it merges
risk-free and unblocks PR-3 (the `/api/accounts` contract). Concretely:

- "Parked alt" session cookies so a session can be stored without being active.
- `prompt` plumbing into the WorkOS authorization URL so PR-3 can force an
  AuthKit re-prompt on "add account" instead of silently reusing the hosted
  session (`@workos-inc/node@7.82.0` already types `prompt`).
- A conservative, measurement-backed `MAX_ACCOUNTS` cap so no later slice can
  create a state that overflows the Cloudflare Workers request-header limit.

Two invariants drive the design and are preserved end-to-end:

- **Environment isolation:** every cookie derives its name from the env-scoped
  `SESSION_COOKIE_NAME` (prod `wos_session`, staging `wos_session_staging`).
  Prod sessions + their parked alts coexist in one browser with staging
  sessions + their parked alts, zero collision. No hardcoded `wos_session`.
- **Auth middleware unchanged:** `packages/backend-common/src/auth/middleware.ts`
  still reads exactly `req.cookies[SESSION_COOKIE_NAME]`. Alt cookies are
  storage-only; PR-1 adds no reader for them.

## Current state (verified)

- `packages/backend-common/src/cookies.ts` (80 lines):
  - `SESSION_COOKIE_NAME` = `resolveSessionCookieName()` reads
    `process.env.SESSION_COOKIE_NAME`, loud INV-11 fallback to `wos_session`
    (lines 27–37).
  - `SESSION_COOKIE_CONFIG` (lines 39–49): path/httpOnly/secure/sameSite/maxAge
    + conditional `domain` from `COOKIE_DOMAIN`.
  - Private `clearOptions()` (strips `maxAge`, lines 53–56) and
    `hostOnlyOptions()` (strips `domain`, lines 58–61).
  - `setSessionCookie(res, session, options?)` (63–72): if `options.domain`,
    first clears a host-only same-name cookie, then sets. **Name hardcoded to
    `SESSION_COOKIE_NAME`.**
  - `clearSessionCookie(res, options?)` (74–79): clears, then host-only clears
    if domain. **Name hardcoded.**
  - `parseCookies(cookieHeader)` (5–17): `Record<string,string>`.
  - Exports: `parseCookies`, `SESSION_COOKIE_NAME`, `SESSION_COOKIE_CONFIG`,
    `SessionCookieOptions` (type), `setSessionCookie`, `clearSessionCookie`.
- `packages/backend-common/src/index.ts` (105–111): named re-export of those 6
  symbols (`export { … } from "./cookies"` + `export type { … }`).
- `packages/backend-common/src/auth/auth-service.ts`:
  - `AuthService` interface `getAuthorizationUrl(redirectTo?, redirectUri?): string`
    (line 43).
  - `WorkosAuthService.getAuthorizationUrl` (168–175) calls
    `this.workos.userManagement.getAuthorizationUrl({ provider:"authkit",
    redirectUri, clientId, state })`.
  - Constructed from `WorkosConfig` (ctor 64–69).
- `packages/backend-common/src/auth/auth-service.stub.ts`
  `getAuthorizationUrl` (128–137): returns `/test-auth-login?…` encoding
  `state` and optional `redirect_uri` into query params.
- WorkOS SDK `@workos-inc/node@7.82.0`,
  `lib/user-management/interfaces/authorization-url-options.interface.d.ts`:
  `UserManagementAuthorizationURLOptions` includes `prompt?: string`,
  `loginHint?: string`, `screenHint?: 'sign-up'|'sign-in'`. No cast needed.
- Only production caller of `getAuthorizationUrl`:
  `apps/control-plane/src/features/auth/handlers.ts:87` (2 args). **Not changed
  in PR-1** — `intent=add → prompt:"login"` wiring is PR-3.
- Test conventions: `packages/backend-common/src/cookies.test.ts` uses
  `bun:test` (`describe/test/expect`), a `makeResponseRecorder()` faking
  `res.cookie/clearCookie` into a `calls[]` array, and `beforeAll` that sets
  `process.env.SESSION_COOKIE_NAME="wos_session_test"` then dynamically
  `import("./cookies")`. Whole-object `expect(calls).toEqual([...])` assertions
  (INV-24).

## Design

### 1. `cookies.ts` — extract a name-parameterized core, then add alt helpers

**Reuse, do not duplicate (INV-35, INV-29):** the host-only dual-clear logic
must live on one path. Extract internal cores and rebind the existing public
functions to them so their signatures/behavior are byte-identical (middleware
and all current consumers untouched):

```ts
function setNamedSessionCookie(res, name, value, options = SESSION_COOKIE_CONFIG) {
  if (options.domain) res.clearCookie(name, clearOptions(hostOnlyOptions(options)))
  res.cookie(name, value, options)
}
function clearNamedSessionCookie(res, name, options = SESSION_COOKIE_CONFIG) {
  res.clearCookie(name, clearOptions(options))
  if (options.domain) res.clearCookie(name, clearOptions(hostOnlyOptions(options)))
}
export function setSessionCookie(res, session, options = SESSION_COOKIE_CONFIG) {
  setNamedSessionCookie(res, SESSION_COOKIE_NAME, session, options)
}
export function clearSessionCookie(res, options = SESSION_COOKIE_CONFIG) {
  clearNamedSessionCookie(res, SESSION_COOKIE_NAME, options)
}
```

Add the constants (INV-33 source of truth, INV-31 derived type):

```ts
// derivation documented inline (see Verification → Sizing); mirrors the
// slug.ts MAX_SLUG_LENGTH source-of-truth precedent
const WORST_CASE_SEALED_BYTES = 3072
const PER_COOKIE_OVERHEAD_BYTES = 32
const CONSERVATIVE_COOKIE_HEADER_BUDGET = 12288
export const MAX_ACCOUNTS = 4   // (1 active + 3 alts)·~3.1KB ≈ 12KB ≤ budget
export const MAX_ALT_SLOTS = MAX_ACCOUNTS - 1   // always derived, never a literal
```

Add the alt helpers, all routed through the env-scoped base:

```ts
export function altSessionCookieName(slot: number): string {
  assertSlot(slot)
  return `${SESSION_COOKIE_NAME}_alt_${slot}`
}
export function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_ALT_SLOTS)
    throw new RangeError(`alt slot out of range: ${slot} (0..${MAX_ALT_SLOTS - 1})`)
}
export function setAltSessionCookie(res, slot, session, options = SESSION_COOKIE_CONFIG) {
  setNamedSessionCookie(res, altSessionCookieName(slot), session, options)
}
export function clearAltSessionCookie(res, slot, options = SESSION_COOKIE_CONFIG) {
  clearNamedSessionCookie(res, altSessionCookieName(slot), options)
}
// Parse occupied alt slots out of already-parsed cookies, env-scoped:
// ignores the active cookie and the *other* environment's alts.
export function readAltSessionCookies(
  cookies: Record<string, string>
): Array<{ slot: number; sealed: string }>
```

`readAltSessionCookies` reuses `parseCookies` upstream (callers pass
`req.cookies` or `parseCookies(header)`); it matches exactly
`^${SESSION_COOKIE_NAME}_alt_(\d+)$`, so a staging process (base
`wos_session_staging`) never reads prod `wos_session_alt_*` and vice versa,
and the active cookie is never mistaken for slot data. Returns slots sorted
ascending, only those present and non-empty.

`MAX_ACCOUNTS` value: ship a conservative integer whose derivation is
documented inline (worst-case sealed-session byte size × slots + cookie
overhead must fit the Cloudflare Workers request-header budget). Exact number +
methodology finalized from the sealed-session sizing investigation (see
Verification → Sizing). PR-5 may only relax it upward with measured headroom.

### 2. `index.ts` — barrel re-export

Extend the existing named re-export block (lines 105–111) with
`MAX_ACCOUNTS`, `MAX_ALT_SLOTS`, `altSessionCookieName`, `assertSlot`,
`setAltSessionCookie`, `clearAltSessionCookie`, `readAltSessionCookies`. Same
style (named `export { … } from "./cookies"`). No `export *`.

### 3. `auth-service.ts` / `.stub.ts` — `prompt` plumbing

- Interface (line 43):
  `getAuthorizationUrl(redirectTo?: string, redirectUri?: string, options?: { prompt?: string }): string`
  + a one-line JSDoc on `options.prompt` ("forces AuthKit re-prompt; used by
  the add-account flow in PR-3").
- `WorkosAuthService` impl (168–175): spread
  `...(options?.prompt ? { prompt: options.prompt } : {})` into the SDK call
  object. No `as any` — `prompt` is typed by 7.82.0.
- Stub (128–137): accept the third arg; when `options?.prompt` is set, add
  `params.set("prompt", options.prompt)` to the returned test URL (mirrors the
  stub's existing state/redirect_uri encoding so stub-mode tests can assert).
- `middleware.test.ts:13` `FakeAuthService` — widen its `getAuthorizationUrl`
  signature to match the interface (compile-only; no behavior).
- **No production call-site change.** `handlers.ts:87` keeps calling with 2
  args; passing `prompt:"login"` on `intent=add` is PR-3.

### 4. Tests

`packages/backend-common/src/cookies.test.ts` — add to the existing file,
reuse `makeResponseRecorder()` and the `beforeAll` dynamic-import pattern:

- `MAX_ALT_SLOTS === MAX_ACCOUNTS - 1`; `MAX_ACCOUNTS` is a positive integer.
- Header-budget invariant: `(1 + MAX_ALT_SLOTS) * (WORST_CASE_SEALED_BYTES +
  PER_COOKIE_OVERHEAD_BYTES) <= CONSERVATIVE_COOKIE_HEADER_BUDGET` (this is the
  CI guard that fails if anyone bumps `MAX_ACCOUNTS` past the documented size).
- `assertSlot`: accepts `0..MAX_ALT_SLOTS-1`; throws `RangeError` for `-1`,
  `MAX_ALT_SLOTS`, non-integers.
- `altSessionCookieName` env-scoping: under `SESSION_COOKIE_NAME=wos_session_test`,
  slot 0 → `wos_session_test_alt_0`. (A second `describe` with its own
  `beforeAll` setting `wos_session_staging` asserting `wos_session_staging_alt_0`
  ≠ the prod-style name — proves no collision.)
- `setAltSessionCookie`/`clearAltSessionCookie` reproduce the exact host-only
  dual-clear `calls[]` shape the existing active-cookie tests assert, but under
  the alt name (whole-object `toEqual`, INV-24).
- `readAltSessionCookies`: given a jar mixing active cookie, two occupied alt
  slots, the *other environment's* alt cookie, and noise → returns only this
  env's occupied slots, sorted, `{slot,sealed}` shape; ignores the active
  cookie.

`auth-service.stub.test.ts` (new, small, mirrors stub conventions) — or extend
an existing stub test if the sizing investigation finds one:

- `getAuthorizationUrl(to, uri)` → no `prompt` in URL.
- `getAuthorizationUrl(to, uri, { prompt: "login" })` → `prompt=login` present.

## Critical files

| File | Change |
|---|---|
| `packages/backend-common/src/cookies.ts` | extract `setNamedSessionCookie`/`clearNamedSessionCookie`; add `MAX_ACCOUNTS`, `MAX_ALT_SLOTS`, `altSessionCookieName`, `assertSlot`, `setAltSessionCookie`, `clearAltSessionCookie`, `readAltSessionCookies` |
| `packages/backend-common/src/index.ts` | re-export the 7 new symbols (lines 105–111 block) |
| `packages/backend-common/src/auth/auth-service.ts` | `options?: { prompt?: string }` on interface (43) + impl (168–175) |
| `packages/backend-common/src/auth/auth-service.stub.ts` | mirror signature; encode `prompt` into stub URL (128–137) |
| `packages/backend-common/src/auth/middleware.test.ts` | widen `FakeAuthService.getAuthorizationUrl` signature (13) |
| `packages/backend-common/src/cookies.test.ts` | add alt-cookie + env-scoping + constants tests |
| `packages/backend-common/src/auth/auth-service.stub.test.ts` | new: `prompt` plumbing tests |

## Verification

**Unit:** `bun run test` filtered to `packages/backend-common` (cookies +
auth-service stub). All new tests green; existing cookies/middleware tests
still green (proves the core extraction is behavior-preserving).

**Typecheck:** `bun run --cwd packages/backend-common typecheck` and the
control-plane typecheck (confirms the interface change is source-compatible at
`handlers.ts:87` with no edit there).

**No-behavior-change proof:** `git grep` shows zero new imports of the alt
helpers in `apps/*` (PR-1 has no callers); `middleware.ts` diff is empty.

**Sizing (set `MAX_ACCOUNTS`) — resolved approach:**

Facts: a real WorkOS sealed session is produced only by
`workos.userManagement.authenticateWithCode({ session:{ sealSession:true,
cookiePassword } })` (Iron-encrypted; needs live WorkOS creds — `auth-service.ts:133`).
Cloudflare Workers limit ≈ 32 KB total request headers, ≈ 16 KB per single
header; the browser concatenates **all** cookies for the origin into one
`Cookie:` request header, so that combined header is the binding constraint.
No header-limit constant exists in `apps/workspace-router`.

To keep PR-1 a risk-free pure addition (no live WorkOS dependency in CI), split
"measurement-backed" into two parts:

1. **Documented worst-case constants + a static budget test (in PR-1, in CI).**
   In `cookies.ts`, alongside `MAX_ACCOUNTS`, add documented constants:
   `WORST_CASE_SEALED_BYTES` (conservative upper bound for a WorkOS sealed
   session — sealed access-JWT + refresh token + user, Iron base64 expansion;
   budget ~3 KB), `PER_COOKIE_OVERHEAD_BYTES` (name incl. longest env prefix
   `wos_session_staging_alt_<n>` + `=` + `; ` ≈ 32 B),
   `CONSERVATIVE_COOKIE_HEADER_BUDGET` (defensive slice of the single `Cookie:`
   header reserved for session cookies, well under the 16 KB per-header limit
   with room for non-session cookies — propose 12 KB). A unit test asserts the
   invariant holds:
   `(1 + MAX_ALT_SLOTS) * (WORST_CASE_SEALED_BYTES + PER_COOKIE_OVERHEAD_BYTES)
   <= CONSERVATIVE_COOKIE_HEADER_BUDGET`. With the proposed numbers this yields
   a conservative **`MAX_ACCOUNTS = 4`** (1 active + 3 alts ≈ 12 KB). The
   constant is derived/clamped from these documented inputs (INV-33 source of
   truth, mirrors the `slug.ts` `MAX_SLUG_LENGTH` precedent), not a bare
   literal, with an inline comment showing the arithmetic.

2. **One-off empirical confirmation (pre-merge manual step, recorded — NOT in
   CI).** Before merge, run `authenticateWithCode` once against the staging
   WorkOS environment, log `Buffer.byteLength(sealedSession,"utf8")`, and
   record the observed size in the PR description and the `cookies.ts` inline
   comment. If the observed size exceeds `WORST_CASE_SEALED_BYTES`, lower
   `MAX_ACCOUNTS` (re-run the static test). PR-5 relaxes the cap upward only
   with a fresh measurement showing headroom.

This honors the split plan ("PR-1 owns the measurement-backed conservative
default; PR-5 relaxes upward") while keeping PR-1's test suite hermetic.

## Out of scope (later slices)

`/api/accounts` endpoints, park/coalesce/switch logic, `intent=add` callback
wiring, logout-clears-alts (PR-3); frontend AccountScope (PR-4a); switcher UX
and the cap *relaxation* (PR-5); push (PR-6); backoffice cookie rename (PR-2).
