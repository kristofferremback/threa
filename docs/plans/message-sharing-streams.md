# Message Sharing Across Streams

## Problem

Threa messages cannot be shared across streams today. If a useful answer lands in a thread, there is no "share to channel" — users have to copy/paste it, which loses attribution, formatting, and the ability to follow edits. Likewise, from a channel message there's no way to forward to a DM, to save it to a scratchpad, or to cross-post to another channel.

The existing quoting primitive (`ThreaQuoteReply` ProseMirror node + `text-selection-quote.tsx` toolbar) only covers **in-stream quoting** — quoting a message back into the same stream it originated in. There is no cross-stream variant, no pointer (live-updating) flavor, and no destination picker.

Prior search for `share`, `forward`, `repost`, `cross-post` in `apps/` and `packages/` returned only HTTP header forwarding and test fixture names. No existing feature to extend.

## Goal

Ship a "Share to…" action on any message, from any stream the user can see, targeting any top-level stream the user has access to. Support two sharing **patterns** and two sharing **flavors**, with a privacy-safety prompt when a share would expose a private message to users who can't already see it.

**Patterns** (who the target is):

1. **Share to parent** — one-click from a thread message to its parent stream. Fast path, no picker.
2. **Share to another stream** — pick any top-level stream (channel, DM, scratchpad) the sharer has access to.

**Flavors** (how the message is rendered in the target):

- **Pointer** — a live reference to the source message. Edits propagate; deletes show a tombstone. Implemented as a new ProseMirror node, hydrated at render time.
- **Quote** — reuses the existing `ThreaQuoteReply` node. Full-message or partial (text-selection) snippet. Frozen snapshot.

**Target scope**: top-level streams only (channels, DMs, scratchpads). No threads as targets.

## Non-goals

- **Threads as targets.** Explicitly excluded in this plan. Adding later is cheap — it's just extending the picker filter — but initial UX is top-level only.
- **Permalink-only sharing** (copying a link without posting a message). Already covered by `copy-link` in `message-actions.ts`. Out of scope.
- **Forwarding to external destinations** (email, Slack, etc.). Threa-internal only.
- **Bulk sharing** (select multiple messages → share). Single-message only.
- **Retroactive redaction.** If a source message's visibility changes _after_ a share, we do not retroactively redact prior shares. The share grant is durable at share time (see D3).
- **Cross-workspace sharing.** Workspace is the sharding/ownership boundary (INV-8). A share's source and target must be in the same workspace.

## Terminology

- **Source message** — the message being shared.
- **Source stream** — the stream the source message lives in. May be a thread, channel, DM, or scratchpad.
- **Target stream** — where the share is being posted. Must be a top-level stream (channel, DM, scratchpad).
- **Share message** — the new message created in the target stream. Its `contentJson` contains either a `ThreaSharedMessage` node (pointer) or a `ThreaQuoteReply` node (quote), plus any commentary the sharer adds.
- **Sharer** — the user performing the share. Must have read access to the source message and write access to the target stream.
- **Pointer share** — share flavor where the rendered content is a live reference. Updates on source edit.
- **Quote share** — share flavor where the rendered content is a frozen snippet. Existing quote infrastructure.

## User Flows

### F1: Share a thread message to its parent stream (fast path)

1. User hovers a message in a thread, opens the context menu (desktop ellipsis / mobile long-press).
2. Context menu shows a dedicated entry, label derived from the parent stream's type:
   - Parent is a channel → **"Share to #channel-name"**
   - Parent is a DM → **"Share to DM"**
   - Parent is a scratchpad → **"Share to scratchpad"**
3. Clicking the entry does **not** open the picker. It navigates the user directly to the parent stream and pre-inserts a pointer (default flavor for share-to-parent) into the parent stream's composer. The composer is already the user's normal editor — they add optional commentary and send.
4. No privacy prompt for this pattern — thread visibility is by construction a subset of parent visibility (a thread's `parentStreamId` / `rootStreamId` already establishes this containment).

Entry only renders when:

- Current stream has a `parentStreamId`, AND
- Parent is a top-level stream (channel / DM / scratchpad — not a nested thread).

### F2: Share any message to any other stream (picker path)

1. User opens the message context menu (desktop ellipsis / mobile long-press). Entry: **"Share to…"** (with trailing ellipsis to signal modal).
2. Modal opens: stream picker, scoped to top-level streams the user has access to in the current workspace. Reuses `use-stream-items.tsx` (from quick-switcher) as the data source. Ordering: recently visited first, then alphabetical. Scratchpad(s) the user owns are pinned at the top under a "Your scratchpads" group.
3. Search box filters live.
4. User selects a target. Secondary toggle: **"As pointer (live)"** vs **"As quote"**. Default = pointer.
5. If the share would cross a privacy boundary (see D2 below), a confirmation step appears: "This message is in a private stream. Members of #target-name who aren't in #source-name will be able to see it." with **Cancel** / **Share anyway** buttons.
6. On confirm: navigate to the target stream, pre-insert the chosen node (pointer or quote) into the target's composer, focus the editor. User optionally adds commentary and sends via normal send.
7. If the user picks the stream they're already viewing: block with an inline toast ("You're already in this stream — use Quote instead"). Doesn't open composer pre-fill.

### F3: Share a partial selection from a message

1. User selects text in a message. The existing floating toolbar (`text-selection-quote.tsx`) today shows **Quote**. We add a second button: **Share**.
2. Clicking Share opens the same modal as F2, but the flavor is **forced to Quote** with the selected snippet (not togglable — a partial selection is intrinsically a quote). The toggle in the modal is hidden or disabled for this entry point.
3. Picker, privacy step, navigation, and composer pre-fill proceed as in F2.

### F4: Share from the context menu as a full quote

Same as F2 but the user toggles to "As quote" in the modal. The quote block is pre-inserted as a full-message quote (no partial snippet).

### After-share behavior in target stream

- Target stream composer opens with the pointer/quote node as the first block, cursor placed on a new line below so the sharer can add commentary above or below naturally.
- Sending is a normal `createMessage` call — the share is a regular message that happens to contain a share-node in its `contentJson`. No special send path.
- The message appears in the target stream's timeline via the normal outbox event (INV-4, INV-7). Sidebar preview strips the share node to something like "Shared a message from #source-name" (see F-Preview below).

### F-Preview: sidebar / activity preview

- Pointer node strips to: `Shared a message from #{sourceStreamName}` (or `from @{authorName}` when source is a DM).
- Quote node: existing quote strip behavior (already in `StreamItemPreview` / `ActivityPreview`, honoring INV-60). No change needed.
- Commentary text prepended if any, per existing `stripMarkdownToInline()` behavior.

## Design Decisions

### D1: Pointer share grants durable read on the single shared message

When a pointer share is posted to a target stream, target members gain implicit read access to that **one message** — not to the source stream. This is the whole point of the privacy prompt: once the sharer confirms, they are transferring visibility of that message to the target audience.

Implications:

- A target member who is not in the source stream sees the live content of the shared message whenever they view the target stream.
- If the source message is later edited, target members see the edit.
- If the source message is deleted, target members see a tombstone.
- If the **sharer** later loses access to the source (booted from the private channel), the share does **not** retroactively disappear from the target. The share is a durable grant on the single message, orthogonal to the sharer's later membership.
- If the **source stream's visibility** changes later (private → public, public → private), the share still renders. We do not retroactively redact.

Rationale: retroactive redaction creates confusing UX ("why did the shared message suddenly vanish?") and requires expensive recomputation. At share time the sharer made a deliberate decision with a clear prompt; that's the consent boundary.

### D2: Privacy-warning trigger

The modal shows the warning step iff **all** of the following are true:

1. Source stream's `visibility === 'private'`.
2. Target stream has at least one `stream_members` row whose `user_id` is not in the source stream's member set.

Skip the warning when:

- Source is public (`visibility === 'public'`). Public info is public — no warning.
- Target membership ⊆ source membership (every target member can already see the source). Nothing new is revealed.
- Share to parent (F1). Parent visibility ⊇ thread visibility by construction.

Implementation note: the membership-subset check is a single count query — `SELECT count(*) FROM stream_members tgt WHERE tgt.stream_id = $target AND NOT EXISTS (SELECT 1 FROM stream_members src WHERE src.stream_id = $source AND src.user_id = tgt.user_id)`. If count > 0, show the warning. Keep it in a service method on the share service (no premature abstraction).

### D3: Pointer vs Quote is a render-time distinction

Both flavors are represented in `contentJson` (INV-58). The difference is **which ProseMirror node** is embedded:

- **Pointer** → new `ThreaSharedMessage` node (spec below).
- **Quote** → existing `ThreaQuoteReply` node. No change to its schema.

Both nodes carry `messageId` and `streamId` (source). Quote additionally carries a frozen `snippet` (full or partial). Pointer carries no snippet — the renderer fetches the current message at display time.

Pointers require a hydration step (backend join at read time); quotes do not. See the backend section for the hydration path.

### D4: Share-to-parent defaults to pointer, modal defaults to pointer

Pointer is the stronger semantic (updates propagate, less work to keep in sync) and matches how most Slack-like tools model "share to channel". The modal exposes the Quote toggle for users who specifically want a frozen snippet.

Partial-selection share (F3) forces Quote because a partial snippet is intrinsically a frozen excerpt — a pointer to "just these two words" doesn't make sense.

### D5: Scratchpad targets are own-scratchpad only

The picker filters scratchpads to those owned by the sharer. Cross-user scratchpad sharing is not supported in this plan. Scratchpad sharing is positioned as a "save this to my brain dump" gesture.

### D6: No new access tables for pointers — use source_message lookup + grant table

We need a way for the backend to answer "can user X see pointer-referenced message Y when rendering the target stream?" Two options considered:

- **(a) Check source-stream membership at render time.** Fails D1 — target members who aren't in source would see nothing.
- **(b) Persist a share grant.** Adds a row per share recording "message Y is admitted into stream Z via share message S". Render-time access is "viewer has read access to Z" (already true — they're reading the target stream timeline).

Going with (b). New table `shared_messages`:

- `id` (`share_xxx` ULID, INV-2)
- `workspace_id` (INV-8)
- `share_message_id` — the new message created in the target stream
- `source_message_id`
- `source_stream_id`
- `target_stream_id`
- `flavor` — `'pointer' | 'quote'` stored as TEXT (INV-3), validated in code
- `created_by` — `UserId`
- `created_at`

No foreign keys (INV-1). Workspace-scoped. Index: `(target_stream_id, share_message_id)` for render-time hydration; `(source_message_id)` for propagating edits to pointer renders.

Quote flavor rows are written too (for analytics + symmetry), but the render path for quotes doesn't need the lookup — the snippet is inline in the node.

### D7: Update propagation uses existing `message:updated` outbox event

When a source message is edited or deleted, the existing `message:updated` outbox event already fires (see `event-service.ts:343–349`). We add a small handler that, on `message:updated`, looks up `shared_messages WHERE source_message_id = ?` and emits a **render-hint event** (`pointer:invalidated`) to every `target_stream_id` so connected clients re-fetch the affected pointer.

This avoids mutating the share-message row itself — the pointer is hydrated at read time, so the source edit is picked up automatically on the next fetch. The invalidation event exists only to trigger frontend cache refresh in real time.

## Data Model Changes

### New migration: `shared_messages` table

Append-only migration (INV-17). File: `apps/backend/src/db/migrations/<timestamp>_shared_messages.sql`.

```sql
CREATE TABLE shared_messages (
  id                 TEXT        PRIMARY KEY,      -- share_xxx ULID
  workspace_id       TEXT        NOT NULL,         -- INV-8
  share_message_id   TEXT        NOT NULL,         -- the message in target stream
  source_message_id  TEXT        NOT NULL,
  source_stream_id   TEXT        NOT NULL,
  target_stream_id   TEXT        NOT NULL,
  flavor             TEXT        NOT NULL,         -- 'pointer' | 'quote', INV-3
  created_by         TEXT        NOT NULL,         -- UserId
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX shared_messages_target_idx   ON shared_messages (target_stream_id, share_message_id);
CREATE INDEX shared_messages_source_idx   ON shared_messages (source_message_id);
CREATE INDEX shared_messages_workspace_idx ON shared_messages (workspace_id, created_at DESC);
```

No foreign keys (INV-1). No DB enum on `flavor` (INV-3). All fields are workspace-scoped via `workspace_id`.

### New ProseMirror node: `ThreaSharedMessage` (pointer)

Add to `packages/types/src/prosemirror.ts`, next to `ThreaQuoteReply`.

```ts
export interface ThreaSharedMessage {
  type: "threaSharedMessage"
  attrs: {
    messageId: string // source message id
    streamId: string // source stream id (for backend access validation)
    // Display hints cached at share time so the node renders *something*
    // if backend hydration fails. Canonical data is always fetched live.
    authorName?: string
    authorId?: string
    actorType?: "user" | "agent" | "bot" | "system"
  }
}
```

Markdown serialization (for wire format / external API — INV-58 says markdown is a boundary format): `{{shared:message:<messageId>|<streamId>}}` or a similar lossy fallback that preserves the link and a human-readable label. The canonical internal representation stays JSON.

The node is **atomic** (no inner content) — a pointer has no editable body. Users can add commentary around it by placing paragraphs before/after.

### Reuse `ThreaQuoteReply` for quote shares

No schema change to `ThreaQuoteReply`. Its existing attrs (`messageId`, `streamId`, `authorName`, `authorId`, `actorType`, `snippet`) already cover the quote flavor. The only change is that the `streamId` may differ from the current stream (today it's always the same stream).

Frontend quote rendering (`quote-reply-view.tsx`) currently links back to the source stream — that already works for cross-stream.

### No changes to `messages` table

We stay out of `messages.metadata` for this feature (avoiding the 20-key/256-char limits — INV-57 on tracking tables applies). The `shared_messages` table is the tracking surface. The message's `contentJson` carries the node inline; that's the only wire-format change.

### Type derivation (INV-31)

Source of truth for the `flavor` enum-like:

```ts
// packages/types/src/constants.ts
export const SHARE_FLAVORS = ["pointer", "quote"] as const
export type ShareFlavor = (typeof SHARE_FLAVORS)[number]
```

Zod schema in the backend handler (`createShareSchema`) infers from this constant. No drift between runtime validation and types.

## Backend Design

### Feature colocation (INV-51, INV-52)

New sub-feature inside the existing `messaging` feature folder, rather than a top-level feature — share is fundamentally a message-create with extra bookkeeping:

```
apps/backend/src/features/messaging/sharing/
  handlers.ts              # POST /streams/:streamId/messages/share, GET preview
  service.ts               # ShareService — access checks, tx, share-row write
  repository.ts            # shared_messages CRUD + hydration queries
  access-check.ts          # Pure functions for "crosses privacy?" / "subset?" checks
  outbox-handler.ts        # Handle message:updated → emit pointer:invalidated
  index.ts                 # Barrel (INV-52)
  __tests__/
    service.test.ts
    access-check.test.ts
    handlers.test.ts
```

The share service calls into the existing `messaging` event service to actually create the message row — it doesn't re-implement message creation (INV-35, INV-37).

### API surface

New handler on the regional backend:

- `POST /api/streams/:streamId/messages/share` — creates a share from the source to the target. Body validated with Zod (INV-55):

```ts
const createShareSchema = z.object({
  sourceMessageId: z.string(),
  targetStreamId: z.string(),
  flavor: z.enum(SHARE_FLAVORS),
  snippet: z.string().max(1000).optional(),     // required when flavor === 'quote' with partial
  commentary: z.object({ ... }).optional(),     // ProseMirror JSONContent prepended/appended
  confirmedPrivacyWarning: z.boolean().optional(), // must be true if warning triggered
})
```

- `GET /api/streams/:sourceStreamId/messages/:messageId/share-preview?targetStreamId=...` — returns `{ privacyWarning: { triggered: boolean, exposedUserCount: number, targetName: string } }` so the frontend can render the warning step before POSTing.

Handlers are thin (INV-34): validate input → auth check → delegate to `ShareService` → format response. Errors throw `HttpError` (INV-32).

### `ShareService.createShare`

Flow (in one transaction — INV-6):

1. Load source message + source stream, verify sharer has read access (`stream_members` or public visibility).
2. Load target stream, verify sharer has write access.
3. If source and target streams are in different workspaces → `HttpError(400, 'cross_workspace_share_forbidden')` (INV-8).
4. If `flavor === 'pointer'` and target === source → `HttpError(400, 'same_stream_share_forbidden')`.
5. Compute privacy-warning state via `access-check.ts::crossesPrivacyBoundary(sourceStreamId, targetStreamId, tx)`.
6. If warning would trigger and `confirmedPrivacyWarning !== true` → `HttpError(409, 'privacy_confirmation_required')`.
7. Assemble `contentJson`: `[...commentary.before, shareNode, ...commentary.after]`. The `shareNode` is either a `ThreaSharedMessage` (pointer) or `ThreaQuoteReply` (quote).
8. Call `eventService.createMessage({ streamId: targetStreamId, authorId, contentJson, ... })` — this handles the existing outbox emission for `message:created` and `stream:activity` (INV-4, INV-7). Reuses existing infra, no parallel code path (INV-35).
9. Insert `shared_messages` row in the **same transaction** as the message's event row. This preserves INV-7 (event-source + projection committed together) — the share-grant row is the access-projection for pointer renders.
10. Return the created message + share metadata.

Single-query helpers use `pool` directly (INV-30). The transactional path goes through `withTransaction`.

### Pointer hydration on message fetch

When the frontend fetches messages for a stream, the backend needs to resolve any `ThreaSharedMessage` nodes in `contentJson` into current source-message content.

Implementation: in the existing message read projection, after fetching the batch of messages, collect all `messageIds` referenced by `ThreaSharedMessage` nodes and issue a single batched read (INV-56) against `messages` joined with `users`/`bots` for author info. Inject the hydrated payload as a sibling field on the response (e.g. `message.sharedMessages: { [sourceMessageId]: HydratedMessage }`), not by mutating the `contentJson`. The node stays canonical (INV-58); the renderer overlays the hydrated data.

Tombstone: if `messages.deleted_at IS NOT NULL`, the hydrated entry carries `{ deleted: true, deletedAt }`. If the source message doesn't exist (shouldn't normally happen but defend for it), return `{ missing: true }`.

Performance: the hydration is a single `WHERE id IN (...)` query per stream read. Index on `messages.id` (primary key) handles it. No N+1.

### Outbox handler for propagating updates

New handler file `outbox-handler.ts` subscribes to:

- `message:updated` (edit / delete of any message) — if `shared_messages` has rows with `source_message_id = event.messageId`, emit `pointer:invalidated` events to each distinct `target_stream_id`. Clients with that stream subscribed invalidate their local cache for the affected share-message(s).
- No action on `message:created` (shares don't reference yet-to-exist messages).

The invalidation event lives in the realtime channel, not the outbox — it's a cache-bust hint, not a domain event (there's no persistent state change on the share row). This keeps the outbox pure (INV-4).

### Access-check helper (`access-check.ts`)

Pure functions, easy to unit-test:

```ts
export async function crossesPrivacyBoundary(
  sourceStreamId: string,
  targetStreamId: string,
  querier: Querier
): Promise<{ triggered: boolean; exposedUserCount: number }>

export async function isSubsetMembership(
  sourceStreamId: string,
  targetStreamId: string,
  querier: Querier
): Promise<boolean>
```

Subset check is the single SQL count described in D2. Privacy check combines source `visibility` + subset check. No heuristics, no English-string comparisons (INV-54) — all ID-based.

## Frontend Design

### Action plumbing

Extend `apps/frontend/src/components/timeline/message-actions.ts`:

- Add `'share-to-parent'` action. `when()` returns true iff current stream has `parentStreamId` AND parent type ∈ {channel, dm, scratchpad}. Label derived from parent type (`"Share to #{parentName}"`, `"Share to DM"`, `"Share to scratchpad"`). Callback fires a fast-path share (pointer flavor, no modal).
- Add `'share'` action. Always visible except on one's own scratchpad single-view where F1 doesn't apply. Opens `ShareMessageModal`.

Extend `MessageActionContext` with the new callbacks (`onShare`, `onShareToParent`) — same pattern as existing `onQuoteReply` (INV-37, reuse the established context shape).

### Text-selection toolbar

Edit `apps/frontend/src/components/timeline/text-selection-quote.tsx`:

- Add a second button "Share" next to the existing "Quote" button.
- Same selection-extraction logic is reused (snippet + author metadata). The Share button calls a new callback on the quote-reply context (`onShareWithSnippet`) and opens `ShareMessageModal` with `flavor='quote'` forced, `snippet` pre-populated, and the quote toggle hidden.

Mobile: the existing file already guards with `select-none` on mobile (line 54). Mobile path uses the message context menu's long-press flow — the "Share" entry in the context menu, plus a future follow-up for a mobile selection affordance (tracked as an open question below, but the context-menu path is enough for this ship).

### `ShareMessageModal`

New component: `apps/frontend/src/components/share/share-message-modal.tsx`.

Structure:

- **Step 1 — Picker**. Search input + grouped list (Channels / DMs / Your scratchpads). Data from the existing `use-stream-items` hook, filtered to top-level streams the user belongs to. Reuse Shadcn `Command` primitives (same as quick-switcher) — INV-14.
- **Step 2 — Flavor toggle** (only for context-menu entry; hidden for partial-selection entry). Radio with "As live pointer" (default) / "As quote". Inline explainer text: "Pointer stays in sync when the original is edited. Quote is a frozen snippet."
- **Step 3 — Privacy confirm** (only if backend `share-preview` says warning triggered). Text: `"{n} {people|person} in #{targetName} can't see the source message. Share anyway?"`. Cancel / Share anyway.

State machine is linear: step 1 → optional step 2 → optional step 3 → submit. Steps that don't apply auto-advance.

On submit:

1. Call `POST /api/streams/.../messages/share` with the chosen flavor and, if step 3 was shown, `confirmedPrivacyWarning: true`.
2. On success, navigate to target stream via `navigate('/w/{ws}/s/{targetStreamId}?m={newMessageId}')` (INV-40: navigation is a link-style action). The shared message is already posted — user lands on the sent message.

Optional commentary is **post-send**: if the user wants to add commentary, they can reply in the target stream. This keeps the modal narrow and matches "avoid unnecessarily large text editors". See D-Alt below if we revisit.

### Pointer NodeView

New component: `apps/frontend/src/components/editor/shared-message-view.tsx`.

Mirrors `quote-reply-view.tsx` in layout (author row + body + source-stream link) but renders **live** content from the hydrated payload provided by the backend. Reads from a new React context (`SharedMessagesProvider`) populated from the `message.sharedMessages` sibling field on each fetched message (see backend hydration).

States:

- Normal: author + live content (truncated with "See more" beyond 3 lines / 200 chars, matching the quote view's convention).
- Deleted: "[Message deleted by author]" with muted styling.
- Missing (edge case): "[Message no longer available]".
- Not yet hydrated (first paint): skeleton placeholder with author name/avatar from the node's cached attrs so the user sees _something_ on first paint.

Clicking the body navigates to the source stream + message (same URL pattern used elsewhere: `/w/{ws}/s/{sourceStreamId}?m={sourceMessageId}`). Buttons for actions; links for navigation (INV-40).

### Composer pre-fill — not used in this design

An earlier sketch had the modal navigate to the target and pre-insert the node into the composer. We dropped this in favor of "send immediately from the modal" because:

- Simpler state (no transient composer-injection channel between modal and target page).
- Matches "avoid large text editors" more literally.
- Commentary is still possible as a reply right after landing on the shared message.

Keeping this decision captured here so a reviewer sees we considered it (see D-Alt).

### Realtime: handling `pointer:invalidated`

In the existing socket subscription layer, add a handler for the `pointer:invalidated` event. On receipt:

- Look up which cached messages reference the invalidated `sourceMessageId` (iterate the current stream's message cache — cheap, stream caches are bounded).
- Call TanStack Query `invalidateQueries` for the affected stream's message list, or patch the `sharedMessages` side-map directly with a re-fetch of just the affected source-message IDs.

This pairs with a bootstrap-on-resubscribe refetch of pointers (INV-53) so we don't miss invalidations across reconnects.

### Markdown strip for previews (INV-60)

Extend `stripMarkdownToInline()` and `truncateContent()` to recognize:

- `ThreaSharedMessage` node → "Shared a message from #{sourceStreamName}" (or `@{authorName}` for DM sources).
- `ThreaQuoteReply` — already handled.

Sidebar and activity-feed previews must route through these helpers (already the case per INV-60; we extend the helpers, not the call sites).

## Testing Strategy

### Backend unit / integration (`bun run test`)

In `apps/backend/src/features/messaging/sharing/__tests__/`:

- `access-check.test.ts` — pure-function tests for `crossesPrivacyBoundary` and `isSubsetMembership`:
  - Public source + any target → not triggered.
  - Private source, target members ⊆ source members → not triggered.
  - Private source, target has outsiders → triggered with correct `exposedUserCount`.
  - Source = target → flagged by the same-stream guard in `service.test.ts`, not here.
- `service.test.ts`:
  - Creates a pointer share; verifies `messages` row + `shared_messages` row + outbox `message:created` event all written in one transaction (INV-7). Use a dropped-connection failure injection in the middle to assert rollback leaves nothing behind.
  - Cross-workspace share rejected with `HttpError(400, 'cross_workspace_share_forbidden')`.
  - Same-stream share rejected with `HttpError(400, 'same_stream_share_forbidden')`.
  - Missing privacy confirmation when required → `HttpError(409, 'privacy_confirmation_required')`.
  - Confirmed privacy → success.
  - Quote flavor with partial snippet: snippet lands in the `ThreaQuoteReply.attrs.snippet`, no pointer row hydration required.
- `handlers.test.ts` — thin Zod validation coverage (INV-55) + auth gating. Stubs the service.
- Pointer hydration: in `event-service` or a new `message-read.test.ts`, assert that a stream read containing a pointer returns a `sharedMessages` map keyed by `sourceMessageId`. Test deleted source → tombstone payload. Test missing source → `{ missing: true }`.
- Outbox handler: `message:updated` on a message referenced by two pointers in two different target streams emits exactly one `pointer:invalidated` per distinct target stream. Assert specific events, not counts of side effects beyond that (INV-23).

Do not use `mock.module()`; use scoped `spyOn` against namespace imports (INV-48).

### E2E (`bun run test:e2e`)

In `tests/` (cross-app Playwright):

- **E2E-share-to-parent**: two users in a channel + its thread. User A opens a thread message, clicks "Share to #channel". Asserts the message appears in the channel for user B within the realtime window, and the pointer renders live content.
- **E2E-share-cross-stream-public**: public channel → DM. No privacy prompt appears. Asserts pointer renders for the DM recipient.
- **E2E-share-cross-stream-private-warning**: private channel (A+B) → DM (A+C). Modal shows privacy warning naming C. A confirms. C sees the pointer in the DM.
- **E2E-share-cross-stream-private-subset**: private channel (A+B+C) → DM (A+C). No warning (C ⊆ source members). A confirms. C sees the pointer.
- **E2E-share-quote-partial**: A selects text in a message, clicks Share in the selection toolbar, picks a target. Toggle is hidden. Asserts the quote node renders with the selected snippet only.
- **E2E-share-pointer-edit-propagation**: A shares a pointer from channel 1 to channel 2. A edits the source. B in channel 2 sees the updated content without reloading.
- **E2E-share-pointer-delete-tombstone**: A shares a pointer, then deletes the source. B in target sees the tombstone.
- **E2E-share-navigation**: after confirm, the user lands on `/w/{ws}/s/{target}?m={newShareMessageId}` and the new message is in view.

### Frontend component tests (`bun run test`)

Integration-style (INV-39), mounting real components:

- `share-message-modal.test.tsx`: step progression (picker → flavor → privacy), cancel flow, forced-quote mode when opened from a selection, stream filter excludes threads and excludes the current stream.
- `shared-message-view.test.tsx`: renders skeleton → hydrated → edited → deleted states from the `SharedMessagesProvider`.
- `text-selection-quote.test.tsx`: asserts both Quote and Share buttons appear, clicking Share invokes `onShareWithSnippet` with the selected text and correct author attrs.

### Invariant-enforcement tests

- New `shared_messages` table has no foreign keys (INV-1): add to the existing `no-foreign-keys.test.ts` (or equivalent schema-audit test if one exists; otherwise a one-line assertion in `service.test.ts`).
- `flavor` column uses TEXT not ENUM (INV-3): covered by the migration file review; add a comment in the migration referencing INV-3.
- Preview strip (INV-60): assert `stripMarkdownToInline()` on a message containing `ThreaSharedMessage` returns no markdown syntax, only the "Shared a message from …" summary.

## Phasing

Ship in four reviewable slices. Each slice ends with green tests (INV-22) and is independently releasable.

### Slice 1 — Foundations + share-to-parent (pointer)

Smallest end-to-end vertical: thread → parent, pointer flavor, no modal, no privacy check.

- Migration: `shared_messages` table.
- `packages/types`: `ThreaSharedMessage` node spec, `SHARE_FLAVORS` constant.
- Backend feature folder scaffold: `service.ts` with `createShare` that only supports `targetStreamId = source.parentStreamId`.
- Handler: `POST /api/streams/:streamId/messages/share` accepts `sourceMessageId` + `flavor: 'pointer'` only.
- Pointer hydration on message read.
- Frontend: `share-to-parent` action in `message-actions.ts`, pointer NodeView, preview-strip extension.
- E2E: `E2E-share-to-parent`, `E2E-share-pointer-edit-propagation`.

This slice proves the data model, hydration, and outbox invalidation work end-to-end with the simplest UX. Everything after extends surface, not substrate.

### Slice 2 — Share to another stream, pointer only

Adds the picker modal but only supports pointer flavor, and only public-source or already-satisfied privacy (backend still returns `privacy_confirmation_required` but frontend treats it as a hard block for now — no UI yet).

- `ShareMessageModal` step 1 (picker) + step 2 (flavor toggle hidden, pointer-only).
- Handler extended to accept arbitrary targets.
- Access-check functions in backend; same-stream and cross-workspace guards.
- E2E: `E2E-share-cross-stream-public`, `E2E-share-navigation`.

### Slice 3 — Privacy confirmation + quote flavor

- `GET /api/.../share-preview` endpoint.
- Modal step 3 (privacy warning).
- Flavor toggle enabled in modal.
- `ThreaQuoteReply` reused for full-message quote shares.
- E2E: `E2E-share-cross-stream-private-warning`, `E2E-share-cross-stream-private-subset`.

### Slice 4 — Partial-selection share from toolbar

- `text-selection-quote.tsx` gets Share button.
- Modal in forced-quote-with-snippet mode.
- E2E: `E2E-share-quote-partial`.

### Out of slice (follow-ups)

- Mobile text-selection affordance for Share (currently context-menu-only on mobile).
- Thread-as-target support.
- Sharer-provided commentary in-modal (vs. post-send reply) — revisit only if users ask.

## Alternatives Considered

### D-Alt-1: Pre-fill composer on target page instead of send-from-modal

Sketched earlier: modal picks a target, navigates to it, pre-inserts the node into the normal composer. User adds commentary and sends via existing send button.

Rejected in favor of send-from-modal because:

- Requires a transient channel (in-memory store or URL state) to pass the chosen node from modal → target composer.
- Back-button / tab-close during composer edit produces a half-finished share that never lands — confusing UX.
- Target composer may already have a draft; we'd need merge semantics.

If usage data shows users want commentary at share time, revisit by adding an inline commentary textarea inside the modal (below the picker) rather than navigating.

### D-Alt-2: Store a snapshot for pointers instead of live hydration

Rejected: defeats the "pointer" semantic. If we wanted a snapshot, that's just the quote flavor.

### D-Alt-3: No tracking table, just a ProseMirror node

We could skip `shared_messages` entirely and let the node be the sole record. Rejected because:

- Cross-stream access resolution requires a query to find pointers to a given source message (for `message:updated` invalidation). Scanning all `messages.content_json` for node references is prohibitively expensive.
- Analytics ("how often is this message shared?") becomes impossible without scanning all content.

INV-57 already says: don't stash transient workflow state on core domain entities; use tracking tables. This is the same rule applied to durable share grants.

## Open Questions (need user steer before implementation)

1. **Bot / agent messages as source.** Can a user share a bot's reply? Default: yes, same rules (sharer needs read on source, write on target). Confirm nothing special happens — bots don't have "privacy" different from the stream's visibility.
2. **Re-sharing a shared message.** User B sees a pointer in target stream T1 that points to source S1. Can B share the _pointer message_ itself to T2, producing a chain (pointer to pointer)? Default: yes, and we flatten at hydration time — T2 stores a pointer to S1 directly, not to T1's share-message. Simple, avoids chains. Confirm.
3. **Self-scratchpad-only for scratchpad targets (D5) — are there shared scratchpads?** If scratchpads are always 1-owner today, D5 is automatic. If a scratchpad can ever be multi-owner, D5 needs refinement.
4. **Admin removal of shared messages.** If a workspace admin hard-deletes the source, do we want a privileged path to also purge the share rows + share-message rows in targets, vs. leaving tombstones everywhere? Default: tombstones, matching normal delete behavior.
5. **Attribution in target timeline.** Do we want a subtle "shared by @sharer" chip above the share message in the target stream, or is the normal author metadata (the sharer's name as message author, with the pointer/quote node below) enough? Default: normal author metadata only; the node itself visually attributes the original author.

## Invariant References

Invariants directly touched by this work:

- **Persistence / data integrity**: INV-1 (no FKs on `shared_messages`), INV-2 (`share_xxx` ULID), INV-3 (flavor as TEXT), INV-8 (workspace-scoped), INV-17 (append-only migration), INV-20 (no unsafe read-then-write in service), INV-30 (`pool` for single queries), INV-41 (no DB connection held during AI calls — N/A here, no AI), INV-56 (batched hydration), INV-57 (tracking table for share state).
- **Architecture / dependencies**: INV-4 (outbox for realtime), INV-5 (repository pattern for `shared_messages`), INV-6 (service owns the create transaction), INV-7 (event + share-row committed together), INV-34 (thin handler), INV-35 / INV-37 (reuse `eventService.createMessage`), INV-51 (feature colocation under `messaging/sharing/`), INV-52 (barrel exports).
- **API / contracts**: INV-31 (types derived from `SHARE_FLAVORS`), INV-32 (HttpError for errors), INV-33 (constants for flavor names), INV-55 (Zod validation), INV-58 (`contentJson` canonical, markdown only at wire boundary).
- **Frontend / UX**: INV-14 (Shadcn primitives in modal), INV-15 (NodeView stays UI-focused), INV-18 (no nested component definitions in the modal), INV-21 (no layout-shift from warning step — reserve space or use Popover), INV-40 (navigation is a link-style intent after send), INV-53 (bootstrap + resubscribe for pointer invalidations), INV-60 (preview strip extended for share node).
- **Testing**: INV-22 (no dismissed failures), INV-23 (assert specific events, not counts), INV-39 (real-component frontend tests), INV-48 (scoped spy, no `mock.module`).
- **Hygiene**: INV-25 (comments explain why, not change history), INV-36 (no speculative flags — ship the four slices as-designed, don't add feature flags unless we agree).
