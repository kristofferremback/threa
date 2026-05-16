# PR-4a — AccountScope foundation (frontend, no UI)

## Context

Fourth implementation slice of the multi-account login split
(`docs/plans/multi-account-login-split.md`, lines 264-308). PR-1 (#537,
backend-common cookie/auth-URL primitives) and PR-3 (#538, `/api/accounts`
contract + OAuth `intent=add` park/coalesce) are **merged to `origin/main`**
(HEAD `44362916`). PR-4a is now unblocked.

**Why this slice exists / intended outcome:** give the frontend a reactive,
fully account-isolated **AccountScope** so the active account can switch
*in place with no page reload* and *zero cross-account data bleed* at the
IndexedDB, TanStack-Query, and store layers — including across browser tabs.
No switcher UI (that is PR-5); this slice only proves isolation + in-place
switchability via a headline test.

**Two corrections to the spec's stated assumptions (verified against
`origin/main`):** the spec was written as if the original monolithic PR #487
had landed. It did not — only the split-plan doc (#535) merged. Therefore:

- `resolveDbName()`, `ensureDbMatchesUser`, and any account-switch
  `window.location.reload()` **do not exist** — nothing to delete. PR-4a is a
  *greenfield* foundation, not a refactor of PR #487.
- `window.__eagerAuthPromise` is **live and fully wired** (`index.html:106`
  sets it; `auth/context.tsx:41-51` consumes it) — it is *not* dead code.

**User decisions (this session):**

1. **Keep `__eagerAuthPromise` untouched.** A sibling PR is open that reworks
   the offline-first model and may touch this exact area; avoid churn there to
   prevent merge conflicts. AccountScope derives the active id from
   `useAuth().user?.id` (which already consumes the eager promise) — no change
   to `index.html` or `auth/context.tsx`'s auth fetch.
2. **Scope-proxy + keyed remount** (not the full 34-file importer rewrite).
   Minimal blast radius, deliberately chosen to stay clear of the in-flight
   offline-first PR.

## Approach (scope-proxy + keyed remount, minimal churn)

### 1. `apps/frontend/src/db/database.ts` — name-parameterized class + scope-bound proxy

- `class ThreaDatabase` constructor takes a name:
  `constructor(name: string) { super(name) … }`. Every `this.version(...)`
  block (28 of them, `:497-745`) stays **byte-identical** (reuse existing
  schema — spec requirement).
- Replace `export const db = new ThreaDatabase()` (`:751`) with a **proxy**
  that forwards every property access to the AccountScope-active
  `ThreaDatabase` instance. The ~30 modules doing `import { db } from "@/db"`
  stay **completely untouched** (this is the whole point of the proxy: zero
  churn in the offline-first model files the sibling PR touches).
- The proxy reads through a module-level `activeDb` pointer that is **owned
  and mutated solely by AccountScope**, set synchronously in the provider
  body *before* the keyed subtree (and its `useLiveQuery`/sync engine) mounts
  or remounts. Pre-auth (no account yet) the pointer defaults to a
  `ThreaDatabase("threa")` handle so the pre-mount `hydrateCollapseCache()`
  in `main.tsx` keeps working with **no change to `main.tsx` or
  `collapse-cache.ts`** (another offline-first-area file left alone). Document
  the INV-9 reasoning inline: this is not hidden state — it is the deliberate,
  single-owner scope bridge that avoids a 30-file rewrite which would conflict
  with the in-flight offline-first PR.
- `clearAllCachedData()` / `clearPendingMessages()` (`:754-792`) keep working
  against the proxy (i.e. the active account's db) — **no signature change**.
  Their `finally` block already calls `resetWorkspaceStoreCache` /
  `resetStreamStoreCache` / `resetDraftStoreCache` — reuse as-is (INV-35).

### 2. `apps/frontend/src/auth/account-scope.tsx` (NEW) — context + provider

API: `{ activeWorkosUserId, getDb(), getQueryClient(), getStores(),
switchAccount(targetUserId), scopedKey(suffix) }`.

- Reads `useAuth().user` (no eager-auth change). While `user` is
  null/loading, renders children with a stable `"__no_account__"` key (login
  /loading routes need no scope). Once `user.id` is known, provides the scope.
- Per-account registries held as **provider instance state (`useRef` Maps)**,
  not module-level (INV-9): `dbRegistry`, `qcRegistry`. `getDb(id)` lazily
  `new ThreaDatabase("threa_" + id)`; `getQueryClient(id)` lazily
  `makeQueryClient()` (exported from `query-client.tsx`).
- Synchronously sets the `db` proxy's `activeDb` pointer to
  `getDb(activeWorkosUserId)` in the provider body (idempotent registry
  lookup) so it is correct *before* the keyed children render.
- Renders a `<ScopedRoot key={activeWorkosUserId}>` remount boundary around
  the per-account subtree. A switch ⇒ React unmounts the old subtree and
  mounts a fresh one ⇒ atomic swap of db handle, QueryClient, socket,
  SyncEngine, and all `useState`/`useRef`/`useLiveQuery` — the strongest
  isolation guarantee (matches the acceptance bar; mirrors the spec's own
  rejection of in-place key-prefixing).
- `switchAccount(target)`: `POST ${API_BASE}/api/accounts/switch`
  `{ targetUserId }` (PR-3 contract) → on `{ activeUserId }`: call
  `resetWorkspaceStoreCache()` / `resetStreamStoreCache()` /
  `resetDraftStoreCache()` (+ add a `resetShareHandoffStoreCache()` if
  `share-handoff-store.ts` lacks one — small, colocated) to flush the
  **module-level** store caches that survive a React remount, then
  `setActiveWorkosUserId(activeUserId)` (triggers the keyed remount), then
  `new BroadcastChannel("threa-auth").postMessage({ type:"switched",
  activeWorkosUserId })`.
- Cross-tab receiver (`useEffect`, `BroadcastChannel("threa-auth")`): on a
  `switched` message for a different id → `qcRegistry.get(currentId)
  ?.cancelQueries()` (abort in-flight on the now-stale client), reset the
  module store caches, then `setActiveWorkosUserId(...)` → same keyed-remount
  path. Storage isolation (distinct DB name + distinct QueryClient instance)
  means late-resolving queries land in the orphaned client, never B's cache —
  correctness is independent of flip timing (spec requirement).

### 3. `apps/frontend/src/contexts/query-client.tsx` — per-account client

- Keep + **export** `makeQueryClient()` and `handleGlobalError` (reuse).
- Delete `queryClientSingleton` / `getQueryClient()` and the singleton
  `QueryClientProvider`. Add `AccountQueryClientProvider` that takes the
  client from `useAccountScope().getQueryClient()`. Verified: `getQueryClient`
  has **no production consumers** beyond the `contexts/index.ts:1` re-export
  and the provider itself — low churn. Update `contexts/index.ts:1`.
- 401 redirect + its `sessionStorage` loop-guard keys stay global and
  unchanged: only the active account's client is mounted at a time (keyed
  remount), so the existing handler is correct as-is. Multi-client concurrent
  401 handling is explicitly deferred to PR-5.

### 4. `apps/frontend/src/App.tsx` — provider tree

Wrap as: `AuthProvider > AccountScopeProvider > ScopedRoot
key={activeWorkosUserId} > AccountQueryClientProvider > ServicesProvider >
PendingMessagesProvider > TooltipProvider > RouterProvider`. AuthProvider
stays **outside** scope (it owns the cookie-session identity that selects the
account). QC/Services/PendingMessages/Router move **inside** the keyed
boundary so they are per-account.

### 5. Socket reconnect + bootstrap (INV-53) — structural, no socket-layer churn

`SocketProvider` + `SyncEngine` live inside `workspace-layout.tsx`, inside the
keyed subtree. A switch remounts that subtree ⇒ old socket `.close()`, fresh
cookie-authed socket connects (PR-3 already promoted the new active cookie),
fresh `SyncEngine` runs its first `onConnect` → `runBootstrap` → no event gap.
INV-53 (subscribe paired with bootstrap, invalidated on resubscribe) is
satisfied *structurally* by the remount — no `reconnectCount` plumbing change.

### 6. Router seam for PR-4b (no behavior change in PR-4a)

PR-4a does **not** implement cross-account deep-link resolution, but must not
preclude it. Two seam guarantees:

- `switchAccount(targetUserId)` is exposed on the AccountScope context so a
  future router guard / route loader can `await` an account flip *before* the
  workspace subtree mounts (the keyed-remount path already supports a
  programmatic, non-UI trigger — it is identical to the cross-tab receiver
  path).
- The current terminal-error dead-end at `workspace-layout.tsx:240-246` (on a
  workspace `403/404` it `navigate("/workspaces", { replace:true })`) is the
  exact extension point PR-4b replaces. PR-4a leaves it **unchanged** (still
  bounces) but documents it inline as the PR-4b seam so the behavior is a
  known, intentional gap, not a silent regression.

### 7. localStorage re-keying (separate from the offline-first db model)

| Concern | File | New key |
|---|---|---|
| Sidebar state | `contexts/sidebar-context.tsx:48,171,192` | `threa-sidebar-state:${workosUserId}:${workspaceId}` |
| Push opt-out | `hooks/use-push-notifications.ts` `pushOptOutKey` | `threa:push-opted-out:${workosUserId}:${workspaceId}` |
| Appearance | `contexts/preferences-context.tsx:16,31` (+ `index.html:82` pre-bundle reader) | authoritative `threa-appearance:${workosUserId}` **plus** retain global `threa-appearance` as a one-frame pre-auth fallback |

Sidebar/push hooks are inside the scoped subtree → take `workosUserId` from
`useAccountScope()`. Appearance: the render-blocking inline script at
`index.html:82` runs before any account is known, so it cannot be
account-keyed; `preferences-context` writes both the scoped (authoritative)
key and the global fallback, reads the scoped key — the only cross-account
sharing is a single pre-auth frame of the prior theme, which `preferences-
context` immediately corrects on mount.

## Critical files

| File | Change |
|---|---|
| `apps/frontend/src/db/database.ts` (+ `db/index.ts`) | `ThreaDatabase(name)`; replace `db` singleton with scope-bound proxy + default `"threa"` pre-auth handle; export `ThreaDatabase` |
| `apps/frontend/src/auth/account-scope.tsx` | **NEW** — context, per-account `getDb/getQueryClient/getStores`, `switchAccount`, keyed `ScopedRoot`, `threa-auth` BroadcastChannel |
| `apps/frontend/src/contexts/query-client.tsx` (+ `contexts/index.ts`) | export `makeQueryClient`; delete singleton; add `AccountQueryClientProvider` |
| `apps/frontend/src/App.tsx` | insert `AccountScopeProvider` + keyed `ScopedRoot`; move QC/Services/PendingMessages/Router inside |
| `apps/frontend/src/pages/workspace-layout.tsx` | pass `workosUserId` into sidebar/push keys; relies on remount for socket+bootstrap |
| `apps/frontend/src/contexts/sidebar-context.tsx`, `contexts/preferences-context.tsx`, `hooks/use-push-notifications.ts` | localStorage re-keying |
| `apps/frontend/src/stores/share-handoff-store.ts` | add `resetShareHandoffStoreCache()` if absent (reuse pattern from `workspace-store.ts:98`) |
| `apps/frontend/src/test/setup.ts` | add in-memory `BroadcastChannel` shim (jsdom lacks it) |
| `apps/frontend/src/auth/account-scope.test.tsx` | **NEW** — headline isolation + cross-tab test |
| `apps/frontend/src/db/database.test.ts` | update for `ThreaDatabase(name)` (currently constructs the singleton) |

**Untouched on purpose (sibling offline-first PR safety):** `index.html`
eager-auth block, `auth/context.tsx` auth fetch, `main.tsx`,
`lib/markdown/collapse-cache.ts`, and the ~30 `import { db } from "@/db"`
consumer modules — all keep working unchanged via the proxy.

## Verification

**First step:** `git fetch origin && git checkout -b
claude/review-multi-account-auth-4eC4g origin/main` (branch fresh off updated
`origin/main`, post-PR-3 #538 — current HEAD `44362916`). Develop and push
only to `claude/review-multi-account-auth-4eC4g`.

**Headline test** (`apps/frontend/src/auth/account-scope.test.tsx`, real
components mounted — INV-39; `vi.spyOn`/`spyOnExport`, not `vi.mock` —
INV-48; `fake-indexeddb/auto` already global via `test/setup.ts:1`):

1. Stub `fetch`: `/api/auth/me` → account A `{id:"workos_A",…}`;
   `POST /api/accounts/switch {targetUserId:"workos_B"}` →
   `{activeUserId:"workos_B"}` and flip `/api/auth/me` to B (mirrors the
   `auth/context.test.tsx` fetch-stub pattern).
2. Mount real `App`; seed A's layers: `getDb()` row, `getQueryClient()
   .setQueryData(...)`, `getStores().seedWorkspaceCache(...)`.
3. `switchAccount("workos_B")` via a probe; assert `window.location.reload`
   and `window.location.href` were **never** assigned (no reload).
4. Assert zero cross-account reads, three layers: B's `getDb()` →
   `workspaces.count() === 0` while `threa_workos_A` still holds A's row
   (isolation, not deletion; assert two DB names via
   `indexedDB.databases()`); B's QueryClient `getQueryData` for A's key →
   `undefined`; B's `getStores().hasSeededWorkspaceCache(A) === false`.
5. Cross-tab: with the `BroadcastChannel` shim, mount two
   `AccountScopeProvider` trees sharing the in-memory channel + the
   process-shared fake-indexeddb backing; switch in tree 1 → assert tree 2
   flipped to B, serves zero A data at all three layers, and tree 1's old
   client had `cancelQueries()` called.

**Commands:** `bun run --cwd apps/frontend test` (incl. new + updated tests
all green) and `bun run --cwd apps/frontend typecheck` (the `ThreaDatabase`
name param + provider tree must be type-clean).

## Risks / accepted trade-offs

- **R1 — Scope-proxy `activeDb` pointer is module-level.** Mitigated:
  single-owner (AccountScope), set synchronously before the keyed subtree
  mounts; documented inline. Deliberate trade vs. a 30-file rewrite that
  would conflict with the in-flight offline-first PR.
- **R2 — Switch = full keyed-subtree remount**, not a same-socket
  re-handshake. Strongest isolation; a brief UI flash on switch is acceptable
  for infra-only PR-4a (PR-5 owns switch UX).
- **R3 — `threa-appearance` one pre-auth frame** may show the prior account's
  theme before `preferences-context` corrects it (inline script can't be
  account-keyed). Authoritative store is fully per-account.
- **R4 — Cross-account collapse-cache warm-up** lands in the default `"threa"`
  db pre-auth; reads switch to `threa_<id>` after activation. Message IDs are
  distinct ULIDs so no meaningful bleed; cache self-heals (already tolerated).
- **R5 — BroadcastChannel jsdom shim** is a required `test/setup.ts` addition;
  fake-indexeddb is process-shared so the two-tab test shares one IDB backing
  — realistic for the cross-tab assertion.
- **R6 — Logout cache teardown** clears only the active account's db (via the
  existing `clearAllCachedData` against the proxy). Deleting *all* per-account
  DBs on logout is deferred to PR-5 (logout-all).

## Follow-up: PR-4b — cross-account entry resolver (separate slice)

A new slice between PR-4a and `{PR-5 ‖ PR-6}`, owning the **cold-entry**
resolve→flip→route primitive (a shared link / bookmark to a workspace owned by
a *parked* account must work, not bounce to `/workspaces`). This is the same
primitive PR-6's notification-click needs, so PR-6 becomes a trivial caller.

- **Backend (control-plane):** `GET /api/accounts/resolve?workspaceId=…` →
  `{ ownerUserId }` or `404`. Reuses `AccountsService.resolveAlts` (active +
  alt sealed sessions, exactly like `/api/accounts` via
  `readAltSessionCookies`) to enumerate this browser's accounts, then checks
  workspace membership per account via the existing
  `workspace.confirmMembership` path (`/internal/workspaces/:id/members/:uid`
  is already wired). Zod-validated query (INV-55), `HttpError` semantics
  (INV-32), `auth`+`authLimit` like the other `/api/accounts/*` routes.
- **Frontend:** a route guard replacing the `workspace-layout.tsx:240-246`
  bounce — on a workspace `403/404`, call the resolver; if a parked account
  owns it, `switchAccount(ownerUserId)` (PR-4a) and keep the original deep
  link (no reload); only fall back to `/workspaces` when no account owns it.
- **Reuse:** PR-4a `switchAccount` + keyed remount; PR-3 `AccountsService`
  /`resolveAlts`; existing `confirmMembership`. **Consumed by** PR-5
  (switcher) and PR-6 (notification-click resolves via the same endpoint).
- **Verification:** while account A is active, open a link to a workspace
  owned by parked account B → app flips to B and lands on the deep link, no
  reload, no A-data flash; a link to a workspace no account owns still
  bounces to `/workspaces`.

## Out of scope (later slices)

Cold-deep-link / notification-click resolver + router guard (**PR-4b**, above);
switcher UI, `intent=add` "Add account" entry point, account list rendering,
the `MAX_ACCOUNTS` cap *relaxation* (PR-5); cross-account push +
notification-click switch (PR-6); backoffice cookie rename (PR-2).
