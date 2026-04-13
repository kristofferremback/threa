# Plan: stale messages on app resume from background

## Context

PR #350 fixed transient HTTP errors during stream bootstrap on navigation. A separate failure mode exists for mobile/desktop tab resume:

A user backgrounded the app on their phone, sent messages from another device into a stream they were viewing, then returned to the app and saw stale data. No bootstrap fired on resume because none of the existing resume signals matched the scenario:

- `socket.io` reconnect didn't fire — the WebSocket was likely a zombie (mobile OS killed the underlying transport but the client thinks it's alive). socket.io's native pingTimeout takes 20–25s to detect this.
- `navigator.onLine` didn't flap — the phone never lost network, only the app was suspended.
- Nothing else in the codebase reacts to `visibilitychange`.

The intended outcome: when the page becomes visible after being hidden long enough to suggest real backgrounding, the app should proactively (a) verify the socket is actually alive, (b) force a reconnect if it's a zombie, and (c) refetch any state that may have drifted while we couldn't receive socket events.

## Design

Two coordinated additions:

1. **Visibility-resume trigger** — react to `visibilitychange` going hidden→visible after ≥10s hidden, and call into the SyncEngine.
2. **Active socket health probe** — on resume, send a lightweight ack-bearing event with a 3s timeout. If the ack doesn't come back, the socket is a zombie; force `socket.disconnect()` + `socket.connect()` to short-circuit socket.io's 20–25s native detection. If the ack succeeds, just call the existing `refreshAfterConnectivityResume()` since events may have been missed during background.

Reuses existing infrastructure throughout — no new singleflight, no new sync orchestration. The 10s threshold avoids spurious refetches from quick app-switcher previews and notification-shade glances.

## Files to add

### `apps/backend/src/socket.ts`

Add a `'health:ping'` handler near the existing `heartbeat` handler (~line 366). One line:

```ts
socket.on("health:ping", (callback?: (result: { ok: true }) => void) => {
  callback?.({ ok: true })
})
```

Naming: `health:ping` (not bare `ping`) keeps grep hits separate from socket.io's transport-level ping that shows up in logs. No throttling, no auth check beyond connection-level — purely a liveness probe.

### `apps/frontend/src/lib/socket-health.ts` (new)

```ts
export async function pingSocket(socket: Socket, timeoutMs?: number): Promise<boolean>
```

Emits `'health:ping'` with an ack callback, returns `true` on ack within `timeoutMs` (default 3000), `false` on timeout or socket disconnect during the probe. No throw — boolean return so call sites stay flat.

### `apps/frontend/src/lib/socket-health.test.ts` (new)

Cases:
- Returns `true` when the ack fires before timeout.
- Returns `false` when the ack does not fire before timeout.
- Returns `false` when the socket disconnects mid-probe.
- Cleans up the disconnect listener on settle (no leaked handlers).

Use a stub `Socket` (vi.fn-driven `emit`/`on`/`off`) — no live socket.io needed.

### `apps/frontend/src/hooks/use-page-resume.ts` (new)

```ts
export function usePageResume(onResume: () => void, hiddenThresholdMs?: number): void
```

- Listens to `visibilitychange` on `document`.
- On `hidden`: records `hiddenSinceRef.current = Date.now()`.
- On `visible`: if `hiddenSinceRef.current` is set and `Date.now() - hiddenSinceRef.current >= HIDDEN_THRESHOLD_MS` (default 10_000), invokes `onResume()`. Clears the timestamp either way.
- Stores `onResume` in a ref so consumers don't need to memoize.
- Cleans up listeners on unmount.

Pattern: same shape as the transition-tracking ref in `apps/frontend/src/contexts/socket-context.tsx:163-185`, but pulled into a dedicated hook because the semantics (hidden-for-≥N-ms then visible again) are distinct from the socket heartbeat's "any visibility/focus transition fires immediately."

### `apps/frontend/src/hooks/use-page-resume.test.ts` (new)

Use the established Vitest pattern from `apps/frontend/src/hooks/use-auto-mark-as-read.test.ts:54-130`:

```ts
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilityState })
visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange"))
```

Cases:
- Short hide (< threshold) does not fire `onResume`.
- Long hide (>= threshold) fires `onResume` exactly once.
- Multiple hide/visible cycles each evaluate independently.
- Becomes-visible without prior hide does not fire.
- Updates to the `onResume` callback are honored (ref refresh).

### `apps/frontend/src/sync/sync-engine.test.ts` (new)

This file doesn't exist yet — `SyncEngine`'s coverage so far has been via `workspace-sync.test.ts` integration tests. Create it focused on the new method to keep the surface tight.

Cases for `handlePageResume`:
- Early-returns when `isDestroyed`, when no `socket`, when `!hasEverConnected`, when `socket.connected === false`.
- On successful ping, calls `refreshAfterConnectivityResume()` (assert via spy on `runBootstrap` or by asserting bootstrap fires).
- On failed ping, calls `socket.disconnect()` and then `socket.connect()`, and does NOT call `refreshAfterConnectivityResume()` (the natural `onConnect(isReconnect=true)` cycle will handle it).
- Two rapid `handlePageResume` calls do not double-bootstrap (the existing `runBootstrap` singleflight covers this).

## Files to modify

### `apps/frontend/src/sync/sync-engine.ts`

Add a public method:

```ts
async handlePageResume(): Promise<void>
```

Logic:

```
if (this.isDestroyed || !this.socket || !this.hasEverConnected) return
if (!this.socket.connected) return    // socket.io is already reconnecting — don't pile on
const healthy = await pingSocket(this.socket, 3000)
if (!healthy) {
  this.socket.disconnect()
  this.socket.connect()               // socket.io-client v4: manual disconnect disables auto-reconnect, so we connect explicitly
  return                              // onConnect(isReconnect=true) will fire via the SocketProvider/WorkspaceSyncHandler chain
}
await this.refreshAfterConnectivityResume()
```

### `apps/frontend/src/pages/workspace-layout.tsx`

In `WorkspaceSyncHandler` (lines 116–220), add one hook call alongside the existing online-resume effect:

```ts
usePageResume(useCallback(() => {
  void syncEngine.handlePageResume()
}, [syncEngine]))
```

No changes to existing effects — the new trigger is additive.

## Reused existing infrastructure

- `SyncEngine.refreshAfterConnectivityResume()` (`apps/frontend/src/sync/sync-engine.ts:135-138`) — already singleflighted via `runBootstrap`'s `activeBootstrap` + `queuedReconnectBootstrap` (lines 343-374). Overlapping resume + socket-reconnect calls collapse into one queued reconnect bootstrap.
- `SocketProvider`'s `connect` handler (`apps/frontend/src/contexts/socket-context.tsx:68-79`) sets `reconnectCount++` on every reconnect, which drives `WorkspaceSyncHandler`'s socket effect (workspace-layout.tsx:177-184) → `syncEngine.onConnect(isReconnect=true)`. The force-reconnect branch piggybacks on this exact path.
- Vitest visibility-mocking pattern from `apps/frontend/src/hooks/use-auto-mark-as-read.test.ts:54-130`.
- `joinRoomBestEffort`'s settle/cleanup pattern in `apps/frontend/src/lib/socket-room.ts` is a good template for `pingSocket`'s settle-once + cleanup discipline.

## Out of scope

- iOS Safari `pageshow` with `event.persisted=true` (BFCache restore) — different lifecycle. The reported bug is `visibilitychange`, which fires reliably for app-switch resume.
- Server-side presence/idle bumping on `health:ping` — keep the handler stateless. If presence semantics need it later, that's a separate change.
- Configurable thresholds — module-level constant for now; expose if a second consumer needs a different value.

## Verification

1. **Unit tests** — `bun --cwd apps/frontend run test:watch --run src/lib/socket-health.test.ts src/hooks/use-page-resume.test.ts src/sync/sync-engine.test.ts` should pass.
2. **Full frontend suite** — `bun --cwd apps/frontend run test` should pass without regressions to the existing 1147 tests.
3. **Typecheck** — `bun --cwd apps/frontend run typecheck` (and the monorepo-wide pre-commit check) clean.
4. **Backend** — at minimum manual: `bun --cwd apps/backend run test` should pass (the new handler is a one-liner and existing socket tests don't cover handlers, so this doesn't gain a new test unless the team prefers adding one — flag at PR review time).
5. **Manual smoke (mobile)** — open the app on phone, send a message from a second device, switch to another app for >10s, return to the app: stream should refresh within ~1 second (probe + delta fetch) instead of remaining stale.
6. **Manual smoke (zombie socket)** — Chrome DevTools → Application → Service Workers → "Offline" toggle is unreliable here (doesn't suspend the JS context). Better repro: with the dev server, toggle the laptop's Wi-Fi off, wait a few seconds, toggle back on with the tab still focused, then trigger a visibility change (Cmd+Tab away and back). Verify the loading indicator appears briefly and stale events are replaced by fresh ones.

## Sequencing

1. Backend `health:ping` handler.
2. `socket-health.ts` + tests.
3. `use-page-resume.ts` + tests.
4. `SyncEngine.handlePageResume` + new `sync-engine.test.ts`.
5. Wire into `WorkspaceSyncHandler`.
6. Run the full test suite, typecheck, then commit and push to the new branch (rebase first onto `origin/main` since #350 is merged).
