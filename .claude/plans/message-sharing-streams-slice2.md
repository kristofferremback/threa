# Message Sharing — Slice 2 (Cross-Stream Picker + Per-Viewer Hydration)

## Goal

Slice 2 of the message-sharing feature (full plan: `docs/plans/message-sharing-streams.md`). Slice 1 shipped share-to-parent with single-level pointer hydration. Slice 2 unlocks **arbitrary cross-stream targets** via a picker modal and adds **per-viewer recursive hydration** with `private` and `truncated` placeholder states for re-share chains (plan section D8).

## What Was Built

### Backend — recursive per-viewer hydration

Pointer hydration walks each chain level-by-level up to `MAX_HYDRATION_DEPTH = 3`. At every level the viewer's access is resolved via two batched queries: stream membership (direct member, public visibility, or thread inheriting from root) and share-grant lookup (a viewer can read a source iff a share with that source exists in a target stream the viewer can read). Results are classified per-message as `ok`, `deleted`, `missing`, `private`, or `truncated`.

**Files:**
- `apps/backend/src/features/messaging/sharing/hydration.ts` — rewrote `hydrateSharedMessageIds` from single-level to BFS with depth cap; takes `viewerId`. Added `walkSharedMessageNodes` visitor that both `collectSharedMessageIds` (Set) and `collectSharedMessageRefs` (Map<id, streamId>) specialise.
- `apps/backend/src/features/streams/access.ts` — new `listAccessibleStreamIds(db, ws, userId, candidateIds)` batched helper mirroring `checkStreamAccess` semantics for set-based access checks.
- `apps/backend/src/features/messaging/sharing/repository.ts` — new `listSourcesGrantedToViewer` composes with `listAccessibleStreamIds` to find sources a viewer can read via share grants. Two-step flow keeps the access predicate in one place.
- `apps/backend/src/features/streams/handlers.ts` — `hydrateSharedMessagesForEvents` now takes `viewerId`; threaded through the three call sites.

### Backend — privacy confirmation wire

`ShareService` already had `confirmedPrivacyWarning` plumbed through `MessageEventService` in Slice 1, but the HTTP handler didn't accept it. Slice 2 closes that gap so the cross-stream modal can confirm privacy boundary crossings.

**Files:**
- `apps/backend/src/features/messaging/handlers.ts` — `confirmedPrivacyWarning: z.boolean().optional()` added via a `commonMessageOptionsSchema` spread shared by all four create variants and both update variants.
- `apps/backend/src/features/messaging/sharing/service.ts` — error codes now reference `ShareErrorCodes` constants from `@threa/types` instead of magic strings.

### Wire types

**Files:**
- `packages/types/src/api.ts` — `SharedMessageHydration` union extended with `{ state: "private", sourceStreamKind, sourceVisibility }` and `{ state: "truncated", messageId, streamId }`. `CreateMessageInputJson`, `CreateDmMessageInputJson`, `UpdateMessageInputJson`, `UpdateMessageInputMarkdown` all gain `confirmedPrivacyWarning?: boolean`.
- `packages/types/src/constants.ts` — new `ShareErrorCodes` object centralises the cross-cutting `SHARE_PRIVACY_CONFIRMATION_REQUIRED` (matched on by the frontend queue) plus the five other share error codes for symmetry.

### Frontend — NodeView placeholder states

**Files:**
- `apps/frontend/src/components/shared-messages/context.tsx` — `HydratedSharedMessage` union mirrors backend's new variants.
- `apps/frontend/src/hooks/use-shared-message-source.ts` — maps the wire union onto two new `SharedMessageSource` variants (`private`, `truncated`).
- `apps/frontend/src/components/shared-messages/card-body.tsx` — renders the two new states. `PrivatePlaceholder` reveals only kind + visibility (never the cached `fallbackAuthor`, never the stream name). `TruncatedPlaceholder` is a navigable Link to the source stream + message anchor. Stream-kind vocabulary lives in `lib/streams.ts`'s `FALLBACK_LABELS` (new `noun` context row).

### Frontend — share modal + context-menu wiring

**Files:**
- `apps/frontend/src/components/share/share-message-modal.tsx` — Shadcn `Dialog` + `Command` picker. Filters to top-level streams the user can read (public visibility OR direct member, no threads, no archived). On select, queues the share node via `queueShareHandoff` and navigates to the target stream's normal composer — same hand-off pattern Slice 1 used for share-to-parent.
- `apps/frontend/src/components/timeline/message-actions.ts` — `'share'` action entry, always-visible alongside the share-to-root / share-to-parent fast paths.
- `apps/frontend/src/components/timeline/message-event.tsx` — owns the modal's open state and passes the source `SharedMessageAttrs`.
- `apps/frontend/src/lib/streams.ts` — lifted `STREAM_ICONS` here so the modal and the quick-switcher share the icon mapping.

### Frontend — privacy-block toast and queue handling

**Files:**
- `apps/frontend/src/lib/share-privacy-toast.ts` — sonner toast offering "Share anyway" / "Cancel". State writes go through `usePendingMessages.retryMessage` / `deleteMessage` (extended with optional patch arg) — never touches `db.*` directly so React state cleanup stays consistent.
- `apps/frontend/src/contexts/pending-messages-context.tsx` — `retryMessage(id, patch?)` accepts a patch so the toast can set `confirmedPrivacyWarning: true` and clear the `blocked-privacy` status atomically.
- `apps/frontend/src/hooks/use-message-queue.ts` — catches `409` + `SHARE_PRIVACY_CONFIRMATION_REQUIRED`, marks the pending row `status: "blocked-privacy"` (skipped from auto-retries), and surfaces the toast. Forwards `confirmedPrivacyWarning` on send.
- `apps/frontend/src/db/database.ts` — `PendingMessage` gains `confirmedPrivacyWarning?: boolean` and the `"blocked-privacy"` status value.

### E2E tests

**Files:**
- `tests/browser/message-share-cross-stream.spec.ts` — two scenarios:
  1. Public-channel source → scratchpad target via picker; pointer renders hydrated.
  2. Same-stream share — handoff lands in the current composer rather than re-navigating.

## Design Decisions

### Recursion in JS, access checks in SQL

**Chose:** Per-level BFS in JavaScript (max 3 levels), batched SQL queries for access checks within each level.
**Why:** ProseMirror content lives in JSONB and we need to extract `sharedMessage` node refs from it. A pure SQL `WITH RECURSIVE` would have to walk the JSONB inline, which is awkward and harder to maintain. The level-by-level approach gives 3 batched queries per level (find messages + accessible streams + share grants), worst case 9 round-trips for a 3-deep chain. In practice chains are 1–2 hops.
**Alternatives considered:** Single recursive CTE walking the JSONB tree — rejected for readability; the JS BFS reads as plain control flow.

### Truncated vs Private vs Missing

**Chose:** Pointers found at the seed level (depth 0) get `missing` if the row doesn't exist, `private` if the viewer can't access. Pointers collected past the depth cap get `truncated` using the `streamId` cached on the parent's share-node attrs — no extra DB hit.
**Why:** The depth cap is a pathological-data guard, not a privacy guard. Linking to a stream the viewer doesn't have access to just yields a normal 403 on click; not a security issue. Avoids an extra query just to re-classify cap-level entries.

### `listSourcesGrantedToViewer` composes, doesn't duplicate

**Chose:** Two-step flow — fetch `(source, target)` candidate pairs, then call `listAccessibleStreamIds` to filter targets.
**Why:** The "viewer can read this stream" predicate already lives in `listAccessibleStreamIds`. Inlining a copy in the share-grant query would invite drift any time access semantics change (roles, mute filters, etc.). One extra round-trip is worth a single source of truth.

### Privacy-block toast over modal step-2

**Chose:** Slice 2 surfaces the privacy-confirmation flow as a sonner toast on send-time 409. The full modal step-2 confirm with `share-preview` endpoint is deferred to Slice 3.
**Why:** Plan explicitly deferred step-2 to Slice 3. Toast keeps the user unblocked: "Share anyway" sets `confirmedPrivacyWarning: true` on the pending row and re-attempts; "Cancel" drops the optimistic event cleanly.

### `confirmedPrivacyWarning` is a per-message flag, not per-share

**Chose:** Single boolean covering every reference in a message body (carried over from Slice 1's service-layer assumption).
**Why:** Slice 2's modal pre-fills exactly one share node per message, and share-to-parent never crosses a privacy boundary. The Slice 1 service-layer comment notes the upgrade path: when arbitrary multi-reference composing lands, swap to per-source confirmation (`confirmedPrivacyFor: Set<sourceStreamId>`).

## Schema Changes

None. Slice 1 already created `shared_messages`. Slice 2's `confirmedPrivacyWarning` is a per-request flag, never persisted; `PendingMessage`'s new fields are IndexedDB-side only (no Dexie migration since indexed keys didn't change).

## What's NOT Included

Deferred to Slice 3 / follow-ups:
- **Attachments on shared messages.** A shared "look at this" + image currently renders as the text only — `HydratedSharedMessage.ok` carries `contentJson`/`contentMarkdown` but no `attachments`, and `card-body.tsx` doesn't mount an `AttachmentList`. Slice 3 should: extend the `ok` wire variant with `attachments: AttachmentSummary[]`, batch-fetch via `AttachmentRepository.findByMessageIds(okMessageIds)` inside `hydrateSharedMessageIds` (one extra round-trip, no per-ref loop, INV-56), thread through `use-shared-message-source.ts`, and render `<AttachmentList>` in the `ok` branch of `card-body.tsx`. Access is implicit — attachments are emitted only for `ok` payloads where viewer access to the source is already established, so no privacy gap.
- **Step-2 privacy confirm in the modal** (still a blocking toast in Slice 2).
- **`GET /api/.../share-preview` endpoint** for pre-flight privacy check.
- **`'share-as-quote'` action** + cross-stream quote flavor.
- **"+ New scratchpad" picker row** that creates a target on the fly.
- **Partial-selection share button** in the text-selection toolbar (Slice 4).
- **Three-user E2E rechain test** (`E2E-share-rechain-private-placeholder` from the plan). The rechain hydration logic is exhaustively unit-tested in `hydration.test.ts` (mixed-access two-hop chain with `private` placeholder for the inner pointer) and `card-body.test.tsx` (asserts the placeholder doesn't leak the cached fallback author). A 3-user 3-stream Playwright variant is heavy and best done as a separate E2E PR.
- **Folding `getAccessibleStreamsWithMembers` and `listAccessibleStreamIds` into one helper.** They overlap on the access predicate but have different APIs (search-feature has participant + archive filters; mine takes a candidate id set). Keeping them separate; both are tested.

## Status

- [x] Backend: recursive per-viewer hydration with depth cap
- [x] Backend: `private` / `truncated` placeholder resolution
- [x] Backend: handler accepts `confirmedPrivacyWarning`
- [x] Wire types: union extension + `ShareErrorCodes` constants
- [x] Frontend: NodeView renders `private` / `truncated` states
- [x] Frontend: cross-stream picker modal
- [x] Frontend: `'share'` action + modal wiring
- [x] Frontend: privacy-block toast with retry/cancel via context API
- [x] E2E: cross-stream-public + same-stream
- [x] Self-review pass (reuse, quality, efficiency reviewers)
