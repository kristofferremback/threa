# Offline-First Boot Performance

## Context

The mobile/PWA app is fast when fully online and predictable when fully
offline, but **slow and janky on the typical "out and about" flaky/slow
network**. Root cause: the app's _data_ layer is already offline-first
(IndexedDB priming + a gate that bypasses the network — see
`coordinated-loading-context.tsx`), but **every gate upstream of that layer is
an unbounded network wait with no cache and no timeout**. On a cold PWA launch
they run roughly serially, so a returning user stares at blank/spinner screens
for 15–30s when each round trip is 2–8s.

Goal: make the boot truly offline-first — render instantly from local state,
treat the network as background revalidation, and bound every request so a slow
network can never stall first paint. Decisions confirmed with the user:
**full offline-first boot** in one pass, and — for the service-worker app
shell — **serve the workbox-precached `/index.html` via the standard
`NavigationRoute(createHandlerBoundToURL('/index.html'))` recipe**: zero
network on the boot critical path, fully offline, and (critically) the
post-deploy "broken shell" failure is made **structurally impossible** rather
than merely recovered-from. A workbox precache manifest is build-atomic —
`index.html` and the hashed JS/CSS it references always come from the same
build — so you can never serve build-A's HTML against build-B's missing
assets. Post-deploy freshness comes for free from the SW update lifecycle
(`sw.ts` already calls `skipWaiting()` + `clients.claim()`); the existing
`useAppUpdate`/`version.json` toast stays purely as a "newer build exists,
reload when convenient" nicety, **not** a safety mechanism.

## Root-Cause Map (boot order) + online-first classification

The user asked that each online-first gate be classified as a _mistake/incidental_
vs _purposeful_ (and if purposeful, the why).

1. **App shell** — `apps/frontend/src/sw.ts:54-78`. Navigations served
   network-first via `fetch(req).catch(fallback)`; only falls back to cache when
   `fetch` _throws_ (fully offline), so a slow network hangs with no bound.
   **Verdict: PURPOSEFUL, real and serious rationale, over-corrected
   mechanism.** The concern is NOT soft "stale UX" — it is a hard boot
   failure. `public/_redirects` is `/* /index.html 200`: post-deploy, a
   cached old `index.html` requests its old hashed assets, those URLs are no
   longer in the current Cloudflare Pages deployment, and the SPA catch-all
   returns **`index.html` (200, `text/html`)** in their place. The browser
   executes HTML as a JS module (parse failure → React never mounts) and
   parses HTML as CSS (0 rules → unstyled). That is precisely the documented
   "post-deploy unstyled page" bug. A React-rendered toast can never fix this
   because React never mounts — so freshness-via-toast is not even a candidate
   here. Network-first does prevent it (always fetch fresh, build-consistent
   HTML when online) but pays for it by putting an unbounded network wait on
   every boot — throwing away offline speed to dodge a problem that the
   **build-atomic workbox precache already solves for free**: serving the
   precached `/index.html` guarantees the shell and the hashed assets it
   references are the same build. The fix is therefore not "invert to a
   bespoke SWR + toast" (an earlier draft of this plan — wrong, the toast
   can't run) but "use workbox's own precache navigation handler", which is
   cache-first, instant, offline, and makes the broken state impossible by
   construction. The existing React-independent recovery (index.html CSS
   watchdog → `sw-recovery` → `/recover`, capped at 2) remains the graceful
   backstop for any residual catastrophic case and is left untouched.

2. **Auth identity** — `index.html:106` eager `/api/auth/me` fetch (no timeout,
   no cached identity) + `auth/context.tsx` starts `loading:true` +
   `workspace-layout.tsx:336` `if (authLoading) return null`. Blank until the
   network resolves; offline it bounces to `/login`.
   **Verdict: INCIDENTAL (online-first by omission).** The only rationale comment
   is about overlapping the fetch with bundle parse — never made offline-aware.

3. **Workspace discovery** — PWA `start_url` `/` → `routes/index.tsx:13`
   unconditional `<Navigate to="/workspaces">` → `workspace-select.tsx:66`
   full-screen "Loading…" spinner gated on `/api/workspaces` (control-plane
   round trip just to learn which workspace to open).
   **Verdict: INCIDENTAL.** `useWorkspaces` already writes the list to IDB but
   never reads it back — a write-only cache with the loop never closed. No
   deliberate rationale.

4. **Socket config** — `socket-context.tsx:64` `await api.get(.../config)`
   before the socket is created (retries 1s/2s/4s).
   **Verdict: INCIDENTAL.** wsUrl/region is assigned at workspace creation and
   stable (per `docs/system-overview.md`); nothing prevents caching it. No
   deliberate rationale.

5. **No request timeout anywhere** — `api/client.ts:52` `apiFetch` has no
   `AbortController`/timeout; every request is unbounded.
   **Verdict: INCIDENTAL.** Never designed for flaky networks; lets background
   revalidations pile up forever instead of settling to cached state.

## Approach (5 surfaces, minimal patch each)

Reuse the existing pattern (cache → render → revalidate, like
`coordinated-loading-context.tsx` + the IDB store). New persistence helpers
mirror `lib/last-stream.ts` (tiny try/catch localStorage modules, key is the
single source of truth — INV-33).

### Helper modules (pure, already drafted pre-plan; keep)

- `apps/frontend/src/lib/cached-user.ts` — `getCachedUser/setCachedUser/clearCachedUser`
  (caches `{id,email,name}` only; the httpOnly cookie remains the credential).
- `apps/frontend/src/lib/last-workspace.ts` — `get/set/clearLastWorkspaceId`.
- `apps/frontend/src/lib/cached-ws-config.ts` — `get/setCachedWsConfig(workspaceId)`.

### S1 — SW app shell: workbox build-atomic precache navigation

The cached shell must always be served from the **same build** as the hashed
assets it references. Workbox's precache manifest already guarantees this
(`vite.config.ts:85` globs `html` + `js` + `css` into `self.__WB_MANIFEST`);
the current bespoke `fetch`-first handler was *shadowing* that precached,
already-revisioned `/index.html`. The minimal correct change is to delete the
hand-rolled handler and use the standard workbox SPA recipe.

- `apps/frontend/src/sw.ts`:
  - Delete the network-first navigation `fetch` listener (lines 54/62-78,
    including its now-stale rationale comment — INV-25/38).
  - Add (it already imports from `workbox-precaching`):
    ```ts
    import { NavigationRoute, registerRoute } from "workbox-routing"
    import { createHandlerBoundToURL } from "workbox-precaching"
    registerRoute(
      new NavigationRoute(createHandlerBoundToURL("/index.html"), {
        denylist: [/^\/api\//, /^\/recover/, /^\/sw\.js$/, /^\/version\.json$/],
      })
    )
    ```
    `createHandlerBoundToURL` returns the precached (build-consistent)
    `/index.html` — cache-first, instant, offline. `NavigationRoute` only
    matches top-level navigations. The **denylist is correctness, not
    polish**: today's `mode !== "navigate"` guard let full-page navigations
    to `/api/auth/login` (OAuth redirect) and `/recover.html` (the
    React-independent recovery page, `globIgnores`'d from precache) fall
    through to the network; serving them the SPA shell instead would break
    auth and disable recovery. The denylist preserves that.
  - No new `APP_SHELL_CACHE` and no entry in the `activate` keep-set:
    workbox owns the `workbox-precache-*` bucket, which `activate` already
    preserves (`!name.startsWith("workbox-precache-")`) and
    `cleanupOutdatedCaches()` already revisions atomically across SW
    versions.
- `index.html` CSS watchdog / `lib/sw-recovery.ts` / `/recover` / the
  router-level `ChunkLoadError` boundary — **all left untouched**. With a
  build-atomic precache the poison shell is structurally impossible, so these
  no longer fire on the routine post-deploy path; they remain solely as the
  catastrophic backstop (corrupted/partially-evicted cache). This is the
  "graceful handling" of the missing-asset boot failure the user asked for —
  it is React-independent (runs from `index.html` / a static page) precisely
  because, in that failure mode, React cannot mount to show anything.
- `hooks/use-app-update.ts` — **no change**. Because every precached build is
  internally consistent, a user "one build behind" is fully functional
  (just old), not broken, so the existing toast's
  `reloadForUpdate()` → `window.location.reload()` is sufficient: by the time
  the ≤5-min `version.json` poll surfaces the toast, the new SW (installed via
  `skipWaiting()` on first post-deploy navigation, `clients.claim()` on
  activate) has already taken over, so the reload serves the new build. No
  new toast, no SW-side diffing, no `refreshAppShellCache` — `version.json`
  stays the single change detector and the toast is reused verbatim
  (INV-33/36: no parallel mechanism).

Net effect: zero network on the boot critical path (vs. today's unbounded
wait), the post-deploy broken-shell failure made impossible by construction
rather than recovered-from, and one fewer module than the earlier draft
(no `lib/sw-app-shell.ts`).

### S2 — Auth: cached identity, render now, revalidate in background

`apps/frontend/src/auth/context.tsx`:
- Initialise `state` from `getCachedUser()` → `{ user, loading: !cached }`
  (cached user ⇒ no blank, no `authLoading` gate).
- `fetchUser`: success ⇒ `setCachedUser` + state; **401** ⇒ `clearCachedUser` +
  `{user:null,loading:false}` (→ login); **network error/timeout** ⇒ keep the
  cached user (stay usable offline), only set `{user:null}` when there was no
  cached user.
- `logout`: add `clearCachedUser()` alongside the existing
  `clearAllCachedData()` + `clearLastWorkspaceId()`.
- Add an `AbortController` timeout to the context's fallback fetch and to the
  `index.html` eager fetch so revalidation can't hang indefinitely.

### S3 — `/` entry → last-workspace redirect + cached picker

- `apps/frontend/src/routes/index.tsx`: replace the `/` element with a
  module-scope `RootRedirect` (INV-18): `getLastWorkspaceId()` ⇒
  `<Navigate to={/w/:id} replace>` else `<Navigate to="/workspaces" replace>`.
- `apps/frontend/src/pages/workspace-layout.tsx`: effect to
  `setLastWorkspaceId(workspaceId)` once `user` + `workspaceId` are known.
- `apps/frontend/src/pages/workspace-select.tsx`: when the list query is still
  loading, render the IDB-cached workspaces (Dexie `useLiveQuery` over
  `db.workspaces`) instead of the full-screen spinner; the query revalidates in
  the background. (Closes the write-only-cache loop in `useWorkspaces`.)

### S4 — Socket config cache (fast socket connect)

`apps/frontend/src/contexts/socket-context.tsx`:
- On connect, if `getCachedWsConfig(workspaceId)` exists, create the socket
  immediately from it and skip awaiting the fetch; still fetch config in the
  background, `setCachedWsConfig` on success, and if `wsUrl` changed close and
  reconnect to the fresh URL. No cache ⇒ current fetch+retry path unchanged.

### S5 — Global fetch timeout

`apps/frontend/src/api/client.ts`:
- `apiFetch` wraps fetch in an `AbortController` with a generous default
  (`DEFAULT_TIMEOUT_MS = 20000`, overridable via `options`). On abort throw a
  non-`ApiError` (network-like) so `handleGlobalError` does **not** treat it as
  a 401 redirect; queries fall back to cached/IDB state. Uploads use raw fetch
  (not `apiFetch`) so they are unaffected.

## Files to modify / add

- add: `lib/cached-user.ts`, `lib/last-workspace.ts`, `lib/cached-ws-config.ts`
  (+ `.test.ts` for each). No `lib/sw-app-shell.ts` — S1 is now the stock
  workbox recipe in `sw.ts`, nothing bespoke to unit-test.
- edit: `sw.ts` (S1, navigation route only — no keep-set change),
  `auth/context.tsx`, `index.html` (S2 eager-fetch timeout only; the CSS
  watchdog is untouched), `routes/index.tsx`, `pages/workspace-layout.tsx`,
  `pages/workspace-select.tsx`, `contexts/socket-context.tsx`,
  `api/client.ts`. **Not** edited: `hooks/use-app-update.ts`,
  `lib/sw-recovery.ts`, `components/error-boundary.tsx`, `/recover` page.
- tests: new `lib/*.test.ts`; new `auth/context.offline.test.tsx`; extend
  `api/client.test.ts` (timeout); extend `pages/workspace-select.test.tsx`
  (cached list) and add a routes redirect test. SW navigation is the stock
  workbox recipe (covered by workbox's own tests); verify it via the manual
  throttled-reload + post-deploy steps below rather than a brittle SW unit
  test. Respect INV-22/26/39.

## Verification

- `cd apps/frontend && bun run typecheck`
- `bun run test` (frontend unit/integration) — all green, no `.skip`.
- Targeted: new `lib` helper tests; auth offline cases (cached user renders
  with `loading:false`, network-fail keeps user, 401 clears + redirects);
  client timeout aborts as non-ApiError; workspace-select renders cached list;
  `/` redirects to `/w/:lastId` when set.
- Manual (dev, Chrome DevTools → Network → "Slow 3G", repeat launches): after a
  first good-network load, a throttled reload paints the cached shell + cached
  identity + last workspace + IDB data within ~1s (the SW serves the shell with
  zero network on the critical path), with sync catching up in the background;
  verify a real 401 still redirects to login and logout clears all cached
  identity/workspace state.
- Post-deploy correctness (the critical S1 check): build, serve, load once
  (SW precaches build-A). Rebuild with a changed asset hash + bumped
  `version.json`, redeploy/serve, then **hard-reload offline-throttled**.
  Expect: app boots fully (workbox serves build-A's consistent precached
  shell+assets — NOT a broken/unstyled page), the CSS watchdog does **not**
  fire, then the new SW activates and the `version.json` toast appears; click
  **Reload** and confirm it comes back on build-B in one reload. Also confirm
  a navigation to `/api/auth/login` and to `/recover.html` still hit the
  network (not the SPA shell) — i.e. the `NavigationRoute` denylist works.
- Root-level `bun run test:e2e` if boot-path E2E exists; otherwise note manual
  throttled-network verification explicitly.

## Risks / Notes

- Auth caching is display-only; security unchanged (cookie is the credential).
  Account-switch safety: logout clears cached user + last workspace + IDB;
  fresh login overwrites; a real 401 always clears + redirects.
- SW serves the workbox-precached `/index.html` (zero network on the boot
  critical path). The post-deploy "broken/unstyled shell" failure the
  original network-first code existed to prevent is **structurally
  impossible** here: a workbox precache manifest is build-atomic, so the
  shell and the hashed assets it references are always the same build (even
  offline, even immediately post-deploy on the old SW — old but consistent
  and fully functional, never broken). This matters because that failure
  mode kills React before it can mount, so a React toast could never have
  been the fix — the safety net has to be (and remains) the
  React-independent index.html CSS watchdog → `sw-recovery` → `/recover`
  (capped at 2) plus the router `ChunkLoadError` boundary, all left
  untouched. With atomic precache they should no longer fire on the routine
  post-deploy path. Freshness is delivered by the SW update lifecycle
  (`skipWaiting`/`clients.claim`, already present) surfaced via the existing
  `version.json` toast (≤5-min poll + visibility/reconnect); residual
  staleness for a never-backgrounded tab is bounded by that poll interval
  and the app stays fully functional throughout — strictly better than the
  old unbounded slow-network hang on every boot.
- 3 helper files were created moments before plan mode engaged; they are pure
  and inert (nothing imports them yet) and are part of this plan.
