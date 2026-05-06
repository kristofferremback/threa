# Stream Navigation Freshness

## Goal

Ensure opening a stream in an already-running client performs a fresh subscribe-then-bootstrap pass instead of trusting an infinitely fresh React Query bootstrap cache or IndexedDB-only data. This fixes cases where a PWA/mobile client navigates to a long-running DM and renders stale local messages until a hard refresh.

## What Was Built

### Navigation-triggered stream refresh

The frontend sync engine now treats `currentStreamId` changes as freshness boundaries. When the route stream changes and a socket is available, it joins the stream room with an ack, fetches the stream bootstrap, applies it to IndexedDB, updates the stream bootstrap query cache, and updates stream sync status.

**Files:**
- `apps/frontend/src/sync/sync-engine.ts` — adds route-change stream refresh, singleflight protection per stream, subscribe-then-bootstrap ordering, IDB application, and React Query cache update.

### Bootstrap mode selection

The refresh path chooses the bootstrap shape based on available cache state:

- Existing stream bootstrap query cache: fetch with `after: latestPersistedSequence` and append into the previous cached bootstrap window.
- IndexedDB-only state: fetch a full bootstrap without `after`, avoiding an incoherent query window where appended events would be cached without the server's current bootstrap floor.

**Files:**
- `apps/frontend/src/sync/sync-engine.ts` — checks for previous cached bootstrap before using a delta fetch.

### Regression tests

Added tests for the mobile/PWA-style already-connected navigation path:

- Navigating to a stream with stale React Query bootstrap cache fetches a delta from the latest local event sequence and writes the new event/cache state.
- Navigating to a stream with only IndexedDB data performs a full bootstrap.

**Files:**
- `apps/frontend/src/sync/sync-engine.test.ts` — adds stream bootstrap fixtures and route-change refresh coverage.

## Design Decisions

### Refresh in the sync engine

**Chose:** Handle route-change freshness in `SyncEngine.setCurrentStreamId`.
**Why:** The sync engine already owns socket lifecycle, room joins, bootstrap application, reconnect behavior, and sync status. Keeping this there preserves INV-53 and avoids scattering freshness logic across route components.
**Alternatives considered:** Relying on `useStreamBootstrap` invalidation. That would still be easy to bypass because several UI paths render from IndexedDB and stream bootstrap queries use `staleTime: Infinity`.

### Delta only when query cache exists

**Chose:** Use `after` only when a previous stream bootstrap query cache exists.
**Why:** `toCachedStreamBootstrap` can append delta events into an existing cached bootstrap window. With only IndexedDB data, a delta response would not contain the full authoritative bootstrap window, so the query cache could become misleading for timeline floor calculations.
**Alternatives considered:** Always using `after` from IndexedDB. Rejected because IndexedDB and React Query serve different roles in the current read model.

### Keep refresh singleflight per stream

**Chose:** Track active route-change refreshes by stream id.
**Why:** Rapid route/effect churn should not fan out duplicate bootstrap requests for the same stream. This mirrors the existing workspace bootstrap singleflight behavior.

### Merge against current cache on write

**Chose:** Use the functional `setQueryData` updater and merge append responses into the cache value present at write time.
**Why:** Socket handlers or other observers can update stream bootstrap cache while the navigation refresh is awaiting room join, cursor lookup, bootstrap fetch, or IndexedDB writes. Merging against the current cache avoids overwriting those concurrent updates, and append-mode cache conversion keeps the highest known `latestSequence`.

## Design Evolution

- **Initial suspicion:** React Query invalidation might be enough.
- **Final approach:** Add sync-engine-owned navigation refresh, because hard refresh and in-app navigation differ specifically in React Query cache lifetime while IndexedDB may still render immediately.

## Schema Changes

None.

## What's NOT Included

- No backend sync changes. The observed issue is addressed in the frontend navigation/bootstrap path.
- No changes to service worker background sync. Resume/background freshness remains complementary to this route-change refresh.
- No global change to stream bootstrap `staleTime`. Other paths still rely on the cache remaining stable unless explicitly refreshed.

## Status

- [x] Route stream changes trigger subscribe-then-bootstrap refresh.
- [x] Delta and full bootstrap paths are selected based on cache state.
- [x] Navigation refresh cache writes preserve concurrent cache updates.
- [x] Regression tests cover stale query cache and IDB-only navigation.
- [x] Focused frontend sync tests pass.
- [x] Frontend typecheck passes.
