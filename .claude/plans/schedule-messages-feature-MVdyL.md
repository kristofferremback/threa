# Scheduled Messages

## Goal

Allow users to schedule messages to be sent at a future time. Reuse:

- The cron + queue infrastructure already powering saved-message reminders (`ScheduleManager` + `QueueManager` + `queue_messages` rows).
- The reminder time/duration picker UX (presets `15m / 30m / 1h / Tomorrow 9am / Next Monday 9am`, plus custom `<input type="datetime-local">`).
- The drafts-popover pattern from `StashedDraftsPicker` for an in-composer "what's queued for this stream" peek.
- The saved-messages full-page tabbed list (URL-driven per INV-59) for the manage-everything surface.
- The existing message send pipeline (`EventService.createMessage`) so a fired scheduled message enters the system identically to a live send.
- The offline-first stack (Dexie write-through + `useLiveQuery` rendering + TanStack `staleTime: Infinity, refetchOnMount: true, refetchOnReconnect: true` + `pendingOperations` queue).
- The subscribe-then-bootstrap pattern for socket/IDB sync (INV-53).

## UX — User Journeys

### Journey 1 — Schedule from the stream composer (the 80% case)

1. User types in the stream composer; existing draft autosave runs as usual.
2. User clicks the calendar icon adjacent to the send button (or "Schedule send" from the send-button caret).
3. A popover anchored to the send button opens: preset chips reused from `reminder-presets.ts`, plus "Pick a time…" toggle revealing inline `<input type="datetime-local">`.
4. User picks `1h` → popover commits, the existing send pipeline runs (`materializePendingAttachmentReferences()` → POST `/scheduled` instead of `/messages`).
5. Composer clears, draft purged, attachments transfer ownership to the scheduled row. Toast: `"Scheduled for 14:30"` with `Undo` (5s).
6. The composer's scheduled-icon shows a count badge driven by a tiny `useLiveQuery` count — instant.

### Journey 2 — Glance at upcoming sends from the composer

1. User clicks the scheduled-messages popover trigger in the composer bar (sibling of `StashedDraftsPicker`).
2. Popover lists this stream's pending scheduled messages, ordered by `scheduledFor` ASC. Each row: stripped-markdown preview (INV-60), `formatFutureTime` terse label (`5m`, `Tomorrow 9:00`), attachment count.
3. Hover row → quick actions: edit, reschedule (time-only), cancel.
4. Row body click → opens the in-stream edit flow (Journey 4).
5. Footer: `View all scheduled →` navigates to `/w/:wsId/scheduled`.
6. Keyboard navigation (arrows + enter) mirrors the drafts picker.

### Journey 3 — Scheduled messages page

Routes (URL-driven per INV-59):

- `/w/:wsId/scheduled` — "To send" tab (default).
- `/w/:wsId/scheduled/sent` — "Sent" tab.

Tab structure mirrors `pages/saved.tsx`: `<Tabs>` with `<TabsTrigger asChild><Link>` so cmd-click works (INV-40).

**To send tab:**
- Day-grouped (Today / Tomorrow / Wed Apr 23 / …).
- Each row: stream chip, stripped-markdown preview, `formatFutureTime` terse label, attachment chips, action cluster (Edit / Reschedule / Cancel / Send now).
- Empty state: friendly explainer ("Schedule a message from any composer to populate this list").
- Failed rows render inline with red left border + status pill + contextual primary action (`Copy to draft`, `Review & resend`, `Send now`). No separate Failures tab.

**Sent tab:**
- Rows: stream chip + preview + sent-at relative.
- Click → navigate to `/w/:wsId/s/:streamId` and scroll/highlight the live `sentMessageId` (existing message-deeplink mechanism).
- No edit affordance; the message is now a normal message and uses normal stream message UX.

### Journey 4 — Edit in stream context (in-line composer)

Triggered by clicking a row in the composer popover, or "Edit" from anywhere in stream view.

**Async path (`>` claim threshold; the common case):**
1. Composer flips into edit mode immediately — prefilled from the IDB row, no spinner, no flash.
2. `POST /scheduled/:id/claim` fires silently in the background. On rare failure (cross-device contention, status changed), non-blocking toast + revert.
3. Banner above composer: `"Editing scheduled message — Cancel edit"`.
4. Existing draft for this stream is parked in IDB and restored when edit mode exits.

**Sync path (`≤` threshold; about-to-fire):**
1. Click is acknowledged via the button's pressed/disabled state (no spinner glyph yet).
2. `POST /scheduled/:id/claim` fires immediately. Server attempts CAS within ≤300ms.
3. If claim resolves <300ms: button never displays a loading spinner — composer expands directly.
4. If claim takes ≥300ms: a discreet inline spinner appears on the button (and only then) until resolution.
5. If claim succeeds: same edit mode as async path.
6. If denied (status `sending`/`sent`): inline `"Already sending — opening live message"` + auto-navigate when the upsert event arrives.

**Banner copy in both paths:** `"Editing scheduled message — Cancel edit"`. No countdown timer; we use `formatFutureTime` terse format if a time label is shown, but the banner itself is calm.

**Save:**
- `scheduledFor > now` → PATCH, lock released, worker resumes its tick. Button label: `Save`.
- `scheduledFor ≤ now` → PATCH atomically performs the send. Button label: `Send`. Secondary action label flips to `Send unchanged`. Banner: `"Scheduled time has passed — this message will be sent as soon as you finish editing."`

**Cancel edit:**
- `scheduledFor > now` → release lock, restore parked draft. Worker fires at planned time.
- `scheduledFor ≤ now` → confirmation if there are unsaved edits (`"The original will be sent. Discard your edits?"`); on confirm, release lock; worker fires immediately.

### Journey 5 — Edit on the page (modal)

Identical lock semantics to Journey 4, in a Dialog.

- Dialog hosts the full `MessageComposer` (attachments, mentions, slash-commands).
- Schedule-time field above the composer with the same picker.
- Sync path: dialog opens already in claim-pending state; the 300ms wait happens within the open dialog (no double transition).
- Async path: dialog opens with editor fully interactive immediately.
- Save / Cancel edit semantics match Journey 4.

### Journey 6 — Reschedule

A reschedule is just an edit where only `scheduledFor` changes. Two affordances:

- **Quick reschedule** from row caret menu / popover hover: opens just the time picker, same lock dance.
- **Within an open edit modal/composer**: the time field is part of the editor; saving applies content + time atomically.

Backend cancels the old `queue_messages` row and inserts a new one in the same tx as the `scheduled_messages` update.

### Journey 7 — Cancel

1. User clicks Cancel.
2. Optimistic IDB removal (row vanishes).
3. DELETE fires; on success no further work.
4. On 409 (`sending`/`sent`): restore row, refetch, surface `"Too late to cancel — message already sent"`.
5. Toast carries `Undo` for ~5s; only valid if `scheduledFor > now`.

### Journey 8 — Send now

Kept (per user decision).

- Sets `scheduledFor = now()` server-side and immediately requeues at the front of the queue, identical fire path as a cron tick.
- Disabled when row is `sending` to prevent double-send footguns; the disabled state arrives via socket `upserted` event.

### Journey 9 — The sent moment

When the worker fires:
1. Server inserts the live message via `EventService.createMessage()` → `message:created` outbox event flows through the normal pipeline (real-time delivery to all stream members, push notifications, activity feed).
2. Server emits `scheduled_message:sent` with `sentMessageId`.
3. Author's clients: row moves "to send" → "Sent" tab; per-stream popover removes the row.
4. Quiet in-app toast for the author: `"Sent your scheduled message in #engineering · View"`. No push notification to self.
5. If the author had the edit dialog/composer open at the exact moment the worker won the CAS: dialog flips to read-only `"This message was just sent · View"`.

### Journey 10 — Failures

| Cause | UX (inline in "To send") |
|---|---|
| Stream deleted before send | Row → `failed`, banner: `"Couldn't send: stream removed"`. Action: `Copy to draft`. |
| Parent thread message deleted | Row → `failed`. Banner: `"Couldn't send: parent message removed"`. Action: `Copy to draft`. |
| Privacy warning needs re-confirmation | Row → `failed`. Action: `Review & resend` (opens edit modal with a privacy confirmation step). |
| Worker exhausted lock-defer retries | Row → `failed` ~30s past deadline. Action: `Send now`. |

Failures never silent (INV-11). Red left border + status pill in the To send tab.

### Journey 11 — Offline

1. Offline schedule → `onMutate` writes optimistic IDB row (temp id `sched_local_<ulid>`); operation enqueued in `pendingOperations`.
2. Composer popover and the page show the row with a small `"Queued — offline"` badge.
3. Reconnect → operation queue drains → server returns real row → socket `upserted` event arrives → frontend deletes temp row + writes real row in one Dexie tx.
4. If queued schedule's `scheduledFor` is past when we reconnect: server clamps to `now+5s` (small grace window); fires; frontend reconciles via `scheduled_message:sent`.

Edits and lock-claims **never** queue offline (synchronization primitives, not user data). Offline → editor refuses to open with `"Reconnect to edit"`.

### Journey 12 — Cross-device

- User edits on phone → desktop sees `scheduled_message:lock_changed` (optional event) → soft `"Editing on another device"` badge on the row.
- Desktop tries to edit while phone holds lock: 409 → `"Currently being edited on another device"`.

## Data Model

New table `scheduled_messages` (migration via `add-migration` skill).

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `sched_<ulid>` (INV-2) |
| `workspace_id` | TEXT | INV-8 |
| `user_id` | TEXT | author (INV-50) |
| `stream_id` | TEXT | |
| `parent_message_id` | TEXT NULL | thread reply support |
| `content_json` | JSONB | ProseMirror doc (INV-58) |
| `content_markdown` | TEXT | wire format |
| `attachment_ids` | TEXT[] | |
| `metadata` | JSONB | optional (parity w/ message create) |
| `scheduled_for` | TIMESTAMPTZ | |
| `status` | TEXT | `pending` / `sending` / `sent` / `cancelled` / `failed` (INV-3) |
| `sent_message_id` | TEXT NULL | populated on fire |
| `last_error` | TEXT NULL | failure reason |
| `queue_message_id` | BIGINT NULL | FK-style pointer (no enforced FK, INV-1) |
| `edit_lock_owner_id` | TEXT NULL | user id or `worker:<id>` |
| `edit_lock_expires_at` | TIMESTAMPTZ NULL | |
| `created_at`, `updated_at`, `status_changed_at` | TIMESTAMPTZ | |

Indexes:
- `(workspace_id, user_id, status, scheduled_for)` — "to send" tab and worker queries.
- `(workspace_id, user_id, status, status_changed_at DESC)` — "sent" tab pagination.
- `(workspace_id, stream_id, status, scheduled_for)` — composer popover filter.
- `(queue_message_id)` — cancel/reschedule paths.

No FKs (INV-1). All product data workspace-scoped (INV-8). Append-only migrations (INV-17).

## API Surface (Zod-validated, INV-55)

- `POST   /workspaces/:wsId/scheduled` — `{ streamId, parentMessageId?, contentJson, contentMarkdown?, attachmentIds[], scheduledFor, metadata?, clientMessageId? }`
- `GET    /workspaces/:wsId/scheduled?status=pending|sent&streamId?&limit&cursor`
- `GET    /workspaces/:wsId/scheduled/:id`
- `PATCH  /workspaces/:wsId/scheduled/:id` — content / scheduledFor / attachmentIds (one mutation kind per request, mirrors saved-messages convention; requires `lockToken`)
- `POST   /workspaces/:wsId/scheduled/:id/claim` → `{ lockToken, lockExpiresAt, threshold: { sync: boolean } }`
- `POST   /workspaces/:wsId/scheduled/:id/release` — explicit lock release (also `navigator.sendBeacon` on tab close)
- `POST   /workspaces/:wsId/scheduled/:id/heartbeat` — refresh lock TTL while editor open
- `POST   /workspaces/:wsId/scheduled/:id/send-now` — sets `scheduledFor = now()`, enqueues fire
- `DELETE /workspaces/:wsId/scheduled/:id` — cancel (tombstones queue row in same tx)

Errors via `HttpError` (INV-32). Response codes include `SCHEDULED_MESSAGE_ALREADY_SENDING`, `SCHEDULED_MESSAGE_LOCK_HELD`, `SCHEDULED_MESSAGE_LOCK_EXPIRED`, `SCHEDULED_MESSAGE_PARENT_UNAVAILABLE`.

## Backend — Send Pipeline

Feature folder: `apps/backend/src/features/scheduled-messages/` (INV-51) — handler / service / repository / outbox-handler / worker / config / tests.

**On create / reschedule** (in same tx, INV-7):
- Insert `queue_messages` row with `queue_name = "scheduled_message.send"`, `process_after = scheduled_for`. Store its id on `scheduled_messages.queue_message_id`.
- On reschedule: cancel old queue row + insert new one transactionally. Race covered by status check at fire time, like saved reminders.

**Worker `ScheduledMessageSendWorker`:**
1. Re-read row in tx; if `status != 'pending'` → no-op (idempotent).
2. Attempt CAS:
   ```sql
   UPDATE scheduled_messages
   SET edit_lock_owner_id = $worker_id,
       edit_lock_expires_at = NOW() + INTERVAL '10 seconds',
       status = 'sending'
   WHERE id = $1
     AND status = 'pending'
     AND (edit_lock_owner_id IS NULL OR edit_lock_expires_at < NOW())
   ```
3. If 0 rows updated → editor holds lock; nudge queue tick by 2s and exit. Bounded retries (~30s past deadline) before marking `failed` with `last_error = 'lock_contention_timeout'`.
4. If claimed → call `EventService.createMessage(...)` with stored payload (same code path as live send → outbox `message:created` flows automatically; INV-4, INV-7).
5. Mark `status='sent'`, set `sent_message_id`, clear lock — same tx as `scheduled_message:sent` outbox event.

Worker registered on `LIGHT` tier in `server.ts` (INV-34).

**On `PATCH` while past `scheduled_for`** (Save = Send semantics): handler performs the same `EventService.createMessage` step inside the PATCH transaction, plus the `scheduled_message:sent` event. Idempotent guards same as worker. The lock token in the PATCH ensures we still hold mutual exclusion against any worker tick that might happen to land in the same instant.

## Lock Semantics

Single CAS on `(edit_lock_owner_id, edit_lock_expires_at)` columns; never select-then-update (INV-20). Same primitive used by editor and worker; whoever wins the CAS owns the next 60s of the message's life.

**Threshold logic (server-side only):** the server computes `delta = scheduled_for - NOW()`. If `delta < SYNC_LOCK_THRESHOLD` (default 30s), `/claim` returns `threshold.sync = true`; the frontend uses this to decide whether to UI-block (sync path) or proceed optimistically (async path). The threshold is a *client reactivity policy*, never enforced on the server beyond the CAS itself — clock-skewed clients don't break correctness, only perceived latency.

**Editor lock TTL: 60s.** Editor heartbeats every ~30s while the modal/composer is open. Tab close / page nav fires explicit release via `navigator.sendBeacon` or `fetch({ keepalive: true })`.

**Worker lock TTL: 10s.** Just enough to perform the send + transition.

**Why 30s threshold:** `ScheduleManager` generates ticks 60s ahead, `QueueManager` polls ~100ms. By 30s, a tick is materialized in `cron_ticks` / `queue_messages` and very close to leasing.

**Why 300ms sync wait:** below human "instantaneous" perceptual ceiling (~200ms ideal, up to ~500ms acceptable). Enough for one CAS round-trip + small immediate retry on contention.

**Why async outside 30s:** worker is asleep; no contention; optimistic open is safe; rare failure is recoverable (revert + toast).

## Frontend Offline-First Stack

**Dexie schema bump** (`apps/frontend/src/db/database.ts`):

```ts
interface CachedScheduledMessage {
  id: string                       // sched_<ulid> (or sched_local_<ulid> while pending)
  workspaceId: string
  userId: string
  streamId: string
  parentMessageId: string | null
  contentJson: JSONContent
  contentMarkdown: string | null
  attachmentIds: string[]
  scheduledFor: string
  status: "pending" | "sending" | "sent" | "cancelled" | "failed"
  sentMessageId: string | null
  editLockOwnerId: string | null
  editLockExpiresAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
  statusChangedAt: string
  _scheduledForMs: number
  _statusChangedAtMs: number
  _cachedAt: number
}
```

Indexes:
- `[workspaceId+status+_scheduledForMs]` — "To send" tab (ASC).
- `[workspaceId+status+_statusChangedAtMs]` — "Sent" tab (DESC).
- `[workspaceId+streamId+status+_scheduledForMs]` — composer popover.
- `messageId` if we want a "this message was scheduled" surface (TBD; likely unnecessary).

Persistence helpers in `apps/frontend/src/db/scheduled-messages.ts`: `persistScheduledRows`, `removeScheduledRow`, `replaceScheduledPage(workspaceId, status, rows, fetchStartedAt, hasMore)` — same `_cachedAt` watermark logic that saved-messages uses to avoid clobbering concurrent socket writes.

**Render via `useLiveQuery`** for both the page and the composer popover. No skeleton-on-cold-start except first-ever load; subsequent navigations are instantaneous from IDB.

**TanStack Query** for the network refresh: `staleTime: Infinity, refetchOnMount: true, refetchOnReconnect: true`. The `queryFn` calls API → `replaceScheduledPage` → returns. Component reads via `useLiveQuery`, not via the query result (cache-only observer pattern).

## Subscribe-Then-Bootstrap (INV-53)

In `apps/frontend/src/sync/workspace-sync.ts`, inside `registerWorkspaceSocketHandlers`:

1. **Top of function**: `queryClient.invalidateQueries({ queryKey: scheduledKeys.all })` — closes the reconnect gap.
2. **Socket handlers**:
   - `scheduled_message:upserted` → `persistScheduledRows([payload.scheduled])` + invalidate pending/sent lists.
   - `scheduled_message:sent` → `persistScheduledRows([payload.scheduled])` (now with `status='sent'`, `sentMessageId` set) + invalidate. Optionally trigger in-app toast linking to the live message.
   - `scheduled_message:cancelled` → `removeScheduledRow(payload.scheduledId)` + invalidate.
   - `scheduled_message:lock_changed` (optional, cross-device awareness) → write only the lock fields.
3. **Bootstrap timing**: not preloaded in `WorkspaceBootstrap` (mirrors saved-messages). Lazy-fetched on first page/popover visit; live IDB satisfies offline renders.
4. **Pair guarantee**: every subscribing surface pairs with a TanStack query that runs `refetchOnMount: true` against the list endpoint. Reconnect's `invalidateQueries` triggers refetch on mounted views; unmounted views refetch on next mount.

## Mutations & Optimistic Writes

Saved-messages uses no explicit optimistic IDB writes. We do (modest divergence) because the user expects scheduled rows to appear immediately:

- **Create / reschedule / cancel** via `useMutation` with explicit `onMutate` writing to IDB (temp id `sched_local_<ulid>`, `_cachedAt = Date.now()`) and `onSuccess` reconciling to the server-issued id (delete temp + put real, single Dexie tx).
- **Lock claim / release** stay strictly online — synchronization primitives, not user data. Offline → claim fails → editor falls back to view-only with `"Reconnect to edit"`.
- **PATCH while editing** uses the lock token; if offline, surface `"Reconnecting…"` rather than queueing (a stale edit applied minutes later could race the worker).

## Outgoing-Write Queueing for Offline Sends

Extend `apps/frontend/src/sync/operation-queue.ts`:

```ts
type:
  | "schedule_message"
  | "cancel_scheduled_message"
  | "reschedule_scheduled_message"
```

`executeOperation()` gains a branch per type. Retries follow existing exponential-backoff schedule. Optimistic IDB row from `onMutate` carries the user through; when queue drains and server upsert event arrives, temp row is reconciled to real id (mapped via stored `localId`).

Lock-bearing edits do NOT enter this queue.

## Outbox Events

- `scheduled_message:upserted` — `{ workspaceId, targetUserId, scheduled: ScheduledMessageView }`
- `scheduled_message:sent` — `{ workspaceId, targetUserId, scheduledId, sentMessageId, streamId, scheduled: ScheduledMessageView }`
- `scheduled_message:cancelled` — `{ workspaceId, targetUserId, scheduledId }`
- `scheduled_message:lock_changed` — `{ workspaceId, targetUserId, scheduledId, ownerId, expiresAt }` (optional, cross-device awareness)

Constants centralized in `packages/types` (INV-33). Dispatched via `BroadcastHandler` to room `workspace:{workspaceId}` (or scoped to author user only — TBD; saved-messages targets the user via `targetUserId`).

## Display Conventions

- Time labels everywhere use `formatFutureTime(date, prefs)` from `apps/frontend/src/lib/dates.ts` with terse format (`5m`, `Tomorrow 9:00`). Below 1m, the function's bottom bucket renders as `"Sending soon"` (no second-counter). Re-renders every 30s while pending.
- Previews use `stripMarkdownToInline()` from `apps/frontend/src/lib/markdown/strip.ts` (INV-60).
- All dates user-timezone-aware via `formatDate(date, timezone, format)` from `lib/temporal.ts` (INV-42).

## Composer Integration

In `apps/frontend/src/components/timeline/message-input.tsx`:
- Add scheduled-messages popover trigger next to `StashedDraftsPicker`. Component: `apps/frontend/src/components/composer/scheduled-messages-picker.tsx`.
- Send-button caret menu (or adjacent calendar icon) → `Schedule send…` opens the schedule picker for the current draft. On submit: same `materializePendingAttachmentReferences()` pipeline → POST `/scheduled` instead of `/messages`. Clears the draft.
- Edit mode flag on `MessageComposer`: `mode: { kind: "editScheduled", id, lockToken }`. When set: prefill content + attachments, replace primary submit handler with PATCH, show banner with `Cancel edit`.

For modal edits on the page: same `MessageComposer` hosted inside a Dialog with the schedule-time picker above.

## Tests

- **Repo/service** — create, list-by-status, race-safe claim CAS, reschedule cancel-and-reinsert tx behavior, idempotent fire (INV-22).
- **Worker** — editor-holds-lock → defer; pending-only fires; status check guards stale ticks; bounded retry → `failed`.
- **Save-when-past-time** — PATCH performs send atomically; idempotent if worker already won the CAS (no double-send).
- **E2E (Playwright)** — schedule from composer → appears in popover → reschedule → cancel; schedule firing → message appears in stream timeline; sent tab → click navigates and highlights live message; offline schedule → drains and reconciles on reconnect.
- No `.skip` (INV-26); assert events by content not count (INV-23).

## Crosswalk to Existing Files

| Concern | Saved-messages template | Scheduled-messages new file |
|---|---|---|
| Dexie row + indexes | `apps/frontend/src/db/database.ts` (`CachedSavedMessage`) | same file, `CachedScheduledMessage` + version bump |
| Persistence helpers | `apps/frontend/src/db/saved-messages.ts` | `apps/frontend/src/db/scheduled-messages.ts` |
| Hooks | `apps/frontend/src/hooks/use-saved.ts` | `apps/frontend/src/hooks/use-scheduled.ts` |
| Socket handlers | `apps/frontend/src/sync/workspace-sync.ts` (saved block) | extend same file |
| Page | `apps/frontend/src/pages/saved.tsx` | `apps/frontend/src/pages/scheduled.tsx` |
| Composer popover | `apps/frontend/src/components/composer/stashed-drafts-picker.tsx` | `apps/frontend/src/components/composer/scheduled-messages-picker.tsx` |
| Backend feature | `apps/backend/src/features/saved-messages/` | `apps/backend/src/features/scheduled-messages/` |
| Operation queue | `apps/frontend/src/sync/operation-queue.ts` | extend with three new types |

## Decisions (Locked)

- **"Send now"** kept (Journey 8).
- **Failure presentation**: inline in "To send" tab with red border + clear status pill (Journey 10).
- **Reschedule policy**: as long as `status === 'pending'`, user can reschedule freely; the lock is the only correctness gate.
- **Past-scheduled-time editing**: button labels swap (`Save → Send`, `Cancel → Send unchanged`) + banner makes the implication explicit. Closing the dialog with unsaved edits requires a confirmation.
- **Relative time copy**: terse `formatFutureTime` everywhere; sub-1m falls through to `"Sending soon"`. No second-counter ever.
- **Send button click**: disabled state prevents double-click; spinner glyph deferred until ≥300ms so happy-path clicks never flicker.
- **30s sync threshold and 300ms wait budget**: encoded server-side; client uses the response shape to decide UI behavior.

## Open Decisions (Defer until implementation)

1. **Slash commands in scheduled messages** — evaluate at schedule time or fire time? Lean fire time (consistent with "send like the user just sent it"), but flag UX risk.
2. **Privacy-warning crossing** — re-evaluate at fire time and fail-closed via `failed` status if not still confirmed.
3. **Attachment GC** — reuse the existing message-attachment reference table (preferred) so attachments stay alive while a scheduled row references them.
4. **Sidebar entry** — separate "Scheduled" item, or grouped with drafts as "Drafts & scheduled"?
5. **`scheduled_message:lock_changed` event** — ship in v1 for cross-device awareness, or defer?
6. **Per-stream filter scope of the composer popover** — current stream only, or include thread parents?

## What's NOT Included

- No team-wide visibility of someone else's scheduled messages — each user only sees their own.
- No editing of *other users'* scheduled messages.
- No bulk operations on the page (multi-select cancel/reschedule).
- No notification preferences for scheduled-send confirmations (uses default in-app toast only).
- No "schedule on behalf of" / shared schedules.

## Status

- [ ] Migration: `scheduled_messages` table
- [ ] Backend feature folder: repo / service / handlers / worker / outbox handler
- [ ] Worker registered in `server.ts` on LIGHT tier
- [ ] Outbox event constants in `packages/types`
- [ ] Dexie schema bump + persistence helpers
- [ ] `useScheduledMessages` / `useScheduleMessage` / `useUpdateScheduled` / `useCancelScheduled` / `useClaimScheduled` / `useReleaseScheduled` hooks
- [ ] Workspace sync: handlers + reconnect invalidation
- [ ] Operation queue: three new types
- [ ] Composer popover trigger + `ScheduledMessagesPicker`
- [ ] Send-button schedule entry point
- [ ] In-stream edit mode (`MessageComposer` mode prop)
- [ ] `/w/:wsId/scheduled` page with URL-driven tabs
- [ ] Edit modal hosting `MessageComposer`
- [ ] Past-scheduled-time button-label + banner behavior
- [ ] Tests: repo / worker / E2E
