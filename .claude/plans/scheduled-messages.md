# Scheduled Messages

## Goal

Add first-class scheduled messages so a user can compose a message, choose a future send time from the composer, and manage those delayed sends from a sidebar explorer. The implementation combines the reminder system's delayed queue mechanics with composer and stashed-draft UX patterns, while keeping scheduled sends race-safe when users edit, pause, delete, or fast-track messages near their scheduled time.

## What Was Built

### Backend Scheduling

Scheduled messages are persisted as workspace/user scoped records, queued through the existing queue system, and fired by a LIGHT-tier worker. Sending now updates `scheduled_at` to the current time and keeps the scheduled-message worker in the path instead of bypassing scheduling.

**Files:**
- `apps/backend/src/db/migrations/20260502103957_scheduled_messages.sql` - Adds the `scheduled_messages` table, active-message indexes, queue lookup index, and client-message idempotency constraint.
- `apps/backend/src/features/scheduled-messages/repository.ts` - Implements status transitions with version guards for create, update, edit lock, delete, claim, sent, and failed states.
- `apps/backend/src/features/scheduled-messages/service.ts` - Owns transactions, stream writability checks, queue insertion/cancellation, outbox publication, send-now fast tracking, and worker fire behavior.
- `apps/backend/src/features/scheduled-messages/worker.ts` - Processes scheduled-message queue jobs.
- `apps/backend/src/features/scheduled-messages/handlers.ts` - Exposes list/create/update/pause/resume/send-now/edit-lock/delete handlers.
- `apps/backend/src/features/scheduled-messages/view.ts` - Resolves API views with stream display names.
- `apps/backend/src/routes.ts` - Registers scheduled-message API routes.
- `apps/backend/src/server.ts` - Instantiates the service and registers the worker.
- `apps/backend/src/lib/queue/index.ts` and `apps/backend/src/lib/queue/job-queue.ts` - Adds the scheduled-message queue type and payload.
- `apps/backend/src/lib/outbox/repository.ts` - Adds user-targeted scheduled-message upsert/delete outbox events.
- `apps/backend/src/lib/id.ts`, `packages/backend-common/src/id.ts`, and `packages/backend-common/src/index.ts` - Adds scheduled-message and queue id helpers.

### Shared Types

The API contract includes scheduled-message statuses, list/create/update/version payloads, and websocket payloads.

**Files:**
- `packages/types/src/constants.ts` - Adds `ScheduledMessageStatuses`.
- `packages/types/src/api.ts` - Adds scheduled-message API and outbox payload types.
- `packages/types/src/index.ts` - Re-exports scheduled-message types.

### Frontend Data And Sync

Scheduled messages are available through a workspace service, cached in IndexedDB, synchronized by websocket outbox events, and queried with TanStack Query plus Dexie live queries.

**Files:**
- `apps/frontend/src/api/scheduled-messages.ts` - API client methods for all scheduled-message operations.
- `apps/frontend/src/api/index.ts` - Exports the scheduled-message client.
- `apps/frontend/src/contexts/services-context.tsx` and `apps/frontend/src/contexts/index.ts` - Adds `ScheduledMessagesService` to the app service context.
- `apps/frontend/src/db/database.ts` and `apps/frontend/src/db/index.ts` - Adds the `scheduledMessages` Dexie table and clears it on logout.
- `apps/frontend/src/hooks/use-scheduled-messages.ts` and `apps/frontend/src/hooks/index.ts` - Adds list/count hooks and create/update/action/delete mutations.
- `apps/frontend/src/sync/workspace-sync.ts` - Applies scheduled-message upsert/delete socket events to IndexedDB.

### Composer UX

The composer now has a clock action immediately before the stashed drafts action. Desktop uses a small popover. Mobile uses a bottom drawer aligned with the existing reminder picker pattern: preset actions first, then a custom date/time mode with separate native inputs and a back affordance. Editing a scheduled message uses the normal composer and changes submit affordance from send to save.

**Files:**
- `apps/frontend/src/components/composer/schedule-message-picker.tsx` - New schedule picker for desktop popover and mobile drawer.
- `apps/frontend/src/components/composer/message-composer.tsx` - Adds schedule slots beside stashed drafts and supports a save submit icon/label.
- `apps/frontend/src/components/composer/index.ts` - Exports the schedule picker.
- `apps/frontend/src/components/timeline/message-input.tsx` - Creates scheduled messages from composer state, loads scheduled messages into composer edit mode, preserves current draft by stashing before edit, handles near-send edit locking, and saves/cancels edits.
- `apps/frontend/src/components/timeline/message-input.test.tsx` - Adds coverage for scheduling from the composer and updates test setup for the new schedule action.

### Scheduled Explorer

The sidebar gets a Scheduled quick link with a live count. The explorer lists active and sent scheduled messages, supports edit/pause/resume/send-now/delete actions, and links sent rows to their delivered message.

**Files:**
- `apps/frontend/src/pages/scheduled.tsx` - New scheduled-message explorer page.
- `apps/frontend/src/routes/index.tsx` - Registers `/w/:workspaceId/scheduled`.
- `apps/frontend/src/components/layout/sidebar/sidebar.tsx` - Wires scheduled count and active route state.
- `apps/frontend/src/components/layout/sidebar/quick-links.tsx` - Adds the Scheduled quick link.
- `apps/frontend/src/components/layout/sidebar/quick-links.test.tsx` - Updates quick-link tests for the new item.

## Design Decisions

### Keep Scheduled Sends In The Queue Path

**Chose:** `send now` sets `scheduled_at` to now and re-enqueues the scheduled message.

**Why:** This preserves the same worker path, idempotency behavior, and failure handling as ordinary scheduled sends. It avoids a second direct-send code path that could drift from queue behavior.

### Version Guard Every Mutable Operation

**Chose:** Mutations accept `expectedVersion`, repository updates check it, and service methods also re-check current status before changing rows.

**Why:** Scheduled messages can be edited, paused, deleted, or fired concurrently. Version guards turn those races into explicit conflicts rather than silently applying stale writes.

### Temporarily Move Editing Messages Out Of The Send Flow

**Chose:** Opening edit mode calls an edit lock that cancels the queue message and moves the row to `editing`. If the scheduled time is within 30 seconds, the UI waits for the lock before loading the message. Otherwise, it loads the editor immediately and retries the lock in the background.

**Why:** Near-send edits must be conservative to avoid sending stale content. Far-future edits should feel instant, with a toast only if the background lock repeatedly fails.

### Restore Previous Pause State After Edit

**Chose:** `edit_previous_status` is captured when entering edit mode and used when saving or canceling without an explicit status.

**Why:** Editing a paused scheduled message should not accidentally resume it. This keeps pause semantics intact while still releasing ordinary scheduled messages back into the send flow.

### Reuse Composer And Reminder Patterns

**Chose:** The scheduled picker uses the same preset math as reminders, desktop popovers, mobile bottom-drawer patterns, and the normal message composer for editing.

**Why:** The feature should feel like a small extension of existing message composition rather than a separate form surface.

## Design Evolution

- **PR 448 used as inspiration only:** The implementation was built on a fresh branch from `origin/main`; the earlier PR was not used as a code base.
- **Mobile custom scheduling tightened during review:** The first drawer allowed inline custom inputs under the preset list. The final version mirrors the reminder sheet more closely with a separate custom mode, back button, and larger native inputs.
- **Paused edit state fixed during self-review:** Save/cancel originally resumed paused messages. The final backend restores the previous scheduled/paused state.

## Schema Changes

- Adds `scheduled_messages` with lifecycle status, `scheduled_at`, composer content JSON/markdown, attachment ids, queue linkage, sent-message linkage, edit previous status, optimistic version, and lifecycle timestamps.
- Adds indexes for active user lists, pending worker scans, queue lookup, and client-message idempotency within a workspace/stream.

## What's NOT Included

- No migration execution was run locally; no obvious local DB migration script was available in this checkout.
- No end-to-end browser flow was completed against a live authenticated workspace in this environment.
- No push notification or activity event is emitted when a scheduled message sends beyond the normal message-created behavior.
- No recurring scheduled messages or multi-recipient scheduled sends are included.

## Status

- [x] Backend persistence, API, outbox, and worker flow implemented.
- [x] Composer schedule action implemented for desktop and mobile.
- [x] Scheduled explorer implemented with edit, pause/resume, send-now, delete, and sent-message navigation.
- [x] Edit locking and version guards added for race-sensitive operations.
- [x] Focused frontend tests added/updated.
- [x] Full monorepo typecheck run.
