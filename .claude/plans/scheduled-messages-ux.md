# Scheduled Messages — Implementation Plan

## Goal

Add end-to-end scheduled message support. A user composes a message in the normal composer, then taps a clock icon to schedule it for later instead of sending immediately. Scheduled messages can be browsed in a sidebar explorer, and individually deleted, paused, edited, or sent-now. The implementation reuses the existing queue-based scheduling pattern from the saved-message reminder system and the stashed-drafts picker UX pattern for the composer trigger.

## What Was Built

### Backend — Scheduled Messages Feature

Full CRUD with race-safe scheduling, pause/resume lifecycle, and queue-based fire execution.

**Core principles:**
- "Send now" updates `scheduledAt` to `now` — never sidesteps the scheduler, eliminating double-send risk
- Pause is the synchronization primitive for editing — fire worker skips paused rows
- Content edits auto-resume (clear paused state on save)
- Outbox events on created/updated/cancelled/fired for real-time sync

**Files:**
- `apps/backend/src/db/migrations/20260430160000_scheduled_messages.sql` — table with `paused_at`, `message_id`, partial indexes for pending queries
- `apps/backend/src/features/scheduled-messages/service.ts` — `schedule`, `update`, `cancel`, `pause`, `resume`, `listByUser`, `fire` with single-tx `scheduleAndSendNow`
- `apps/backend/src/features/scheduled-messages/repository.ts` — data access with race guards (`WHERE sent_at IS NULL AND cancelled_at IS NULL`)
- `apps/backend/src/features/scheduled-messages/handlers.ts` — Zod-validated endpoints + pause/resume/send-now
- `apps/backend/src/features/scheduled-messages/worker.ts` — LIGHT-tier queue worker delegates to `fire()`
- `apps/backend/src/features/scheduled-messages/view.ts` — resolves `streamDisplayName` and `messageId` for sent messages
- `apps/backend/src/lib/queue/job-queue.ts` — `SCHEDULED_MESSAGE_FIRE` job queue
- `apps/backend/src/lib/outbox/repository.ts` — `scheduled_message:created/updated/cancelled/fired` events
- `apps/backend/src/routes.ts` — 8 endpoints (schedule, list, update, cancel, pause, resume, send-now)
- `packages/backend-common/src/id.ts` — `scheduledMessageId()` with `sched_` prefix
- `packages/types/src/api.ts` — `ScheduledMessageView`, `ScheduleMessageInput`, `UpdateScheduledMessageInput`, socket payload types

### Frontend — Composer Integration

The clock icon sits left of the stashed-drafts trigger in the composer bottom bar. Desktop uses a chevron popover; mobile uses a long-press sheet.

**Editing mode:** When a user taps "Edit" on a scheduled item, the composer fills with the content, the send button becomes a floppy disk (Save), and Enter/Cmd+Enter saves instead of sending. A subtle banner shows "Editing scheduled message — sends paused until you save."

**Race handling:** Before editing, the message is paused via API. If the message fires within 30 s, the pause is awaited (with a spinner). If more than 30 s away, pause fires in the background with up to 3 retries (sonner on failure).

**Files:**
- `apps/frontend/src/components/composer/message-composer.tsx` — `isEditingScheduled` prop: Save icon, editing hint, hide long-press
- `apps/frontend/src/components/composer/scheduled-picker.tsx` — Clock trigger + popover with inline preset list and desktop action menu
- `apps/frontend/src/components/composer/scheduled-message-drawer.tsx` — Mobile/desktop drawer with actions (send now, edit, change time, pause/resume, delete) and composer-based edit flow
- `apps/frontend/src/components/composer/schedule-sheet.tsx` — Desktop Dialog / Mobile Drawer with preset list + custom date/time
- `apps/frontend/src/components/composer/schedule-ui.tsx` — Shared `SchedulePresetList` and `ScheduledActionsList` with pause/resume support
- `apps/frontend/src/components/timeline/message-input.tsx` — `startEditScheduled`, `handleSaveScheduled`, `cancelEditScheduled` with 30 s pause-await threshold
- `apps/frontend/src/lib/schedule-presets.ts` — Timezone-aware preset math: 15m, 1h, 3h, tomorrow 9am, next Monday 9am

### Frontend — Sidebar + Explorer

**Files:**
- `apps/frontend/src/components/layout/sidebar/quick-links.tsx` — "Scheduled" link with pending count between "Saved" and "Threads"
- `apps/frontend/src/pages/scheduled.tsx` — Explorer page: sorts by status (pending first), shows status badges (Sent/Cancelled/Paused), actions (edit/pause/resume/send-now/delete), links to sent messages
- `apps/frontend/src/components/scheduled/scheduled-item.tsx` — Row component with preview, stream name, relative time, status badge, action buttons, ExternalLink to fired message
- `apps/frontend/src/components/scheduled/scheduled-empty.tsx` + `scheduled-skeleton.tsx` — Loading and empty states
- `apps/frontend/src/routes/index.tsx` — `scheduled` route registered

### Frontend — State Layer

**Files:**
- `apps/frontend/src/db/database.ts` — `CachedScheduledMessage` (IDB v27) with `pausedAt`, `messageId`
- `apps/frontend/src/hooks/use-scheduled.ts` — `useScheduledList`, `useScheduleMessage`, `useUpdateScheduled`, `useCancelScheduled`, `useSendNowScheduled`, `usePauseScheduled`, `useResumeScheduled`
- `apps/frontend/src/api/scheduled-messages.ts` — API client: schedule, list, update, cancel, sendNow, pause, resume
- `apps/frontend/src/sync/workspace-sync.ts` — Socket handlers for created/updated/cancelled/fired with query invalidation

## Design Decisions

### Pause as synchronization primitive
**Chose:** Add `paused_at` column + pause/resume API endpoints. Fire worker checks `paused_at IS NULL` before processing.
**Why:** User explicitly requested pause (hold until further notice). Pause is safer than cancel+recreate for editing because it preserves the original schedule time. The fire worker's `WHERE` clause on `paused_at` prevents races between edit-pause and fire execution.
**Alternatives considered:** Cancel + re-schedule (loses original schedule time), far-future `scheduled_at` hack (confusing UX).

### Send-now via `scheduledAt = now`
**Chose:** `update()` detects clamped `scheduledAt <= now` and calls `fire()` directly instead of queuing. The `schedule()` handler also fast-tracks past `scheduledAt`.
**Why:** Eliminates double-send risk. `clientMessageId = "scheduled:{id}"` provides idempotency if the API call is retried. The scheduler is never bypassed — it just fast-tracks.

### Composer-based editing
**Chose:** Reuse the normal composer with a `isEditingScheduled` prop. Button icon changes from ArrowUp to Save. Submit calls `updateScheduled` instead of `sendMessage`.
**Why:** Consistent UX — same editor, same attachments, same keyboard shortcuts. No modal or separate editor. The user doesn't context-switch.

### 30 s pause threshold for editing
**Chose:** If `msUntilFire < 30000`, await the pause API before loading into composer. If >= 30000 ms, fire pause in background with retry (sonner on 3+ failures).
**Why:** Prevents the old version from sending while the user edits. Close messages can't afford the race window of background-pause, so we synchronize. Distant messages prioritize UX snappiness.

## Design Evolution

- **Pause/resume:** Original PR had no pause concept — editing used a 24h forward-shift hack on `scheduledAt`. User explicitly requested pause/resume as a first-class lifecycle state.
- **ID prefix:** Changed from `schm_` to `sched_` during merge resolution.
- **`messageId` tracking:** Added `message_id` column so sent messages can link to their real message in the explorer.

## Schema Changes

- `apps/backend/src/db/migrations/20260430160000_scheduled_messages.sql` — New table `scheduled_messages` with `paused_at`, `message_id` columns. Four indexes including two partial indexes for pending-only queries.

## What's NOT Included

- Recurring scheduled messages (one-time only)
- Push notifications for scheduled message fire (already handled by the existing message push notification system)
- Scheduled message attachments preview in the explorer (shows attachment count only)
- Thread creation for `parentMessageId` without existing thread (falls through to parent stream)

## Status

- [x] Backend: scheduled_messages table + CRUD API with pause/resume
- [x] Backend: scheduled_message.fire queue worker (LIGHT tier) with paused_at guard
- [x] Backend: user-scoped outbox events for created/updated/cancelled/fired
- [x] Frontend: IDB v27 scheduledMessages table with bootstrap + socket sync
- [x] Frontend: useScheduledList, useScheduleMessage, useUpdateScheduled, useCancelScheduled, usePauseScheduled, useResumeScheduled, useSendNowScheduled hooks
- [x] Frontend: /w/:workspaceId/scheduled page with status badges, actions, and sent-message links
- [x] Frontend: Composer clock icon (left of stashed drafts) + schedule picker (desktop popover, mobile sheet)
- [x] Frontend: Composer editing mode (Save icon, editing banner, composer-based save)
- [x] Frontend: Edit race handling (30 s pause threshold, background retry with sonner)
- [x] Frontend: Sidebar quick-link with pending count
- [x] Frontend: shared schedule-presets.ts (timezone-aware, DST-safe)
- [x] Frontend: Desktop/mobile unified UX (Dialog/Drawer adapts, same component internals)
