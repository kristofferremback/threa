# Fix Broken DM Promotion

## Goal

Fix the recipient-side promotion path for lazily created DMs so a user who is currently viewing a fake DM draft is moved onto the newly created real DM stream as soon as the first message arrives, without requiring a workspace refresh. The sidebar and Activity feed should resolve that DM as the real private stream immediately.

## What Was Built

### Recipient-side DM promotion in workspace sync

`stream:created` handling for DMs now treats the event as a full local promotion for participating users instead of waiting for a follow-up workspace bootstrap refetch.

**Files:**
- `apps/frontend/src/sync/workspace-sync.ts` — resolves the DM peer from `dmUserIds`, populates the real DM stream into bootstrap and IndexedDB caches, writes the `dmPeers` entry, adds the recipient membership when needed, and subscribes the client to the new stream room immediately.

### Regression coverage for the recipient path

Added explicit coverage for the bug scenario where user A is sitting in a fake DM while user B sends the first message.

**Files:**
- `apps/frontend/src/sync/workspace-sync.test.ts` — verifies a DM `stream:created` event promotes the recipient immediately without a workspace refetch.
- `tests/browser/dm-lazy-creation.spec.ts` — covers both the existing sender-side lazy-creation flow and the new recipient-side promotion/activity-label flow in the browser.

## Design Decisions

### Promote from the socket event instead of waiting for bootstrap

**Chose:** update both TanStack workspace bootstrap state and IndexedDB from the incoming DM `stream:created` event.
**Why:** the bug was caused by the recipient path not writing the newly created DM into the persistent client caches, which left the fake DM visible until a later refresh/bootstrap completed.
**Alternatives considered:** keep relying on `queryClient.refetchQueries(...)` for the workspace bootstrap. This was rejected because it still leaves a race between the real-time event and the eventual refetch, which is the exact stale-state gap the bug exposed.

### Resolve DM names from existing viewer-specific cache inputs

**Chose:** derive the DM display name from the known peer user ID plus `workspace.users`.
**Why:** DM `stream:created` payloads still carry the raw DB row with `displayName: null`, and the viewer-specific name already exists as a frontend concern in the workspace cache model.
**Alternatives considered:** introduce backend-side viewer-resolved DM names on socket payloads. That would be a larger contract change than needed for this bug.

## Design Evolution

No earlier branch-local plan file or Claude session plan was available in this worktree, so the implementation stayed on the minimal path: fix recipient-side cache promotion only and prove it with targeted regressions.

## Schema Changes

None.

## What's NOT Included

- No backend change to DM creation or upsert semantics. The existing `findOrCreateDm` flow already handles concurrent first-message creation via the DM uniqueness key.
- No change to general sidebar organization or Smart/All view behavior outside making the promoted DM available to the existing UI state immediately.
- No Activity feed rendering change. The fix ensures Activity has the real DM stream available in client state so existing name resolution can work.

## Status

- [x] Promote recipient-side fake DMs to real DMs from `stream:created`
- [x] Persist DM peer and membership data immediately for participating users
- [x] Cover the recipient promotion path with a unit regression
- [x] Cover the no-refresh recipient/activity flow with a browser regression
