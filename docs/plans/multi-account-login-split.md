# Multi-Account Login Split: Active Session + Parked Alts, Per-Account Client Isolation

## Context

PR #487 (`claude/multi-workspace-login-bprxi`) implements multi-account login —
the same browser/PWA holding several authenticated accounts at once (personal +
work, or two users sharing a device) and switching between them without logging
out. It works, but it bundles eight concerns into one review:

1. Backend-common cookie + auth-URL primitives (alt-slot cookies, `prompt` plumbing)
2. Backoffice session-cookie rename (`wos_session` → `wos_session_backoffice`)
3. `/api/accounts` control-plane contract (list / switch / remove) + OAuth `intent=add`
4. Per-account client isolation (Dexie-per-account, scoped QueryClient, scoped stores)
5. Account switcher UX (dialog, sidebar footer, workspace-select)
6. Cross-account push + notification-click account switch
7. A WorkOS compatibility "verification gate" + probe script
8. The design doc itself (`docs/plans/multi-account-login.md`)

That is far too much for one review, and concern (7) is dead weight: WorkOS's
installed SDK (`@workos-inc/node@7.82.0`) **types** `prompt`, `loginHint`, and
`screenHint` on `UserManagementAuthorizationURLOptions`. We use WorkOS's hosted
AuthKit; if it is in their typed SDK surface it works. There is no gate, no
probe script, and no logout-first fallback anywhere in this split.

This doc splits PR #487 into seven independently mergeable, independently
verifiable slices, modeled on `docs/plans/phase2-pr5-split.md`. It does **not**
copy PR #487 verbatim — it folds the known bugs into the slices that own them
and replaces the hard-reload-on-switch approach with a properly scoped
**AccountScope** architecture so switching never drops the cache.

### Security invariants (preserved across every slice)

- **Scope cannot leak.** Every locally-cached, persisted, or in-memory
  account-derived resource is keyed by **both** `workspace_id` **and**
  `workosUserId` (or the user-scoped equivalent). No shared singleton serves
  two accounts' data.
- **The auth middleware does not change.** `packages/backend-common/src/auth/middleware.ts`
  still reads exactly `req.cookies[SESSION_COOKIE_NAME]`, runs one
  `authenticateSession`, and sets `req.authUser`. One request → one validated
  `workosUserId`. Alt slots are storage-only and read by exactly four
  control-plane endpoints. This unchanged property is the core guarantee that
  makes the other slices safe.
- **Three combinations must work securely:** (a) two different users, same
  workspace; (b) same user, two workspaces; (c) two different users, two
  workspaces — including the cross-tab case.
- **Push keeps working** with deep-linking and a seamless account-switch on
  notification click, keyed by at least account ID + workspace ID.
- **Environment isolation is preserved.** Every cookie this feature introduces
  (active and parked-alt) derives its name from the env-scoped
  `SESSION_COOKIE_NAME`. A production session and its parked alts coexist in
  the same browser with a staging session and its parked alts without either
  reading or clobbering the other. No slice hardcodes a bare `wos_session`
  literal.

### Cookie model (used by PR-1 / PR-3)

The **active** session cookie keeps the existing env-scoped name
`SESSION_COOKIE_NAME` (resolved per environment from `process.env`: prod
`wos_session`, staging `wos_session_staging`), read by the unchanged auth
middleware. The **parked alt** cookies are derived from that same base —
`${SESSION_COOKIE_NAME}_alt_<n>` — so they are environment-scoped exactly like
the active cookie: prod parks into `wos_session_alt_<n>`, staging parks into
`wos_session_staging_alt_<n>`. Up to `MAX_ALT_SLOTS` of them, HttpOnly,
storage-only, read only by the four control-plane account endpoints.
`MAX_ALT_SLOTS = MAX_ACCOUNTS - 1` — the two constants are always coupled.
Parking ≡ moving the current sealed session into a free alt slot; switching ≡
swapping an alt into the active slot.

Because every alt name flows from the env-scoped base, a browser at a shared
parent domain can hold a production session **plus its parked alts**
_alongside_ a staging session **plus its parked alts** with zero collision —
no slice ever hardcodes `wos_session`. This is existing behavior the split
must preserve, not new behavior to invent.

`MAX_ACCOUNTS` ships from the very first slice that introduces the constant
(PR-1) at a **conservative, measurement-backed default** — the WorkOS
sealed-session size vs. the Cloudflare Workers request-header limit is measured
in PR-1, and the constant is set to a value that provably fits. PR-5 may only
**relax it upward** if PR-1's measurement showed headroom; it never first-sets
an unvalidated cap. This ordering means no slice between PR-3 (which enforces
the cap server-side) and PR-5 can ever create a production state that exceeds
the header limit.

---

## Sub-PR Sequence

### PR-0 — Corrected design doc (no runtime)

**Scope:** Documentation only. Zero runtime risk, lands first so reviewers of
later slices have an accurate reference.

**Changes:**

- Bring `docs/plans/multi-account-login.md` (from PR #487) into `docs/plans/`
  with corrections:
  - Real endpoint paths: `/api/accounts`, `/api/accounts/switch`,
    `/api/accounts/remove` (the doc currently abstracts these).
  - Reconcile the slot-visibility contradiction: the doc claims "slots never
    appear in client-visible APIs" but `AccountSummary.slot` is returned to the
    client. Decision recorded here: the client receives a **server-issued
    opaque stable account id**, never the raw slot index; dead/expired alts get
    a stable placeholder id, not `slot:-1`.
  - Fenced code blocks get language tags.
  - **Delete** the "WorkOS compatibility" section, the verification gate, the
    probe script description, and every mention of a logout-first fallback.
    Replace with one plain sentence: _SDK 7.82.0 types `prompt`, `loginHint`,
    and `screenHint` on `UserManagementAuthorizationURLOptions`; on
    `intent=add` we pass `prompt: "login"` so AuthKit re-prompts instead of
    silently reusing the existing hosted session._
- `.gitignore`: ignore any local probe/scratch artifacts if PR #487 added them.

**Reuse:** PR #487's doc body and test matrix (cookie model, terminology,
switcher UX, migration) verbatim where still accurate.

**Verification:** Doc review only. No code, no tests, no wiring.

---

### PR-1 — Backend-common primitives (CP/regional shared)

**Scope:** Pure addition in `packages/backend-common`. No callers yet, no
behavior change. The auth middleware is **not** touched.

**Changes:**

- `packages/backend-common/src/cookies.ts`:
  - `MAX_ACCOUNTS` set to a conservative, measurement-backed default (this
    slice owns the constant — INV-33 source of truth — so the
    sealed-session-vs-header-limit measurement happens here, not in PR-5);
    `MAX_ALT_SLOTS = MAX_ACCOUNTS - 1`, always derived, never a separate
    literal.
  - `altSessionCookieName(slot)` returns `` `${SESSION_COOKIE_NAME}_alt_${slot}` ``
    — derived from the **existing env-scoped base** (prod `wos_session`,
    staging `wos_session_staging`), never a hardcoded `wos_session` literal, so
    staging and production each get an independent parked-cookie namespace.
  - `setAltSessionCookie`, `clearAltSessionCookie`, `readAltSessionCookies`,
    `assertSlot(slot)` (throws on out-of-range) — all routed through
    `altSessionCookieName` and the shared cookie-options factory (same
    `COOKIE_DOMAIN` / host-only / clear semantics as the active cookie).
  - Host-only cookie clearing path when `COOKIE_DOMAIN` is set (so alt cookies
    clear on the exact host they were set on).
- `packages/backend-common/src/index.ts`: re-export the new helpers.
- `packages/backend-common/src/auth/auth-service.ts`:
  - `getAuthorizationUrl(redirectTo?, redirectUri?, options?: { prompt?: string })`
    spreading `...(options?.prompt ? { prompt: options.prompt } : {})` into the
    WorkOS call. No `as any` — `prompt` is typed by the SDK.
- `packages/backend-common/src/auth/auth-service.stub.ts`: matching stub
  signature so tests and offline dev keep compiling.

**Reuse:** Existing `SESSION_COOKIE_NAME` constant and cookie option builder;
the new helpers share the same options factory (INV-33, INV-35).

**Verification:**

- `bun run test` over `backend-common` cookie + auth-service suites: round-trip
  set/read/clear for every slot, `assertSlot` rejects out-of-range,
  `getAuthorizationUrl` includes `prompt` only when passed.
- Sealed-session size measured against the Cloudflare Workers request-header
  limit; `MAX_ACCOUNTS` recorded with the measured worst-case header budget so
  later slices inherit a provably-safe cap.
- Env-scoping test: with `SESSION_COOKIE_NAME=wos_session_staging`,
  `altSessionCookieName(0)` resolves to `wos_session_staging_alt_0`; with the
  prod value it resolves to `wos_session_alt_0`. A prod and a staging set
  round-trip in the same jar without collision.
- No endpoints, no migrations, no middleware change. Risk-free merge.

---

### PR-2 — Backoffice session-cookie rename (standalone)

**Scope:** Rename the backoffice app's session cookie so a backoffice session
never collides with a product session on a shared parent domain. The rename is
still env-scoped through the same `SESSION_COOKIE_NAME` env-var mechanism: prod
backoffice `wos_session_backoffice`, staging backoffice
`wos_session_backoffice_staging` — no hardcoded literal. Fully independent of
every other slice; can land any time.

**Changes:**

- Backoffice deploy config: set the backoffice service's per-environment
  `SESSION_COOKIE_NAME` value (`wos_session_backoffice` in prod,
  `wos_session_backoffice_staging` in staging). Same resolution mechanism as
  the product service — only the configured value differs.
- Backoffice auth wiring: read/write/clear the renamed cookie consistently
  (login, logout, middleware).
- Rollout note in the PR body: this is a one-time forced backoffice
  re-login on deploy (old cookie name is abandoned, not migrated).

**Reuse:** Same cookie helpers; only the name constant changes for backoffice.

**Verification:**

- Prod backoffice login → cookie set as `wos_session_backoffice`; product
  `wos_session` and any `wos_session_alt_<n>` on the same browser are untouched.
- Staging backoffice login → `wos_session_backoffice_staging`; coexists with
  prod backoffice and with staging product `wos_session_staging` + its alts.
- Backoffice logout clears only the backoffice cookie for that environment.
- Existing backoffice e2e/auth suite green.

---

### PR-3 — `/api/accounts` server contract + OAuth `intent=add` (CP, depends PR-1)

**Scope:** The control-plane account-management contract. Park/coalesce on
add, list/switch/remove, logout clears all alts. Server-side only; no
frontend.

**Changes:**

- `apps/control-plane/src/features/accounts/` (INV-51 colocated feature):
  - `handlers.ts`: `list`, `switch`, `remove`.
    - `switchSchema` (Zod, INV-55): `{ targetUserId }`.
    - `removeSchema`: union `{ targetUserId } | { stableAccountId }` — never a
      raw slot index over the wire (PR-0 decision).
    - `list` returns `AccountSummary[]` with the **server-issued opaque stable
      account id**; dead/expired alts get a stable placeholder id, not
      `slot:-1`.
  - `service.ts`: park/coalesce/swap logic over the alt cookies (INV-6 owns the
    transaction-equivalent cookie mutation sequence; handler stays thin,
    INV-34).
- `apps/control-plane/src/features/auth/handlers.ts`:
  - `parseCallbackState` detects the `|add` state suffix.
  - `parkActiveAndSetNew`: coalesce by `workosUserId` (same account re-auth →
    refresh in place, no new slot), else park active into a free alt slot, else
    **graceful** `MAX_ACCOUNTS_REACHED` — a redirect to a UX route with the
    error code, **not** a thrown error page mid-OAuth-callback (folded fix from
    PR #487).
  - `login` adds `intent=add` → passes `prompt: "login"` into
    `getAuthorizationUrl` (PR-1 plumbing).
  - `logout` clears the active cookie **and every alt slot**.
- `apps/control-plane/src/routes.ts`: register
  `GET /api/accounts` (auth + `authLimit`),
  `POST /api/accounts/switch` (auth + `authLimit`),
  `POST /api/accounts/remove` (auth + `authLimit`).

**Folded fixes (from the PR #487 review):**

- `remove` performs a **real WorkOS session revoke**, not
  `getLogoutUrl(...).catch(() => null)` (that only builds a URL and revokes
  nothing). Use the SDK's actual revoke/logout-session call on the sealed
  session being removed.
- Per-alt `authenticateSession` calls in `list`/park loops run **in parallel**
  (`Promise.all`), not sequentially.
- `list` gets `authLimit` (it was missing in PR #487).

**Reuse:** PR-1 cookie + auth-service helpers; existing `authLimit` middleware;
existing callback-state plumbing.

**Verification:**

- e2e: login account A → `intent=add` → login account B → `GET /api/accounts`
  lists both with stable ids; `switch` to A flips the active cookie; A's
  requests resolve as A, B's parked cookie still valid.
- Coalesce: re-auth the active account → no new slot, session refreshed.
- 8th add → graceful `MAX_ACCOUNTS_REACHED` redirect, no error page.
- `remove` → that session is actually revoked at WorkOS (subsequent use of
  that sealed session fails).
- `logout` → active + all alt cookies cleared.
- Non-authed caller → 401; rate limit enforced on all three endpoints.

---

### PR-4a — AccountScope foundation (frontend, no UI, depends PR-3)

**Scope:** Replace PR #487's hard-reload-and-drop-cache switch with a properly
scoped reactive **AccountScope**. No switcher UI yet — this slice only proves
that account-scoped state is fully isolated and switchable in place.

**Changes:**

- `apps/frontend/src/auth/account-scope.tsx` (new): a context holding the
  active `workosUserId`, plus per-account registries:
  - `getDb(workosUserId)` → per-account Dexie database `threa_<workosUserId>`
    (replaces `resolveDbName()` / the single `db` singleton).
  - `getQueryClient(workosUserId)` → per-account TanStack QueryClient
    (rejected alternative: key-prefixing a shared client — too leak-prone).
  - `getStores(workosUserId)` → per-account store instances (workspace-store
    et al. become scope-derived, not module singletons).
- Convert `db`, `workspace-store`, and the query-client provider from
  module-level singletons to AccountScope-derived lookups.
- Socket.io: reconnect on active-account change (cookie-authed at handshake)
  and **re-run the bootstrap fetch** so there is no event gap (INV-53: socket
  subscription always paired with bootstrap, invalidated on resubscribe).
- localStorage re-keying so nothing is shared across accounts:
  - sidebar state → `threa-sidebar-state:${workosUserId}:${workspaceId}`
  - appearance → `threa-appearance:${workosUserId}`
  - push opt-out → `…:${workosUserId}:${workspaceId}`
- Delete `ensureDbMatchesUser` and its `window.location.reload()`.
- Resolve the dead `window.__eagerAuthPromise` path (index.html half-missing in
  PR #487) — remove it; AccountScope is the single source of the active
  account.
- Cross-tab: BroadcastChannel `threa-auth` `switched` message → other tabs
  **flip AccountScope in place and abort in-flight queries**, instead of
  reloading. Storage isolation (separate DB + QueryClient + stores) means
  correctness does not depend on the timing of the flip.

**Reuse:** Existing Dexie schema (same tables, new DB name per account);
existing TanStack Query setup (same keys, new client per account); existing
socket bootstrap/invalidate path (INV-53).

**Verification (headline test):** Programmatically set two accounts (PR-3
contract), switch the active account **in app with no reload**, and assert
**zero cross-account reads** at the IndexedDB layer, the QueryClient cache, and
every scoped store — across all three combinations (a/b/c above) **including
the cross-tab window** (switch in tab 1, assert tab 2 flips and serves no stale
account data).

---

### PR-4b — Cross-account entry resolver (depends PR-4a)

**Scope:** The resolve→flip→route primitive so an entry point that belongs to
a _parked_ account flips to that account in place (PR-4a `switchAccount`,
keyed remount, no reload) instead of dead-ending on the active account's
`403/404` bootstrap. Backend owns **one endpoint with two mutually exclusive
forms**; PR-4b's frontend uses only the bare-link form.

**Backend — `GET /api/accounts/resolve` (control plane):**

- **Identity form** (`?userId=`, the PR-6 notification primitive, built+tested
  now): resolve to _that exact_ signed-in account and **never substitute** a
  different signed-in account that merely also has read access. Not signed in
  on this browser → `404 ACCOUNT_NOT_SIGNED_IN` (caller does a full login as
  that user). An optional `workspaceId` is checked as defence-in-depth against
  a stale notification → `404 WORKSPACE_NOT_RESOLVABLE`.
- **Bare-workspace form** (`?workspaceId=` only, PR-4b's frontend trigger):
  membership is the only (ambiguous) selector, so resolve **only if exactly
  one** signed-in account is a member; `0` or `2+` →
  `404 WORKSPACE_NOT_RESOLVABLE` (caller keeps today's bounce; PR-5's switcher
  disambiguates the multi-member case). Never guess an arbitrary account.
- `AccountsService.resolve` reuses the existing `resolveAlts` and the file's
  parallel-not-serial idiom; membership is the in-process
  `ControlPlaneWorkspaceService.isMember` (control plane is the source of
  truth — no internal HTTP hop), injected as a narrow `MembershipChecker`.

**Frontend — replace the terminal-error bounce with resolve→flip:**

- `apps/frontend/src/api/accounts.ts` (new): `accountsApi.resolve(workspaceId)`
  (bare-workspace form only; the `userId` form has no caller until PR-6).
- `useResolveOrBounce(workspaceId, syncEngine)` (new, colocated with
  `workspace-layout`): on a terminal `403/404`, resolve once per workspace
  error; a _different_ owner → `switchAccount` (no navigation, last-workspace
  preserved — PR-4a's keyed remount re-bootstraps the same URL under the
  owner); otherwise the unchanged guarded bounce to `/workspaces`.

**Reuse:** `AccountsService.resolveAlts`; `ControlPlaneWorkspaceService.isMember`;
PR-4a `useAccountScope().switchAccount` + keyed remount; `api.get`/`ApiError`.

**Verification:** Backend e2e — identity active/parked; never-substitute (a
workspace-readable but not-signed-in account → 404, not a fallback);
identity + stale membership → 404; bare-workspace form unique-member → owner;
bare-workspace form `0`/`2+` members → 404 (no arbitrary pick); handler
400/401. Frontend — the
hook flips on a different owner (no navigate, last-workspace kept), bounces on
backend 404 / self-owner, and attempts resolve at most once per workspace
error.

**PR-6 becomes a trivial caller of the identity form** (notification payload
carries the recipient member's `workosUserId`).

---

### PR-5 — Account switcher UX (depends PR-4a)

**Scope:** The user-facing switcher on top of the AccountScope foundation.

**Changes:**

- Switcher dialog + sidebar-footer entry point; "add account" triggers the
  `intent=add` OAuth login (PR-3).
- Workspace-select flow skips the redirect when switching purely between
  already-parked accounts.
- True in-app switch: call `POST /api/accounts/switch` → flip AccountScope →
  socket reconnect → re-bootstrap. **No `window.location.reload()` anywhere.**
- Reconcile slot visibility end-to-end: UI shows the server-issued opaque
  stable account id (PR-0/PR-3 decision); dead alts render a re-auth affordance
  using the stable placeholder id.
- Revisit the account cap: PR-1 already shipped a measurement-backed
  conservative `MAX_ACCOUNTS`. This slice may only **relax it upward** if
  PR-1's recorded header budget showed headroom (and re-measure to confirm);
  it never first-sets or raises an unvalidated cap. Record the final value in
  PR-0's doc.

**Reuse:** PR-4a AccountScope + registries; PR-3 endpoints; existing Shadcn
dialog/menu primitives (INV-14); navigation via links / actions via buttons
(INV-40).

**Verification:**

- All three combinations switchable from the UI with no reload and no
  cross-account data flash.
- Add-account from the switcher → AuthKit re-prompts (`prompt: "login"`), new
  account parked, list updates.
- Dead alt → re-auth affordance works and re-coalesces the account.
- Header-size measurement documented; cap confirmed.

---

### PR-6 — Cross-account push + notification-click switch (depends PR-4b; parallel with PR-5)

**Scope:** Make push notifications multi-account aware. This is **net-new**
work — PR #487's service worker navigates to `/w/${workspaceId}/…` with no
identity awareness and `PushData` carries no `workosUserId`.

**Changes:**

- Push payload carries the **target account identity** (at least
  `workosUserId` + `workspaceId`).
- `apps/frontend/src/sw.ts` `notificationclick`: call PR-4b's resolve
  **identity form** (`?userId=`) with the payload's `workosUserId`, **flip
  AccountScope** (PR-4a) to that account if it is parked, then route to the
  deep link. No reload. Not signed in here → full login as that user (the
  resolver never substitutes a different readable account).
- Per-`(account, workspace)` push opt-out re-key (matches PR-4a localStorage
  re-keying).
- Single sign-out does a **surgical push-row cleanup** for that account only
  (the existing `deleteByEndpointForUser` join via `workos_user_id` already
  scopes correctly — confirmed no migration needed).
- On add-account, subscribe the existing browser push endpoint for the newly
  added account so its notifications arrive without re-granting permission.

**Reuse:** Existing `push_subscriptions` schema (`UNIQUE (workspace_id,
user_id, endpoint)` already account-scoped — **no migration**); existing
endpoint-cleanup query; PR-4b resolve identity form; PR-4a AccountScope flip.

**Verification:**

- Notification for parked account B while A is active → click → app flips to B
  and lands on the correct deep link, no reload, no A-data flash.
- Opt-out is per `(account, workspace)`; toggling one does not affect another.
- Sign out of A only → A's push rows gone, B's intact, B still receives push.
- Add account on a browser with push already granted → new account receives
  push without a second permission prompt.

---

## Dependency Graph

```text
PR-0  (corrected doc)            — independent, lands first
PR-2  (backoffice cookie rename) — independent, any time

PR-1  (backend-common primitives)
  └── PR-3  (/api/accounts contract + intent=add)
        └── PR-4a (AccountScope foundation)
              └── PR-4b (cross-account entry resolver)
                    ├── PR-5  (switcher UX)
                    └── PR-6  (cross-account push)  ‖ PR-5
```

## Recommended merge order

`PR-0 → PR-1 → PR-3 → PR-4a → PR-4b → { PR-5 ‖ PR-6 }`, with `PR-2` slotted
in any time.

Rationale:

- **PR-0 first** so every later reviewer reads an accurate spec (no probe gate,
  real endpoint paths, slot-visibility resolved).
- **PR-1 next** — pure additive primitives, unblocks PR-3, middleware
  untouched so it is a risk-free merge.
- **PR-3** establishes the server contract before any client depends on it;
  folds the real-revoke / parallelism / rate-limit / graceful-cap fixes so the
  contract is correct from day one.
- **PR-4a** before any switcher UI so isolation is proven (the headline
  zero-cross-account-read test) before users can trigger switches.
- **PR-4b** next — the resolve→flip primitive that turns a parked-account deep
  link into an in-place switch; PR-6's notification-click is a trivial caller
  of its identity form and PR-5 inherits the modified bounce path.
- **PR-5 and PR-6 in parallel** on top of PR-4b — both consume the AccountScope
  flip; neither depends on the other.
- **PR-2 anytime** — it only renames the backoffice cookie and shares nothing
  with the product account model.

## What changed vs. PR #487 (deliberately not copied verbatim)

- **No hard reload, no cache drop on switch.** PR #487 reloaded the page and
  dropped the cache on every switch; this split introduces AccountScope +
  per-account registries so parked accounts stay warm and switching is
  in-place. This removes the stale-singleton race window PR #487 had.
- **No probe gate, no probe script, no WorkOS verification ceremony, no
  logout-first fallback.** SDK 7.82.0 types `prompt`/`loginHint`/`screenHint`;
  it works. The dead `workos-probe.ts` and the verification section are dropped
  entirely.
- **Known bugs folded into the owning slice**, not deferred: real WorkOS
  revoke on `remove`, parallelized per-alt `authenticateSession`, `authLimit`
  on `list`, graceful `MAX_ACCOUNTS_REACHED` redirect, namespaced
  localStorage, scoped QueryClient, removed dead eager-auth path.
- **Slot index never crosses the wire** — the client only ever sees a
  server-issued opaque stable account id, resolving PR #487's
  slot-visibility contradiction.
- **Cross-account push is treated as net-new** (PR-6), not "already works" —
  PR #487's service worker has no account identity.
