# Batch Move Messages To Thread

## Goal

Allow users to enter a stream-level batch selection mode, choose one or more messages, and move them into a direct child thread by dragging the selection onto a preceding message. The move must be validated before confirmation, preserve related AI trace/session data, and update realtime clients without requiring a refresh.

## What Was Built

### Frontend batch selection and drag/drop

Batch mode is exposed from stream action menus in main streams, thread views, and thread panels. While active, message context menus, long press, thread links, previews, reactions, and other per-message actions are suppressed. Messages render with checkboxes and can be toggled by clicking/tapping the row. Dragging a selected message creates a ghost preview, greys out invalid targets only while dragging, highlights valid hovered targets, and triggers mobile vibration when the hovered target changes.

**Files:**
- `apps/frontend/src/pages/stream.tsx` - Adds the stream action menu entry, including thread main views.
- `apps/frontend/src/components/thread/stream-panel.tsx` - Adds the same action to thread panels.
- `apps/frontend/src/components/timeline/stream-content.tsx` - Owns batch state, drag/drop, validation, confirmation, and scroll spacing.
- `apps/frontend/src/components/timeline/message-event.tsx` - Renders checkboxes and selected/invalid/hovered message states.
- `apps/frontend/src/components/timeline/event-list.tsx` and `event-item.tsx` - Thread batch state through timeline rendering.

### Two-step backend move operation

Moving messages is now a two-step operation. The validate endpoint checks stream membership, message ownership, target ordering, and selection validity, then creates a short-lived operation lease. The move endpoint requires that lease, consumes it, revalidates the same move, then performs the transactional move.

**Files:**
- `apps/backend/src/routes.ts` - Adds `POST /messages/move-to-thread/validate`.
- `apps/backend/src/features/messaging/handlers.ts` - Adds request schemas and handler wiring for validate and move.
- `apps/backend/src/features/messaging/event-service.ts` - Implements validation, lease consumption, thread creation/reuse, and transactional moves.
- `apps/backend/src/lib/operation-leases/repository.ts` - Reusable operation lease primitive.
- `apps/backend/src/db/migrations/20260426123019_add_batch_operation_leases.sql` - Adds `batch_operation_leases`.
- `packages/types/src/api.ts` and `packages/types/src/index.ts` - Adds shared request/response types.
- `apps/frontend/src/api/messages.ts` - Adds validate API client and `leaseKey` move input.

### Message, event, and trace relocation

The move updates messages, their `message_created` stream events, associated agent session lifecycle events, and stream-scoped references such as attachments, saved messages, activity, link previews, researcher cache, memo pending items, and agent sessions. Existing child threads under moved messages are reparented under the destination thread.

**Files:**
- `apps/backend/src/features/messaging/repository.ts` - Adds set-based move and reference update helpers.
- `apps/backend/src/features/streams/event-repository.ts` - Adds event move helpers for message and agent session events.
- `apps/backend/src/features/streams/repository.ts` - Adds child thread reparenting and adjusts summaries to order by timestamps after moves.
- `apps/backend/src/features/streams/service.ts` - Makes normal thread creation inherit scratchpad companion settings.
- `apps/backend/src/features/messaging/event-service.ts` - Applies the same scratchpad companion inheritance for move-created threads.

### Realtime synchronization

The backend emits `messages:moved` to both source and destination stream rooms and `stream:created` for newly created destination threads. Frontend stream sync removes moved source events, inserts destination events, caches the destination thread, patches the parent message with `threadId`, and updates workspace bootstrap cache so thread panels can open without refresh.

**Files:**
- `apps/backend/src/lib/outbox/repository.ts` - Adds `messages:moved` payload typing.
- `apps/backend/src/lib/outbox/broadcast-handler.ts` - Broadcasts move events to source and destination rooms.
- `apps/frontend/src/sync/stream-sync.ts` - Applies moved event payloads and stream-created thread cache updates.

### Tests

Real integration and E2E coverage was added around sparse message moves, direct child thread creation, ordering, reply counts, lease flow, and AI trace/session movement. Existing local harness blockers prevent these focused tests from executing in this checkout, but the committed code passes lint, typecheck, Dockerfile workspace checks, and OpenAPI validation through the pre-commit hook.

**Files:**
- `apps/backend/tests/integration/message-move.test.ts`
- `apps/backend/tests/e2e/threads.test.ts`
- `apps/backend/tests/client.ts`

## Design Decisions

### Operation leases for batch moves

**Chose:** A reusable `batch_operation_leases` table and `OperationLeaseRepository`.

**Why:** The move should establish a precedent for future batch operations: validate first, show confirmation, then commit only with a lease. The move endpoint still revalidates after lease consumption to handle concurrent changes.

**Alternatives considered:** A frontend-only confirmation was rejected because it would not enforce the two-step operation contract at the API boundary.

### Preserve direct child stream semantics

**Chose:** Dropping onto a message always creates or reuses a thread whose `parent_stream_id` is the source stream and whose `parent_message_id` is the drop target.

**Why:** This preserves the rule that messages can only move into a direct child stream, including when the source stream is itself a thread.

### Move trace lifecycle events with AI messages

**Chose:** Move agent session lifecycle stream events and the corresponding `agent_sessions.stream_id` when selected messages are tied to an agent session.

**Why:** The visible trace belongs to the AI response message; leaving it in the source timeline separates the trace from the response it explains.

### Scratchpad companion inheritance

**Chose:** Threads under scratchpads inherit `companionMode` and `companionPersonaId`; channel-rooted threads remain mention-triggered only.

**Why:** Scratchpad threads should behave as substreams of the scratchpad, while channel threads keep the existing explicit mention behavior.

### Source event as realtime fallback

**Chose:** `messages:moved` is self-sufficient for source clients: it patches the parent message `threadId`, updates reply count, and caches the destination thread.

**Why:** This avoids refresh requirements if `stream:created` arrives later, is missed, or is not handled by the currently mounted view.

## Design Evolution

- **Message context menu entry -> stream menu entry:** The feature started with selection available from a message context menu. It moved to the stream action menu because batch selection is an operation on the stream, not a single message.
- **Single-step move -> validate/confirm/move:** The first move implementation posted directly to the move endpoint. It now validates on drop, shows confirmation, and requires a lease for the final move.
- **Message-only move -> trace-aware move:** The implementation expanded from moving messages and message events to also moving agent session lifecycle events and session references.
- **Main streams only -> thread views and panels:** Batch mode now works in threads and thread panels as well as top-level streams.

## Schema Changes

- `apps/backend/src/db/migrations/20260426123019_add_batch_operation_leases.sql` creates `batch_operation_leases` with workspace, user, operation type, JSON payload, expiry, consumed timestamp, and lookup index for unconsumed leases.

## What's NOT Included

- No generic frontend batch actions beyond message selection and move-to-thread.
- No lease cleanup worker; expired leases are ignored by lookup/consume semantics.
- No moving messages into arbitrary existing streams; the destination is always the drop target's direct child thread.
- No support for moving messages onto following messages or onto selected messages.

## Status

- [x] Batch selection mode in main streams
- [x] Batch selection mode in thread views and thread panels
- [x] Drag/drop sparse selections onto preceding messages
- [x] Two-step validate/confirm/move API with lease key
- [x] Move message events, message rows, stream-scoped references, child threads, and AI trace/session events
- [x] Realtime source and destination cache updates
- [x] Focused integration and E2E tests added
- [x] Typecheck, lint, Dockerfile workspace checks, and OpenAPI check pass through pre-commit
