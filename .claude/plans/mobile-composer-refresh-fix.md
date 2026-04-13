# Mobile Composer Refresh Fix

## Goal

Prevent the mobile stream composer from disappearing after soft restarts such as page refreshes or reloads after a deploy, while also fixing the browser-test regression currently failing on `main`.

## What Was Built

### Pending Message Startup Recovery

Startup hydration in the pending-messages provider now treats persisted unsent-message edit state as transient UI state instead of durable app state. If IndexedDB still contains a pending message marked as `"editing"` after a refresh, the provider restores it to its pre-edit queue status (`pending` or `failed`) and clears the edit hold instead of reopening the edit surface.

For restored `pending` messages, startup also nudges the background queue so those messages continue draining instead of getting stranded until the next reconnect.

**Files:**
- `apps/frontend/src/contexts/pending-messages-context.tsx` — normalize stale `"editing"` rows during hydration, persist `preEditStatus` when entering edit mode, and kick the queue after restoring pending messages
- `apps/frontend/src/db/database.ts` — add `preEditStatus` to the persisted pending-message shape

### Regression Coverage

Added unit coverage for the new hydration behavior so stale edit sessions do not silently reappear in future changes.

**Files:**
- `apps/frontend/src/contexts/pending-messages-context.test.tsx` — verifies startup restores stale edits to `pending` or `failed`, and that restored pending messages trigger queue processing

### CI Browser Test Repair

Scoped the failing browser assertion to timeline message rows so it no longer matches both the main message body and the sidebar preview text.

**Files:**
- `tests/browser/new-channel-socket-subscription.spec.ts` — scope the send assertion to `.message-item`

## Design Decisions

### Persist The Pre-Edit Queue State

**Chose:** Store `preEditStatus` on pending messages while they are being edited.
**Why:** Startup recovery needs to know whether a stale edit should return to `pending` or `failed`; defaulting everything to `pending` would incorrectly requeue failed sends.
**Alternatives considered:** Infer from the event table alone during startup. That does not work once both the event and pending record have already been flipped to `"editing"`.

### Do Not Reopen Unsent Edit UI Across Reloads

**Chose:** Treat unsent-message edit mode as transient and cancel it on startup.
**Why:** The bug is caused by stale edit UI state surviving a restart and hiding the composer again on mobile. Reopening the edit surface preserves the bug class instead of removing it.
**Alternatives considered:** Continue restoring `"editing"` and rely on DOM-driven hiding. That still remounts the hidden-composer path during reloads.

### Kick The Queue After Startup Recovery

**Chose:** Schedule a deferred queue notify after restoring stale edits to `pending`.
**Why:** If hydration runs after the queue’s initial startup drain, restored pending messages would otherwise sit idle until another reconnect or manual send.
**Alternatives considered:** Depend on the initial queue connect effect. That ordering is not reliable enough during startup.

## Design Evolution

- **Startup recovery widened slightly during self-review:** initial implementation restored stale `"editing"` rows to `pending`/`failed`, but self-review found that restored `pending` rows might not resume sending unless the queue was explicitly nudged. The final version schedules a queue notify after hydration.

## Schema Changes

- No migration required. This changes the IndexedDB cache shape only by adding `preEditStatus` to `PendingMessage`.

## What's NOT Included

- No new browser-level mobile reload regression test yet; coverage is currently at the provider/unit level plus the targeted browser fix for the failing CI selector.
- No changes to the CSS `:has()` composer-hiding rule from PR #346.
- No changes to sent-message inline-edit behavior; this patch only changes unsent pending-message recovery on startup.

## Status

- [x] Restore stale unsent edit state to `pending` or `failed` on startup
- [x] Resume queue processing for restored pending messages
- [x] Fix the current `new-channel-socket-subscription` browser-test failure
- [x] Add unit regression coverage for the hydration path
- [ ] Add a full browser/mobile reload regression test for stale unsent edit state
