# Scheduled Messages — Implementation Plan

## Overview

Add end-to-end scheduled message support. A user composes a message in the normal composer, then taps a clock icon to schedule it for later instead of sending immediately. Scheduled messages can be browsed in a sidebar explorer, and individually deleted, paused, edited, or sent-now.

The backend reuse the existing queue-based scheduling pattern from the saved-message reminder system. The frontend reuses the stashed-drafts picker UX pattern for the composer trigger, and adds a new explorer page modeled after Saved/Activity.

## Requirements Checklist

- [ ] Composer: clock icon left of stashed-drafts trigger in the bottom toolbar
- [ ] Composer: unified schedule picker for desktop (popover) and mobile (sheet)
- [ ] Sidebar: "Scheduled" quick-link with pending count
- [ ] Explorer page: `/w/:workspaceId/scheduled` with grouped list
- [ ] Explorer actions: delete, pause/resume, send-now, edit
- [ ] Send-now: fast-track via `scheduled_at = now()` — do not sidestep the scheduler
- [ ] Editing: load into composer, submit button becomes save (floppy-disk), Enter/Cmd+Enter saves
- [ ] Race-safe editing: temporarily pause before editing; only await pause if within 30 s of fire
- [ ] Sent messages link to their real message once fired
- [ ] Consistent desktop + mobile UX

---

## Stage 1 — Backend Foundation

### 1.1 Database migration

`apps/backend/src/db/migrations/20260502000000_scheduled_messages.sql`

```sql
CREATE TABLE scheduled_messages (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL,
  author_id          TEXT NOT NULL,
  stream_id          TEXT,
  parent_message_id  TEXT,
  parent_stream_id   TEXT,
  content_json       JSONB NOT NULL,
  content_markdown   TEXT NOT NULL,
  attachment_ids     TEXT[] NOT NULL DEFAULT '{}',
  scheduled_at       TIMESTAMPTZ NOT NULL,
  sent_at            TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sm_workspace ON scheduled_messages (workspace_id);
CREATE INDEX idx_sm_workspace_scheduled ON scheduled_messages (workspace_id, scheduled_at);
CREATE INDEX idx_sm_workspace_stream ON scheduled_messages (workspace_id, stream_id);
CREATE INDEX idx_sm_workspace_author_pending_scheduled
  ON scheduled_messages (workspace_id, author_id, scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX idx_sm_workspace_author_stream_pending_scheduled
  ON scheduled_messages (workspace_id, author_id, stream_id, scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;
```

### 1.2 Types (`packages/types/src/api.ts`)

Add:

```ts
export interface ScheduledMessageView {
  id: string
  workspaceId: string
  authorId: string
  streamId: string | null
  parentMessageId: string | null
  parentStreamId: string | null
  contentJson: JSONContent
  contentMarkdown: string
  attachmentIds: string[]
  scheduledAt: string
  sentAt: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  streamDisplayName: string | null
}

export interface ScheduleMessageInput {
  streamId?: string
  parentMessageId?: string
  parentStreamId?: string
  contentJson: JSONContent
  contentMarkdown: string
  attachmentIds?: string[]
  scheduledAt: string
}

export interface UpdateScheduledMessageInput {
  contentJson?: JSONContent
  contentMarkdown?: string
  attachmentIds?: string[]
  scheduledAt?: string
}

export interface ScheduledMessageListResponse {
  scheduled: ScheduledMessageView[]
}

export interface ScheduledMessageCreatedPayload {
  workspaceId: string
  scheduled: ScheduledMessageView
}

export interface ScheduledMessageUpdatedPayload {
  workspaceId: string
  scheduled: ScheduledMessageView
}

export interface ScheduledMessageCancelledPayload {
  workspaceId: string
  scheduledId: string
}

export interface ScheduledMessageFiredPayload {
  workspaceId: string
  scheduledId: string
}
```

Export from `packages/types/src/index.ts`.

### 1.3 ID helper

`packages/backend-common/src/id.ts`: add `scheduledMessageId`.
`apps/backend/src/lib/id.ts`: re-export `scheduledMessageId` + add `queueId` if not present.

### 1.4 Repository (`apps/backend/src/features/scheduled-messages/repository.ts`)

- `insert(db, params)` → `ScheduledMessage`
- `findById(db, workspaceId, authorId, id)` → `ScheduledMessage | null`
- `findByIdUnscoped(db, id)` → `ScheduledMessage | null`
- `findPendingByUser(db, workspaceId, authorId, opts?)` → `ScheduledMessage[]`
- `updateContent(db, workspaceId, authorId, id, fields)` → `ScheduledMessage | null`
- `updateScheduledAt(db, workspaceId, authorId, id, scheduledAt)` → `ScheduledMessage | null`
- `markSent(db, workspaceId, id, sentAt)` → `ScheduledMessage | null`  (workspace-scoped)
- `markCancelled(db, workspaceId, authorId, id)` → `ScheduledMessage | null`
- `delete(db, workspaceId, authorId, id)` → `boolean`

All mutations guard against sending an already-sent or already-cancelled row.

### 1.5 View resolver (`apps/backend/src/features/scheduled-messages/view.ts`)

`resolveScheduledView(db, authorId, rows)` → `ScheduledMessageView[]`.
Resolves `streamDisplayName` from the stream table (or null if stream missing / no streamId).

### 1.6 Service (`apps/backend/src/features/scheduled-messages/service.ts`)

`ScheduledMessagesService` with methods:

- `schedule(params)` → `{ view: ScheduledMessageView; sentNow: boolean }`
  - Clamp `scheduledAt` to now if in the past.
  - If clamped ≤ now → `scheduleAndSendNow` (insert row, call `eventService.createMessage` with `clientMessageId = scheduled:${row.id}`, mark sent, emit `created` + `fired`).
  - If future → insert row, enqueue fire job, emit `created`.
- `update(params)` → `ScheduledMessageView`
  - If `scheduledAt` is set to now or past → apply content changes first, then `fire()`.
  - Otherwise → update content and/or scheduledAt, cancel old queue job, enqueue new one, emit `updated`.
- `cancel(params)` → void
  - Guard: row must exist and not be sent/cancelled.
  - Mark cancelled, cancel queue job, emit `cancelled`.
- `fire(params)` → void  (called by worker)
  - Lookup row, resolve target stream, call `eventService.createMessage` with `clientMessageId = scheduled:${row.id}`, mark sent idempotently, emit `fired`.
  - If already sent or cancelled → no-op.
- `list(params)` → `ScheduledMessageView[]`
  - Author-scoped list of all scheduled messages for the workspace.

Race handling:
- `markSent` uses `WHERE sent_at IS NULL AND cancelled_at IS NULL RETURNING …` so concurrent fires are idempotent.
- Worker uses `clientMessageId` for idempotency in `eventService.createMessage`.
- Content updates require the row to be pending; if a fire happens between read and update, the update fails with 409.

### 1.7 Handlers (`apps/backend/src/features/scheduled-messages/handlers.ts`)

Zod schemas:
- `scheduleSchema`: requires at least one of `streamId`, `parentMessageId`, `parentStreamId`; validates `contentJson` via `contentJsonSchema` from messaging handlers; `scheduledAt` ISO datetime.
- `updateSchema`: optional `contentJson` (validated), `contentMarkdown`, `attachmentIds`, `scheduledAt`.

Routes (all under `...authed` + workspace-user middleware):
- `POST /api/workspaces/:workspaceId/scheduled-messages` — `rateLimits.messageCreate`
- `GET /api/workspaces/:workspaceId/scheduled-messages`
- `PATCH /api/workspaces/:workspaceId/scheduled-messages/:scheduledId`
- `DELETE /api/workspaces/:workspaceId/scheduled-messages/:scheduledId`
- `POST /api/workspaces/:workspaceId/scheduled-messages/:scheduledId/send-now`

### 1.8 Worker (`apps/backend/src/features/scheduled-messages/worker.ts`)

`createScheduledMessageFireWorker(deps)` → `JobHandler<ScheduledMessageFireJobData>`.
Calls `scheduledMessagesService.fire({ scheduledId })`.
Tier: `LIGHT`.

### 1.9 Queue job type

`apps/backend/src/lib/queue/job-queue.ts`:
- Add `SCHEDULED_MESSAGE_FIRE: "scheduled_message.fire"`
- Add `ScheduledMessageFireJobData` interface
- Add to `JobDataMap`

### 1.10 Outbox events

`apps/backend/src/lib/outbox/repository.ts`:
- Add `scheduled_message:created`, `updated`, `cancelled`, `fired` to `OutboxEventType`
- Add payload interfaces and map entries
- Add to `UserScopedEventType` list

### 1.11 Routes & server wiring

`apps/backend/src/routes.ts`:
- Import `createScheduledMessagesHandlers`
- Add `scheduledMessagesService` to `Dependencies`
- Register endpoints

`apps/backend/src/server.ts`:
- Construct `ScheduledMessagesService`
- Register worker with `jobQueue.registerHandler(JobQueues.SCHEDULED_MESSAGE_FIRE, …)`

---

## Stage 2 — Frontend Foundation

### 2.1 API client (`apps/frontend/src/api/scheduled-messages.ts`)

```ts
schedule(workspaceId, input)
list(workspaceId)
update(workspaceId, scheduledId, input)
cancel(workspaceId, scheduledId)
sendNow(workspaceId, scheduledId)
```

Export from `apps/frontend/src/api/index.ts`.

### 2.2 IDB schema v27 (`apps/frontend/src/db/database.ts`)

Add `CachedScheduledMessage`:

```ts
export interface CachedScheduledMessage extends ScheduledMessageView {
  _status: "pending-sync" | "synced"
  _scheduledAtMs: number
  _cachedAt: number
}
```

Add table:
```ts
scheduledMessages: "id, workspaceId, [workspaceId+streamId], _scheduledAtMs, _cachedAt"
```

Add to `clearAllCachedData()`.

### 2.3 Hooks (`apps/frontend/src/hooks/use-scheduled.ts`)

- `scheduledKeys` — TanStack Query keys
- `persistScheduledRows(rows)` — normalize `contentJson` and bulkPut
- `removeScheduledRow(id)`
- `useScheduledBootstrap(workspaceId)` — subscribe-then-fetch (INV-53)
- `useScheduledList(workspaceId, streamId?)` — live IDB query via `useLiveQuery`
- `useScheduleMessage(workspaceId)` — mutation with optimistic IDB write
- `useUpdateScheduled(workspaceId)` — mutation
- `useCancelScheduled(workspaceId)` — mutation with optimistic delete + rollback
- `useSendNowScheduled(workspaceId)` — mutation

### 2.4 Socket sync (`apps/frontend/src/sync/workspace-sync.ts`)

Register handlers for:
- `scheduled_message:created` → persist row, invalidate list
- `scheduled_message:updated` → persist row
- `scheduled_message:cancelled` → remove row
- `scheduled_message:fired` → remove row (or mark as sent — the explorer needs to show sent messages, so we actually persist with `sentAt` set and let the bootstrap backfill the full view)

On reconnect/resubscribe: invalidate `scheduledKeys.list(workspaceId)`.

---

## Stage 3 — Composer Integration

### 3.1 Schedule presets (`apps/frontend/src/lib/schedule-presets.ts`)

Extract timezone-aware preset math from `reminder-presets.ts` into a shared module:

```ts
export type SchedulePreset =
  | { label: string; kind: "duration"; minutes: number }
  | { label: string; kind: "calendar"; calendar: "tomorrow-9am" | "next-monday-9am" }

export const SCHEDULE_PRESETS: SchedulePreset[] = …
export function computeScheduledAt(preset, now, timezone): Date
```

Keep `reminder-presets.ts` re-exporting aliases for backward compatibility.

### 3.2 Schedule picker components

Build **one** unified picker that adapts its container:

- Desktop: `Popover` inside the composer toolbar
- Mobile: `Sheet` triggered from the action bar

The picker shows:
- Preset grid (15 min, 1 hr, 3 hr, Tomorrow 9am, Next Monday 9am)
- Custom date + time inputs
- "Schedule" primary action (disabled if no content or past date)

`apps/frontend/src/components/composer/schedule-picker.tsx` — shared preset grid + custom inputs.
`apps/frontend/src/components/composer/schedule-popover.tsx` — desktop wrapper.
`apps/frontend/src/components/composer/schedule-sheet.tsx` — mobile wrapper.

### 3.3 Composer wiring (`apps/frontend/src/components/composer/message-composer.tsx`)

Add props:
- `onSchedule?: (scheduledAt: Date) => void`
- `scheduledPickerTrigger?: ReactNode`
- `scheduledPickerTriggerFab?: ReactNode`

In the bottom toolbar (desktop inline) place the clock icon **left of** the stashed-drafts trigger.
In the mobile action bar place it left of the stashed-drafts trigger as well.
In the expanded-mode FAB drawer place it left of the stashed-drafts trigger.

Clock icon: `Clock` from lucide. Disabled when `!canSubmit`. Tooltip "Schedule message".

### 3.4 Timeline wiring (`apps/frontend/src/components/timeline/message-input.tsx`)

- Import `useScheduleMessage`
- Build schedule payload from current composer content + attachments
- Call `scheduleMessage.mutate()` on picker confirm
- On success: clear composer, show toast "Message scheduled for …"
- On error: show toast with error, keep composer content

---

## Stage 4 — Sidebar + Scheduled Explorer

### 4.1 Sidebar quick-link

`apps/frontend/src/components/layout/sidebar/quick-links.tsx`:
- Add "Scheduled" link between "Drafts" and "Saved" (or after "Saved")
- Icon: `Clock`
- Count: pending (not sent, not cancelled) scheduled messages — read from IDB count query or hook
- Use `useLiveQuery` for synchronous badge

### 4.2 Route

`apps/frontend/src/routes/index.tsx`:
- Add `path: "scheduled"` → `ScheduledPage`

### 4.3 Scheduled page

`apps/frontend/src/pages/scheduled.tsx`:

- Header: "Scheduled Messages"
- List grouped by date (Today, Tomorrow, Later) using `_scheduledAtMs`
- Each row shows:
  - Preview text (strip markdown, truncate)
  - Target stream name (or "DM / Thread" context)
  - Scheduled time (relative + absolute)
  - Status badge: pending, paused, sent, cancelled
- Actions per row (desktop: hover buttons; mobile: long-press drawer):
  - **Send now** → `sendNow.mutate()`
  - **Edit** → navigate to stream + load into composer editing mode
  - **Pause / Resume** → `updateScheduled.mutate({ scheduledAt: null })` (pause = far-future or special flag?)
  - **Delete** → `cancel.mutate()`

Wait — the user asked for "pause (e.g., hold until further notice)". The PR didn't have a dedicated pause flag; it used cancelling. But the user explicitly wants pause/resume. We need a `paused` state.

Decision: add `paused_at TIMESTAMPTZ` to the migration. Pause sets `paused_at = now()`; resume clears it. The fire worker skips paused rows. The list shows "Paused" badge.

Migration amendment:
```sql
ALTER TABLE scheduled_messages ADD COLUMN paused_at TIMESTAMPTZ;
CREATE INDEX idx_sm_workspace_author_pending_scheduled
  ON scheduled_messages (workspace_id, author_id, scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL AND paused_at IS NULL;
```

Service methods:
- `pause({ workspaceId, authorId, scheduledId })` → set `paused_at = now()`, cancel queue job, emit `updated`
- `resume({ workspaceId, authorId, scheduledId })` → clear `paused_at`, enqueue fire job, emit `updated`

Handler: `POST /api/workspaces/:workspaceId/scheduled-messages/:scheduledId/pause` and `/resume`.

Update all queries to treat `paused_at IS NOT NULL` as not pending for fire purposes.

### 4.4 Components

`apps/frontend/src/components/scheduled/scheduled-item.tsx`:
- Preview text, stream name, scheduled time, status badge
- Hover actions (desktop) / long-press drawer (mobile)

`apps/frontend/src/components/scheduled/scheduled-empty.tsx`:
- Empty state illustration + copy

`apps/frontend/src/components/scheduled/scheduled-skeleton.tsx`:
- Skeleton rows for loading

---

## Stage 5 — Edit Flow with Race Handling

### 5.1 Edit initiation

When user taps "Edit" on a scheduled item:
1. Compute `msUntilFire = scheduledAt - now`
2. If `msUntilFire < 30000`:
   - Show "Preparing to edit…" spinner
   - Await `pause()` network call
   - On success → load into composer
   - On failure → show toast "Could not pause message — too close to send time"
3. If `msUntilFire >= 30000`:
   - Fire `pause()` in background (don't await)
   - Immediately load into composer
   - If pause fails 3+ times → show sonner "Failed to pause scheduled message. It may still send."
   - Track failure count per editing session

### 5.2 Composer editing mode

Add state to `MessageInput`:
- `editingScheduledId?: string`
- `editingScheduledOriginal?: ScheduledMessageView`

Pass to `MessageComposer`:
- `isEditingScheduled?: boolean`
- When true:
  - Submit button icon changes from `ArrowUp` to `Save` (floppy disk)
  - Tooltip changes to "Save changes"
  - Enter / Cmd+Enter saves instead of sends
  - Show a subtle banner: "Editing scheduled message — sends paused until you save"

In `MessageComposer`:
- `onSubmit` is reused; the parent (`MessageInput`) decides whether to call `sendMessage` or `updateScheduled`

### 5.3 Save edited scheduled message

`MessageInput.handleSaveScheduled`:
1. Call `updateScheduled.mutate({ id: editingScheduledId, input: { contentJson, contentMarkdown, attachmentIds, scheduledAt: original.scheduledAt } })`
2. If the user changed the scheduled time, include the new time
3. On success: clear editing state, restore normal composer, show toast
4. On error: show inline error, keep editing mode

The service's `update` will clear `paused_at` automatically (resume on save).

### 5.4 Race condition safety

- The `pause` API sets `paused_at` in the DB. The fire worker's SELECT includes `AND paused_at IS NULL`.
- If a fire job claims a row just as pause is being called, the fire's `markSent` will fail (row no longer matches `sent_at IS NULL AND cancelled_at IS NULL AND paused_at IS NULL`), and the worker no-ops.
- If edit is abandoned (user navigates away), the message stays paused. We should probably auto-resume on unmount if no changes were made. Track `hasChanges` — if false on unmount, fire background resume.

---

## Stage 6 — Self-Review Checklist (per stage)

After each stage, verify:
- [ ] TypeScript compiles (`bun run typecheck` or `bunx tsc --noEmit`)
- [ ] No `any` types introduced
- [ ] Backend follows INV-1, INV-2, INV-3, INV-8, INV-20, INV-51
- [ ] Frontend uses Shadcn primitives (INV-14)
- [ ] No layout-shift in tooltips/popovers (INV-21)
- [ ] Navigation uses `<Link>`; actions use `<button>` (INV-40)
- [ ] Dates formatted with `formatDate` from `lib/temporal.ts` (INV-42)
- [ ] Socket bootstrap invalidates on reconnect (INV-53)
- [ ] Multi-view page uses URL segments, not state (INV-59)
- [ ] Preview text strips markdown (INV-60)

---

## Stage 7 — Final Review & PR

- Run full test suite: `bun run test`
- Run E2E if applicable: `bun run test:e2e`
- Review for dead code, unused imports, console.logs
- Ensure plan file is committed
- Create PR with description matching the feature scope

---

## Open Questions (resolved)

1. **Pause vs Cancel** — The user wants pause/resume. We'll add `paused_at` column and dedicated pause/resume endpoints.
2. **Sent messages in explorer** — The list should include sent messages that link to the real message. The `ScheduledMessageView` already has `sentAt`; when `sentAt` is set, the row stays in the list (via bootstrap) and links to the stream/message.
3. **Mobile UX** — Use Sheet for picker and row actions; keep the same component internals.
4. **Race handling** — Pause is the synchronization primitive. Fire worker skips paused rows. Mark-sent is conditional.
5. **Editing UX** — Reuse the normal composer. Button icon changes. Submit action changes. No modal or separate editor.
