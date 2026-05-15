## Problem

Today, Threa supports exactly one logged-in identity per browser. The session is a single WorkOS sealed-session cookie (`SESSION_COOKIE_NAME`, default `wos_session`) set on `.threa.io` (`packages/backend-common/src/cookies.ts:39-49`). Auth middleware reads exactly one cookie name (`packages/backend-common/src/auth/middleware.ts:29`). The "switcher" is a dedicated full-page route (`apps/frontend/src/pages/workspace-select.tsx`) that auto-redirects when there's only one workspace and silently assumes one WorkOS user.

This forecloses two real-world cases:

1. **Same WorkOS user, multiple workspaces.** Friend group + work, both reachable from the same email. Already supported in the data model — the control plane keys workspaces by `workosUserId` — but the UX is a clunky full-page detour.
2. **Different WorkOS users, multiple workspaces.** Personal email + work email. Today, signing in as the second one logs out of the first. There is no concurrent-identity primitive at all.

The PWA constraint shapes the solution space. The app is installed at `app.threa.io/`, scope is `/`, with one service worker and one PushManager subscription. Per-workspace browser profiles, per-workspace cookie jars, and per-workspace PWA installs are all off the table — multiple identities have to coexist inside one origin.

The two natural ways to do this are:

1. **Bearer tokens in client storage** (Linear, Notion, most multi-account web apps). N access tokens in IndexedDB or localStorage; each request sends one in `Authorization`. Clean per-request semantics, but the tokens are JS-readable — XSS exfiltrates every active session. Refresh tokens have to live somewhere similar or behind a custom refresh endpoint.
2. **N HttpOnly cookies in one jar with a server-side selection mechanism** (this plan). Sealed sessions stay HttpOnly. Cost is more cookie-jar bookkeeping; benefit is XSS can't read sealed sessions at all.

We pick (2) because we already get HttpOnly sealed sessions for free from WorkOS, and we'd rather not give that up.

## Goals

1. **Multiple concurrent identities.** A user can be signed into up to 8 WorkOS identities in the same browser. Switching between them is a first-class affordance, not a re-login.
2. **No accidental leakage.** Server-side: every request authenticates as exactly one WorkOS user, and that user's workspace membership is independently checked. Client-side: cached data, IDB rows, query state, and notifications cannot bleed between identities.
3. **Stay logged in.** Sessions for accounts the user rarely opens still refresh in the background, so an unused account doesn't silently expire.
4. **Cross-account notification reach.** Push notifications fire for any account/workspace the user is signed into, not just the active one. Per-account and per-workspace mute toggles work.
5. **Persistent in-app switcher.** A control listing every signed-in account and its workspaces, with click-to-switch. "Add another account" kicks off OAuth into a parked slot without disturbing the active session.
6. **Full reload on cross-account switch, in-app navigation on same-account workspace switch.** Switching identity is heavyweight (clear in-memory caches, swap Dexie DB, reconnect socket); reload makes the boundary obvious and impossible to corrupt. Switching workspaces under one identity is cheap (existing path).

## Non-goals

- **Multi-account in the backoffice.** The backoffice (`admin.threa.io`) is platform-admin-only and stays single-session. Its cookie name moves to `wos_session_backoffice` so it can never collide with workspace-app cookies on `.threa.io`.
- **Concurrent active sessions in different tabs.** Cookies are per-origin, not per-tab. The "active" identity is a property of the cookie jar, not the tab. Other tabs reload to align after a switch.
- **Subdomain-per-workspace addressing.** Out of scope. We solve the multi-identity problem inside one origin via cookie-jar slots, not by changing how workspaces are addressed.
- **Email-merging.** If two slots happen to resolve to the same WorkOS user, we coalesce to one slot (with a hidden override flag for QA). We do not attempt to merge accounts that are different WorkOS users with the same email.
- **Federation between accounts.** Each account is independent. There is no "follow conversations across accounts" feature; cross-account presence is limited to unread badges and notification surfaces.

## Terminology

- **Active session** — the one sealed-session cookie that currently authenticates every API request. Stored in `wos_session`.
- **Parked alt** — a sealed session sitting in the cookie jar but not authenticating any normal request. Stored in `wos_session_alt_0..6`. There are at most 7 alts, so the total identity cap is 8 (1 active + 7 alts).
- **Slot** — an internal cookie-jar implementation detail referring to which alt index a session lives in. **Slots never appear in client-visible APIs.** The frontend identifies accounts by `workosUserId`, never by slot index.
- **Switch** — the act of swapping which sealed session is the active one. The current active becomes a parked alt; the chosen alt becomes active. Triggers a full reload in the originating tab and a `BroadcastChannel` event so other tabs realign.
- **Re-authenticate** — UI state shown when a parked alt's WorkOS session has expired beyond refresh. The slot stays in the switcher with a badge; clicking it kicks off OAuth into the same slot.
- **Coalesce** — if "Add another account" resolves to a `workosUserId` that already occupies the active or any parked alt, we redirect into the existing slot and refresh its sealed session in place rather than allocating a new one.

## Architecture

### Cookie model — active + parked alts

The single biggest design decision: every API request, every WebSocket handshake, every internal route reads **exactly one** auth cookie (`wos_session`). Slots are a property of the cookie jar's _storage_, not of the _request_.

| Cookie                 | Purpose                                             | HttpOnly             | Notes                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wos_session`          | Active sealed session — authenticates every request | yes                  | Identical to today; auth middleware unchanged                                                                                                                               |
| `wos_session_alt_0..6` | Parked sealed sessions — storage only               | yes                  | Never read by auth middleware. Read only by `/api/accounts`, `/api/accounts/switch`, `/api/accounts/remove`, `/api/accounts/refresh-all`                                    |
| `threa_active_user`    | Cold-start hint: the active `workosUserId`          | **no** (JS-readable) | Used by the eager pre-React fetch to know who's active without parsing HttpOnly cookies. Not security-bearing — server-side auth is still gated on `wos_session` validation |

Why this shape works:

- **Single source of truth per request.** A network trace of any request looks identical to single-account today: one cookie, one identity, one membership check.
- **Existing INVs preserved.** No new "the slot header is a hint not authority" invariant needed. The validated `workosUserId` from `wos_session` is the truth, exactly as today.
- **HttpOnly preserved everywhere.** Both active and alt sealed sessions stay HttpOnly. XSS gains nothing it didn't gain in single-account mode.
- **Backoffice unaffected.** Backoffice uses its own cookie name (`wos_session_backoffice`) and never touches alts.

### What slots are visible at — the four endpoints that know about alts

Slots are a server-internal detail. They appear in **only** these four control-plane endpoints; everywhere else in the codebase (auth middleware, regional backend, workspace router, frontend) is slot-agnostic.

#### `GET /api/accounts`

Replaces `GET /api/auth/me` for switcher rendering. One trip returns the full picture.

```jsonc
{
  "active": {
    "user": { "id": "user_…", "email": "alex@gmail.com", "name": "Alex" },
    "workspaces": [{ "id": "ws_…", "name": "Friends", … }],
    "pendingInvitations": [ … ]
  },
  "parked": [
    {
      "user": { "id": "user_…", "email": "alex@work.io", "name": "Alex (Work)" },
      "workspaces": [ … ],
      "pendingInvitations": [ … ],
      "status": "ok"
    },
    {
      "user": { "id": "user_…", "email": "old@example.com", "name": "Old" },
      "workspaces": [],
      "pendingInvitations": [],
      "status": "expired"
    }
  ]
}
```

Server walks `wos_session` plus every present `wos_session_alt_*`, validates each via WorkOS in parallel, fans out the existing `workspaceService.listForUser(workosUserId)` query for each, returns the combined view. Slots that fail validation come back with `status: "expired"` (drives the "Re-authenticate" UI); successful slots return `status: "ok"`. Slot indices are never exposed.

`GET /api/auth/me` stays for backwards compat — backoffice and other single-account consumers keep using it.

#### `POST /api/accounts/switch`

```jsonc
// request
{ "targetUserId": "user_xxx" }

// 200 OK on successful swap
{ "active": { "user": { … }, "workspaces": [ … ] } }

// 204 No Content if target is already active
// 410 Gone if target alt has expired
{ "status": "expired", "userId": "user_xxx" }
```

Server logic:

1. Read `wos_session` + every present `wos_session_alt_*` from the request.
2. If `targetUserId` matches the current active's `workosUserId` → 204 no-op.
3. Validate every parked alt in parallel (the active was already validated by auth middleware).
4. Find the alt whose validated `workosUserId === targetUserId`.
5. **Not found or fails validation** → 410 with `{ status: "expired", userId }`. Active cookie untouched. The alt cookie is **not** automatically cleared — the user might still want that account back via re-auth.
6. **Found** → atomic swap in one response: set `wos_session` to the matched alt's sealed value, set the alt slot that held the target to the previous active's sealed value. Both `Set-Cookie` headers in a single response → atomic from the browser's perspective.
7. Return 200 with `{ active }` so the client can pre-warm switcher state before the full reload.

**Concurrency.** No locks needed. Simultaneous switch calls produce deterministic last-writer-wins; cookies stay internally consistent because each response sets both atomically. Frontend debounces clicks and aborts in-flight switch requests on a new click.

**Idempotency.** Switching to the current active is a 204. Repeated switches to the same already-active target are 204s.

#### `POST /api/accounts/refresh-all`

The "stay logged in" mechanism. Walks every present `wos_session*` cookie, calls WorkOS `session.authenticate()` on each, and re-seals where a refresh occurred. Returns the same shape as `/api/accounts` so the frontend can update switcher state in one round trip.

Called:

- On cold app start, once.
- From the service worker every ~12 hours via a `setInterval` in the SW activation handler.
- After an OAuth add-account callback, to confirm the new alt is healthy.

Slots inside their refresh window are no-ops on the WorkOS side (sealed session is still valid, no new sealed value emitted).

#### `GET /api/auth/login` — extended with `intent` and post-callback slot allocation

The OAuth state param already carries `host|path` for cross-origin redirects (`apps/control-plane/src/features/auth/handlers.ts:74-86`). We extend it to a versioned structured form:

```text
state = "v2:" + base64(JSON({ host?, path, intent: "login" | "add", forceNewSlot?: boolean }))
```

Backwards compat: state values not starting with `v2:` go through the existing `host|path` parser unchanged.

`intent`:

- `"login"` (default) — current behavior. Callback writes `wos_session`. If a session already exists, it's replaced.
- `"add"` — "Add another account" flow. Callback writes the new sealed session into the **lowest free `wos_session_alt_*` slot**. Active session untouched. If `workosUserId` already matches the active or an existing alt, coalesce: refresh the existing slot in place. `forceNewSlot: true` (hidden, `?force_new_slot=1` in the login URL) overrides coalesce for QA — the same WorkOS user can occupy two slots.

If all 7 alt slots are occupied during an add flow, the callback returns a structured 400 (`MAX_ACCOUNTS_REACHED`) and the switcher prompts the user to sign out of one first.

### Per-slot client storage isolation

The audit (`apps/frontend/src/db/database.ts:467-491` and surrounding) found one `Threa` Dexie database keyed by `workspaceId` columns, with several **per-user** tables that don't include `userId`:

- `unreadState` (line 598): primary key is `workspaceId`
- `userPreferences` (line 599): primary key is `workspaceId`
- `savedMessages` (line 694): compound `[workspaceId+status+_savedAtMs]`, no `userId`
- `scheduledMessages` (line 732): compound `[workspaceId+status]`, no `userId`
- `pendingMessages`, `pendingOperations`: not workspace-scoped at all

The "two different WorkOS users both members of workspace X" case (real, not just QA: friend-of-a-friend, family workspace) would have alex's unread state overwriting bob's in IDB, alex's saved messages mixing with bob's, queued unsent drafts crossing identities.

**Decision: one Dexie database per slot, keyed by `workosUserId`.** Database name pattern: `threa_{workosUserId}`.

- Total isolation by construction — there is no row that two accounts can step on.
- Logout-of-account = `Dexie.delete()` the database. No partial-cleanup paths to get wrong.
- Workspace-global rows (streams, workspace users, dm peers) are duplicated across DBs for accounts that share workspaces. This is small data — streams and workspace user lists, not events or messages — and the storage cost is dominated by per-account event history anyway.
- Browsers handle dozens of simultaneous Dexie databases without issue.

The current single-DB code in `apps/frontend/src/db/database.ts` is wrapped in a per-account factory: `getDatabase(workosUserId)` returns the Dexie instance for that account, opening it lazily on first use, caching it for the session's lifetime.

### Per-slot in-memory and localStorage isolation

The audit also found:

- `apps/frontend/src/stores/workspace-store.ts:28-114` — global singleton with `Map<workspaceId, ...>` caches. Re-key wholesale on slot swap (full reload handles this trivially; for in-app same-account workspace switch, no change needed since workspaceId still disambiguates).
- `apps/frontend/src/contexts/sidebar-context.tsx:48` — global localStorage key `threa-sidebar-state`. Re-key to `threa-sidebar-state:${workosUserId}:${workspaceId}`.
- `apps/frontend/src/contexts/preferences-context.tsx:16` — global `threa-appearance`. Re-key to `threa-appearance:${workosUserId}` (theme is per-user, not per-workspace).
- `apps/frontend/src/hooks/use-push-notifications.ts:107` — `threa:push-opted-out:${workspaceId}`. Extend to `threa:push-opted-out:${workosUserId}:${workspaceId}` (per-(account, workspace) toggle, see push lifecycle below).
- `apps/frontend/src/lib/last-stream.ts:4` — `threa-last-stream:${userId}:${workspaceId}` already correctly keyed. No change.

**TanStack Query.** Query keys already include `workspaceId`. We additionally **drop the QueryClient on slot swap** — `queryClient.clear()` plus a recreate on the active-account-changed event. This is free during full reload; needed for any in-app cross-account swap path we ever add.

### Push notification lifecycle

The OS-level PushManager subscription is one per browser/origin. The backend table `push_subscriptions` is already keyed `(workspace_id, user_id, endpoint)` (`apps/backend/src/db/migrations/20260227120000_push_subscriptions.sql:1-19`) — exactly the shape we need.

| Event                                              | Action                                                                                                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add account (OAuth callback writes new alt)        | For every workspace in the new account, `POST /api/workspaces/:id/push/subscribe` with the existing OS endpoint. New rows added under the new `workosUserId`; OS endpoint is reused.                                    |
| Toggle off for one (account, workspace)            | `DELETE /api/workspaces/:id/push/subscribe`. Set localStorage flag `threa:push-opted-out:${workosUserId}:${workspaceId}` so we don't auto-resubscribe.                                                                  |
| Toggle off for an entire account                   | Delete every push row whose `workos_user_id` matches that account, across all that account's workspaces. Set per-account opt-out flag. OS endpoint stays alive (other accounts still need it).                          |
| Sign out of one account                            | Use existing `deleteByEndpointForUser(workosUserId, endpoint)` (`apps/backend/src/features/push/repository.ts:144`). Removes rows for that WorkOS user across all their workspaces. Other accounts untouched.           |
| Sign out of all accounts                           | Per-account cleanup as above for each, then `pushManager.unsubscribe()` to drop the OS subscription. Only at this point do we kill the OS endpoint.                                                                     |
| Slot session expires unrecoverably (refresh fails) | Backend already drops rows on push delivery failures. Add: when `refresh-all` confirms a slot is dead, proactively delete that account's push rows so the OS doesn't wake the user with notifications they can't enter. |
| OS endpoint rotates (browser-initiated)            | Before deleting old rows, re-register the new endpoint against every (account, workspace) the user has via a single batch call from the SW (or app on cold start).                                                      |

Notification click → SW opens `/w/{workspaceId}/...`. With multi-account, the SW additionally writes the target account's `workosUserId` to `threa_active_user` and triggers a switch via `/api/accounts/switch` before the navigation, so the destination workspace loads under the right identity.

### Cross-tab / cross-instance synchronization

`BroadcastChannel("threa-accounts")` carries:

- `active-changed { workosUserId }` — other tabs reload to align UI with the new active cookie
- `account-added { workosUserId }` — switcher refreshes, no reload
- `account-removed { workosUserId }` — every tab deletes the corresponding Dexie DB; if that was the active account, redirect to the next available account or `/login`
- `account-status-changed { workosUserId, status }` — surfaces "Re-authenticate" badges when `refresh-all` discovers an expired slot

The service worker also participates: on OAuth callback completion, the SW posts the same events via `clients.matchAll()` so tabs that didn't initiate the OAuth still see the new account.

### Switcher UX

```text
┌─ Sidebar footer ────────────┐
│  ▾ Account: alex@gmail.com  │
│   • Friends           ✓     │
│   • Side hustle             │
│  ▾ Account: alex@work.io    │
│   • Acme HQ                 │
│   • Acme Mobile             │
│  ▾ Account: old@example.com │
│   ⚠ Re-authenticate         │
│  ─────────                  │
│  + Add another account      │
│  Sign out of this account   │
│  Sign out of all accounts   │
└─────────────────────────────┘
```

- Click a workspace under the **active account** → in-app navigate (existing `/w/{id}` path).
- Click a workspace under a **parked alt** → `POST /api/accounts/switch { targetUserId }`, then full reload to `/w/{newWorkspaceId}`.
- Click a **Re-authenticate** account → OAuth flow with `intent=add` and the existing alt slot identified by `workosUserId`; coalesce path refreshes the alt in place.
- "Add another account" → OAuth with `intent=add`, allocator picks the lowest free alt slot.
- Cmd/Ctrl-Opt-1..N to cycle through accounts and their workspaces in switcher order.
- Cross-account unread badges: a thin presence channel — one Socket.io connection per parked alt to a new `presence`-only namespace that emits unread/notification deltas, no message bodies. For 1–8 accounts this is fine; for higher counts we'd reconsider, but we cap at 8.

## WorkOS compatibility — what's confirmed and what must be verified before implementation

This entire design assumes WorkOS tolerates multiple concurrent sealed sessions per browser. The official WorkOS docs do not bless or forbid the pattern — they describe a single-session world. We've done a doc sweep to separate what's confirmed from what we must verify empirically before significant frontend work lands.

### Confirmed by WorkOS docs

- **Sealed sessions are opaque blobs we can store under any cookie name.** The cookie name is configurable (Threa's `SESSION_COOKIE_NAME` env, official `authkit-nextjs`'s `WORKOS_COOKIE_NAME`). WorkOS imposes no constraint on cookie names, count, or scope. Multiple `wos_session_alt_*` cookies are mechanically fine.
- **Each sealed session refreshes independently.** Refresh tokens are per-session; "Refresh tokens may be rotated after use, so be sure to replace the old refresh token with the newly returned one." No documented "one active session per WorkOS user" rule. N sealed sessions = N independent refresh streams.
- **`getAuthorizationUrl` accepts the OIDC `prompt` parameter** (listed in the official parameter table on the authorize endpoint).
- **`login_hint` is supported** to pre-fill the email field. Use it for "Re-authenticate this slot" — pass the known email so the user lands on a pre-filled login form.
- **Inactivity timeout is dashboard-configurable.** "Ends sessions if a refresh has not occurred in this length of time." `POST /api/accounts/refresh-all` must run at an interval shorter than this setting, or dormant slots silently die server-side.

### Not documented — must verify empirically

1. **AuthKit's hosted-page session behavior on a fresh OAuth flow when a WorkOS session cookie already exists at `*.workos.com`.** This is the central unknown. Three possibilities:
   - AuthKit recognizes the existing user and silently auto-completes OAuth as them → "Add another account" coalesces into the existing slot. We cannot actually add a different user without first logging out the WorkOS-side session.
   - AuthKit shows an account-picker or "switch user" prompt → ideal.
   - AuthKit honors `prompt=login` / `prompt=select_account` to force fresh credential entry → standard OIDC fix.
2. **Which `prompt` values WorkOS actually honors.** The parameter is accepted; the value behavior is undocumented. OIDC standard values (`login`, `select_account`, `none`) are the candidates.
3. **Whether `getLogoutUrl()` clears the WorkOS-side cookie at `*.workos.com` or only the app's sealed-session cookie.** If WorkOS-side, signing out of one slot affects subsequent interactive auth for other slots. Functionally identical to today's UX, not a blocker, but worth confirming.
4. **Whether `screen_hint`'s undocumented values (e.g. `select-account`) exist.** Docs explicitly list only `"sign-in"` and `"sign-up"` — but the API may accept more.

### Risk register

| Risk                                                                        | Probability           | Fallback if it bites                                                                                                                       |
| --------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| AuthKit auto-logs in as existing user on add-account, no prompt value helps | Medium                | Insert an explicit `getLogoutUrl()` round trip before each add-OAuth. UX cost: "you'll need to sign in again to this browser." Acceptable. |
| `prompt=login` not honored                                                  | Medium                | Same fallback.                                                                                                                             |
| `getLogoutUrl()` for one slot clears WorkOS-side cookie globally            | Low                   | Functionally identical to today; other slots need fresh credentials on next interactive auth. Document, ship as-is.                        |
| Inactivity timeout shorter than our refresh interval                        | Low (we control both) | Set refresh-all interval well below the configured inactivity timeout; expose both via env config.                                         |
| WorkOS rate-limits N parallel refreshes during `refresh-all`                | Low                   | Sequence refreshes server-side; only refresh slots within N hours of expiry.                                                               |

None of these risks invalidate the cookie-jar model itself. The worst-case outcome is "Add another account" requires a brief logout-relogin dance — heavier UX but the architecture is unchanged.

### Verification gate

**Before any frontend work on the switcher or per-slot Dexie wrapper, run two empirical probes against the staging WorkOS environment** and document the results inline in this plan (as a follow-up commit):

1. **Add-account OAuth probe.** Sign in as user A. Trigger a fresh `getAuthorizationUrl()` call with each combination:
   - no `prompt` parameter
   - `prompt=login`
   - `prompt=select_account`
   - `prompt=none`
   - `login_hint=<unknown_email>` (force email picker)
     Record what AuthKit's hosted page renders in each case. Outcome determines whether we can rely on `prompt` or need the pre-clear-logout fallback.
2. **Independent refresh probe.** Sign in as A and B in the same browser (manually constructing the alt cookie if no UI exists yet). Idle B for longer than the configured inactivity timeout. Verify:
   - A's session continues to refresh normally.
   - B's session fails validation with the expected `authentication_failed` reason.
   - Refreshing A does not affect B and vice versa.
   - The error from B's failed refresh is distinguishable from "no session" — so the frontend can render "Re-authenticate" rather than treating it as a fresh logout.

These probes should be cheap (an afternoon) and the answers materially shape the implementation. If probe (1) shows AuthKit refuses to authenticate as a different user even with `prompt=login`, we ship the logout-first fallback from day one. If probe (2) shows refresh tokens interact across slots, the whole design needs rethinking — but the docs give no reason to expect this.

### Things we are choosing not to rely on

- **`prompt=select_account`** even if it works. AuthKit isn't an identity hub like Google's account chooser — passing this value may or may not render meaningful UI. We treat `prompt=login` (force re-auth) as the primary lever and `select_account` as a nice-to-have if it works.
- **Implicit logout via inactivity.** Even though WorkOS will eventually expire idle sessions, we proactively call `refresh-all` so dormant slots stay alive within the configured window. Relying on WorkOS's silent expiry would conflict with the "stay logged in" goal.
- **Any undocumented WorkOS behavior** as load-bearing. If a probe outcome depends on something the docs don't say, we document it in this plan as "observed behavior, may change" and add a follow-up smoke test in CI.

## Migration

1. **No data migration.** Existing single-account users keep their `wos_session` cookie as-is. It becomes the "active" session automatically. Their existing IDB database (`Threa` or whatever the current name is) is migrated lazily: on first multi-account-aware load, if the legacy DB exists, rename/copy to `threa_{workosUserId}` and delete the legacy DB. (The exact rename mechanic — Dexie doesn't support rename — is "open both, copy each table, delete legacy." A separate sub-task.)
2. **Backoffice cookie rename.** Backoffice deploys gain `SESSION_COOKIE_NAME=wos_session_backoffice`. Existing backoffice sessions are invalidated on rollout (one re-login). The `SESSION_COOKIE_NAME` env var already exists; only deployment config changes.
3. **Workspace-router and regional backend.** No changes. Both already pass cookies through transparently and read `wos_session` for auth. Alts are present in the `Cookie:` header but ignored by the auth middleware — they're only consumed by the four control-plane endpoints listed above.
4. **Frontend rollout order.** Server endpoints first (`/api/accounts`, `/api/accounts/switch`, `/api/accounts/remove`, `/api/accounts/refresh-all`, OAuth `intent=add`). Then per-slot Dexie wrapper. Then switcher UI. Then push lifecycle changes. Then cross-tab BroadcastChannel. Each can ship behind a flag if needed.

## Test matrix

The leakage threat model justifies aggressive testing.

### Server-side

- **Auth middleware unchanged.** Existing tests should still pass without modification. Add: requests with multiple `wos_session_alt_*` cookies still authenticate as `wos_session`; alts are ignored.
- **`/api/accounts/switch` happy path.** Active is alex, alt is bob, switch to bob: response sets both cookies, subsequent requests authenticate as bob. Switch back: same in reverse.
- **`/api/accounts/switch` to non-existent target.** Returns 404 `TARGET_NOT_FOUND`. Active cookie not modified.
- **`/api/accounts/switch` to current active.** Returns 204. Cookies not modified.
- **`/api/accounts/switch` with expired alt.** Alt cookie present but WorkOS validation fails. Returns 404. Alt cookie not cleared (re-auth path keeps it).
- **`/api/accounts` enumerates correctly.** Returns active + parked, with correct `status` per slot.
- **OAuth `intent=add` allocation.** Picks lowest free alt. If 7 alts are taken, returns `MAX_ACCOUNTS_REACHED`. With `forceNewSlot=true`, allows duplicates of the same WorkOS user; without, coalesces.
- **Cross-workspace membership enforcement.** Requesting `/api/workspaces/X/...` with the active session whose `workosUserId` is not a member of X returns 403 — same as today; we add tests where alts have different memberships to make sure the active session's check is what governs.

### Client-side

- **Per-slot Dexie isolation.** Two accounts both members of workspace X: write to `unreadState` as alex, switch to bob, read `unreadState` — must reflect bob's server state, not alex's stale cache.
- **localStorage namespace.** `threa-sidebar-state` keys are correctly per-(`workosUserId`, `workspaceId`).
- **QueryClient cleared on switch.** Pre-switch, alex's cached query data is present; post-switch, `queryClient.getQueryData` for those keys returns undefined.
- **BroadcastChannel cross-tab swap.** Tab A switches to bob; Tab B receives `active-changed`, reloads, authenticates as bob.
- **Push opt-out scoping.** Toggling off in (alex, ws_X) doesn't affect (alex, ws_Y) or (bob, ws_X).
- **Notification click swaps active.** Push for (bob, ws_X) tapped while alex is active → SW switches to bob, opens `/w/X/...` under bob.

### E2E

- Sign in as A. Sign in as B (add account). Switcher shows both. Switch to B. Switch back. No data from B visible while A is active.
- Sign in as A. Add A again with `?force_new_slot=1`. Two slots, same WorkOS user. Each has its own Dexie DB. (QA-only scenario; feature-flagged.)
- Sign out of A while B is also signed in. Active becomes B. A's Dexie DB deleted. A's push subscriptions removed.
- Manually expire A's WorkOS session (test-only endpoint). Re-load — A appears in switcher with "Re-authenticate" badge. Click → OAuth refreshes A in place, badge clears.

## Open questions / things to watch during implementation

- **Sealed-session size empirical check.** Eight sealed sessions in one `Cookie:` header could be 20–30 KB. Cloudflare Workers have header limits. Before committing to 8 slots, measure a real WorkOS sealed session and set the cap accordingly. If we have to drop to 5–6, the design is unchanged; only the constant moves.
- **Refresh-all rate limits.** WorkOS may have refresh rate limits we haven't hit at single-account scale. `refresh-all` should batch and back off; only refresh slots within N hours of expiry.
- **Lazy IDB migration mechanic.** Renaming a Dexie DB requires a copy. Need to confirm the legacy DB's schema is fully readable from a new Dexie instance with the same `version()` declarations, then migrate per-table.
- **Presence-channel cost.** One Socket.io connection per parked alt could be substantial at the regional backend's connection limits. If this turns out to bite, fall back to periodic HTTP polling for parked alts and reserve sockets for the active account.
- **BroadcastChannel reliability.** Older Safari versions had spotty support; verify on the iOS PWA target.
- **PWA manifest scope.** Currently `/`. Multi-account doesn't change scope, but verify install behavior — adding an account shouldn't trigger any "install another PWA" prompts.

## Out of scope

- A "merged" inbox showing messages from all accounts in one view.
- Cross-account memos / GAM stitching.
- Workspace-to-workspace handoff inside one account ("move this conversation to another workspace").
- Subdomain-per-workspace addressing.
- Mobile-native account switcher (the PWA-on-mobile case is the v1 mobile target).
