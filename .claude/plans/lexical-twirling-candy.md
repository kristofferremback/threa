# IDB-First Rendering: Always Show Cached Data

## Context

The offline-first sync engine writes all data to IDB, but the rendering layer still waits for network bootstrap before showing anything. This causes:

1. **Coordinated loading blocks on network** — returning users see skeleton even though IDB has a full cache from 5 seconds ago
2. **Stream content flashes empty on revisit** — navigating back to a previously loaded stream shows "Loading..." then events, because `useStreamEvents` returns `[]` on streamId change (useLiveQuery async default)
3. **`use-events.ts` intentionally hides IDB events** — line 163: "isLoading is true so components show skeletons, not events" — this explicitly shows loading spinner instead of cached events

The principle is simple: **IDB is the source of truth. If IDB has data, show it. Only show loading when there's truly nothing.**

---

## Changes

### 1. Coordinated loading: open gate immediately when IDB has cached data

**File:** `apps/frontend/src/contexts/coordinated-loading-context.tsx`

The coordinated loading phase system (`loading → skeleton → ready`) is preserved. IDB data just makes the transition to "ready" faster. The gate still coordinates: nothing renders until phase = "ready", ensuring sidebar and stream content appear together.

Restore the immediate `idbCachePrimed` gate bypass (currently a 3s offline fallback). When `seedCacheFromIdb` completes and finds data, the workspace and stream loading checks are satisfied — the gate proceeds to "ready" through the normal phase machinery (including avatar preload).

The previous "stream before sidebar" issue was caused by `applyStreamBootstrap` `put()` destroying `lastMessagePreview` — now fixed (uses `update()`). With cache-backed workspace hooks, both sidebar and stream content have data on the same render.

Change:
```
// Current (waits for network, 3s fallback):
const workspaceLoading = !offlineFallback && (workspaceSyncStatus === "idle" || ...)
const streamsLoading = !offlineFallback && isQueryLoadStateLoading(...)

// New (opens when IDB has data — goes through normal phase + avatar checks):
const workspaceLoading = !idbCachePrimed && (workspaceSyncStatus === "idle" || ...)
const streamsLoading = !idbCachePrimed && isQueryLoadStateLoading(...)
```

Keep workspace-scoped tracking (`primedWorkspaceId === workspaceId`) to prevent cross-workspace leaks. The `isReady` effect still requires `!isLoading && avatarsReady` — the phase system controls when content appears, not the IDB bypass directly.

### 2. Stream events loading: IDB data = not loading

**File:** `apps/frontend/src/hooks/use-events.ts`

No per-stream cache needed — useLiveQuery resolves from IDB within ~10ms, which is acceptable. The fix is in the `isLoading` logic: when IDB has events, the stream is not "loading" — it has data to show. The ~10ms useLiveQuery gap is brief enough to wait through without showing a spinner.

No changes to `stream-store.ts`.

### 3. Stream content: only show loading when IDB truly has no events

**File:** `apps/frontend/src/hooks/use-events.ts`

Change the `isLoading` logic. Currently:
```typescript
// Line 183: waits for bootstrap even when IDB has events
const isLoading = isBootstrapLoading || !idbResolved
```

New logic — **only show loading when IDB has no events to display**:
```typescript
const hasIdbEvents = idbEvents.length > 0
const isLoading = !hasIdbEvents && (isBootstrapLoading || !idbResolved)
```

This covers three cases:

| IDB state | Bootstrap state | Result |
|-----------|----------------|--------|
| Has events (revisit / cached) | Loading or done | `isLoading = false` → show IDB events |
| Empty (first visit) | Loading | `isLoading = true` → show spinner |
| Empty (first visit) | Done, 0 events | `isLoading = false` → show "No messages yet" |

Also update the comment on line 162-163 — IDB events should be shown, not hidden behind loading.

When bootstrap completes, `bootstrapFloor` is computed and the events re-filter to the bootstrap window. useLiveQuery picks up any new events written by the bootstrap. This is a seamless background update — no flash.

---

## Files to modify

| File | Change |
|------|--------|
| `apps/frontend/src/contexts/coordinated-loading-context.tsx` | Restore immediate IDB gate bypass with workspace-scoped tracking |
| `apps/frontend/src/hooks/use-events.ts` | Only show loading when IDB truly has no events |

---

## What NOT to change

- `seedCacheFromIdb` and `seedWorkspaceCache` — already correct
- `useArrayStoreHook` / `useSingletonStoreHook` — already correct
- `applyStreamBootstrap` — already fixed (`update()` instead of `put()`)
- Socket handlers — already fixed (partial `update()`, `lastMessagePreview` writes)
- Cache version guard — already in place

---

## Verification

1. **Clear IDB → reload**: First load waits for bootstrap (no IDB data) → everything appears together
2. **Reload without clearing IDB**: Cached data appears instantly from IDB → no loading spinner → no reordering when bootstrap arrives
3. **Navigate between streams**: Previously loaded streams show events instantly, no empty flash
4. **Navigate to never-loaded stream**: Shows loading spinner until bootstrap completes
5. **Offline (disable network)**: Cached data appears after IDB priming (~10ms), no stuck skeleton
6. **Run `bun run --cwd apps/frontend typecheck && bun run --cwd apps/frontend test`**
