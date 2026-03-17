# Load Data During Splash Screen

## Problem

Cold start waterfall on installed PWA:

```
PWA Splash (~1s) → JS Bundle Load → Auth fetch → Workspace list → Navigate → Socket config fetch → Socket connect → Room join → Bootstrap fetch → Avatar preload → Ready
```

Each step waits for the previous one. The user sees: splash → blank → skeleton → content.

## Root Causes

1. **Auth fetch starts late** — `AuthProvider` fires `fetch("/api/auth/me")` only after React mounts and the full component tree renders. The PWA splash screen and JS parse time are wasted.

2. **IndexedDB cache is write-only** — The app writes workspace bootstrap, streams, users, and personas to IndexedDB on every successful fetch, but never reads it back on startup. All that cached data sits unused while the network waterfall runs.

3. **Workspace bootstrap blocked on socket** — `useWorkspaceBootstrap` has `enabled: !!socket`, so the HTTP fetch for workspace data can't even start until the socket connection is established (which itself requires a config fetch + WebSocket handshake).

## Solution

Three changes, ordered by impact-to-risk ratio:

### 1. Eager auth fetch in `index.html` (biggest win)

Add a small inline `<script>` in `index.html` that starts the `/api/auth/me` fetch **before the JS bundle even loads**. Store the promise on `window.__eagarAuthPromise`. The `AuthProvider` consumes this promise instead of starting a new fetch.

This overlaps the auth round-trip with JS parsing/evaluation — typically saving 200-500ms.

**Files:** `apps/frontend/index.html`, `apps/frontend/src/auth/context.tsx`

### 2. Seed TanStack Query from IndexedDB cache

Create a startup module that reads the last workspace bootstrap from IndexedDB and pre-populates the TanStack Query cache with `initialData`. This makes `CoordinatedLoadingGate` see data immediately and transition straight to "ready" phase with cached content.

The flow becomes:
1. Read workspace + streams + users + personas from IndexedDB
2. Determine which workspace to use (from URL path or single-workspace shortcut)
3. Seed `workspaceKeys.bootstrap(workspaceId)` with the cached data
4. The UI renders instantly with stale data
5. Background: socket connects → room join → fresh bootstrap replaces cached data

We also need to seed the workspace list query so `WorkspaceSelectPage` can redirect immediately without waiting for the network.

**Subtlety:** `getQueryLoadState` maps `status="success"` to `READY`, so seeded queries correctly skip the loading gate. The bootstrap query's `staleTime: Infinity` means it won't auto-refetch, but the socket-gated `enabled` condition ensures it re-runs when the socket connects (the query transitions from disabled → enabled, which triggers a fetch).

Wait — actually with `staleTime: Infinity` and `initialData`, TanStack Query won't refetch when enabled changes because the data is already "fresh". We need to set `initialDataUpdatedAt: 0` so the data is always considered stale, ensuring a background refetch happens.

**Files:** New `apps/frontend/src/lib/cache-seed.ts`, modifications to `apps/frontend/src/main.tsx`, `apps/frontend/src/hooks/use-workspaces.ts`

### 3. Seed workspace list from IndexedDB for instant redirect

The `WorkspaceSelectPage` auto-redirects when there's exactly one workspace. If we seed the workspace list query from IndexedDB, this redirect happens before any network request completes.

**Files:** `apps/frontend/src/hooks/use-workspaces.ts`, `apps/frontend/src/lib/cache-seed.ts`

## What We're NOT Doing

- **Decoupling bootstrap from socket** — The current design joins the room BEFORE fetching bootstrap data to avoid missing events. Changing this ordering risks data gaps and is a larger architectural change. The IndexedDB seeding achieves similar instant-display without this risk.
- **Service worker bootstrap prefetch on cold start** — The SW already prefetches stream bootstrap on push notification receipt. Extending this to cold starts would require knowing which workspace/stream to fetch, which isn't available until auth completes.

## Implementation Steps

1. Add eager auth fetch script to `index.html`
2. Update `AuthProvider` to consume the eager promise
3. Create `cache-seed.ts` module that reads IndexedDB and seeds TanStack Query
4. Call cache seed from `main.tsx` before `createRoot`
5. Update `useWorkspaces` to accept seeded initial data
6. Update `useWorkspaceBootstrap` to use `initialDataUpdatedAt: 0` when seeded
7. Test that stale cache renders immediately, then fresh data replaces it

## Expected Result

```
PWA Splash + Auth fetch + IndexedDB read (parallel) → Instant render with cached data → Background refresh
```

For returning users with cached data, the app should appear ready almost immediately after the PWA splash dismisses, with fresh data seamlessly replacing cached data within 1-2 seconds.
