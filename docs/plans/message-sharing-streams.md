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

The context menu has **two separate entries** — mirroring the existing copy pattern (`Copy message` / `Copy as markdown` / `Copy as text`):

- **"Share"** — pointer flavor.
- **"Share as quote"** — quote flavor (full message).

Both open the same modal; the only difference is which node gets pre-inserted into the target composer.

1. User opens the message context menu (desktop ellipsis / mobile long-press) and clicks **Share** or **Share as quote**.
2. Modal opens: stream picker, scoped to top-level streams the user has access to in the current workspace. Reuses `use-stream-items.tsx` (from quick-switcher) as the data source. Ordering: recently visited first, then alphabetical. The sharer's own scratchpads are pinned at the top under a **"Your scratchpads"** group, followed by a **"+ New scratchpad"** option that creates a fresh scratchpad on selection (see D5).
3. Search box filters live.
4. User selects a target. No flavor toggle in the modal — flavor was already chosen by the context-menu entry.
5. If the share would cross a privacy boundary (see D2 below), a confirmation step appears: "This message is in a private stream. Members of #target-name who aren't in #source-name will be able to see it." with **Cancel** / **Share anyway** buttons.
6. On confirm: navigate to the target stream, pre-insert the chosen share node into the target's **normal composer** (the same editor the user always types in — no editor inside the modal). Focus goes to a new paragraph below the node. User optionally adds commentary and sends via the normal send button.
7. If the user picks the stream they're already viewing: **don't block**. Same pre-fill UX applies — the node is inserted into the current composer and the user can add commentary and send. Skipping the navigation step is a minor UX tweak, not a separate flow.

### F3: Share a partial selection from a message

1. User selects text in a message. The existing floating toolbar (`text-selection-quote.tsx`) today shows **Quote**. We add a second button: **Share**.
2. Clicking Share opens the same modal as F2. The flavor is **implicitly quote-with-snippet** — partial selections are intrinsically frozen excerpts; there is no pointer variant of a partial selection.
3. Picker and privacy step proceed as in F2. After confirm, the target composer receives a `ThreaQuoteReply` node carrying the selected snippet.

### F4: Share from the context menu as a full quote

Triggered by the **"Share as quote"** context-menu entry (see F2). The modal behaves identically to the pointer case; only the node type pre-inserted into the target composer differs (`ThreaQuoteReply` with the full message as the snippet, vs `ThreaSharedMessage`).

### After-share behavior in target stream

- After the modal closes, the user lands on the target stream with the share node already in the composer. Cursor is placed on a new paragraph below the node so commentary reads naturally above or below.
- Sending is a **normal** `createMessage` call from the existing composer — no special client-side send path. The share is just a regular message whose `contentJson` happens to contain a `ThreaSharedMessage` or `ThreaQuoteReply` node plus any commentary paragraphs.
- Backend detects the share node during `createMessage` and writes the `shared_messages` tracking row in the same transaction as the message (see Backend Design). The existing outbox emission (`message:created` / `stream:activity`) carries the new message to the target timeline — INV-4, INV-7.
- Sidebar preview strips the share node to something like "Shared a message from #source-name" (see F-Preview below).

### F-Preview: sidebar / activity preview

- Pointer node strips to: `Shared a message from #{sourceStreamName}` (or `from @{authorName}` when source is a DM).
- Quote node: existing quote strip behavior (already in `StreamItemPreview` / `ActivityPreview`, honoring INV-60). No change needed.
- Commentary text prepended if any, per existing `stripMarkdownToInline()` behavior.

## Design Decisions

### D1: Pointer share grants durable read on the single shared message

When a pointer share is posted to a target stream, target members gain implicit read access to that **one message** — not to the source stream, not to any messages the shared message itself references. This is the whole point of the privacy prompt: once the sharer confirms, they are transferring visibility of that single message to the target audience.

Implications:

- A target member who is not in the source stream sees the live content of the shared message whenever they view the target stream.
- If the source message is later edited, target members see the edit.
- If the source message is deleted, target members see a tombstone (kept; admin hard-delete also leaves tombstones — see Resolved Questions).
- If the **sharer** later loses access to the source (booted from the private channel), the share does **not** retroactively disappear from the target. The share is a durable grant on the single message, orthogonal to the sharer's later membership.
- If the **source stream's visibility** changes later (private → public, public → private), the share still renders. We do not retroactively redact.
- Grants do **not** transit. If the shared message itself contains a pointer to a deeper message, viewers in the target stream do not automatically gain access to that deeper message — they need their own grant on it. See D8 for how this plays out with re-shares.

Rationale: retroactive redaction creates confusing UX ("why did the shared message suddenly vanish?") and requires expensive recomputation. At share time the sharer made a deliberate decision with a clear prompt; that's the consent boundary. Non-transitivity protects against grant-chaining attacks where a transitive model could leak deeply private content via two hops.

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

### D4: Flavor is chosen at the context menu, not in the modal

The context menu has two entries — **Share** (pointer) and **Share as quote** — matching the existing "Copy message / Copy as markdown / Copy as text" pattern. The modal is flavor-agnostic; it only needs a destination.

- Share-to-parent (F1): pointer (one-click, no menu choice).
- Partial-selection share (F3): implicitly quote-with-snippet (no pointer variant makes sense for "just these two words").
- Full-message share from the context menu: user picks by entry.

This keeps the modal narrow (picker + privacy confirm only) and mirrors the established pattern for multi-flavor actions in the codebase.

### D5: Scratchpad targets — own existing scratchpads + "New scratchpad"

The picker's scratchpad section includes:

- The sharer's existing scratchpads (never someone else's).
- A **"+ New scratchpad"** affordance at the bottom of the scratchpad group.

Selecting "+ New scratchpad" calls the existing scratchpad-creation path (it creates a regular empty scratchpad whose name can be edited later, or is auto-named e.g. `Saved from #channel-name · Apr 23`), receives the new stream ID, and proceeds through the share flow against that new stream as the target. Net effect: the user gets a fresh scratchpad seeded with the shared message and any commentary they add.

Rationale: the "save to scratchpad" gesture should work even when the user hasn't pre-created a target. Scratchpads are cheap to create (single-user, no membership overhead) and this pattern mirrors "new file" affordances elsewhere.

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

### D8: Re-shares allowed; grants are scoped per-share, not transitive

A "re-share" is when user B shares a share-message they're seeing (M_T1, which itself contains a pointer to M1) into a new target stream T2. We allow this for now (revisit if usage shows excessive depth).

**The grant pattern is one-hop:**

- Re-sharing M_T1 into T2 grants T2 members read on **M_T1** (the immediate referenced message), not on M1 (the deeper message that M_T1 references).
- A T2 viewer who isn't independently in T1 (or in M1's source stream, or a beneficiary of any other share grant on M1) sees the outer pointer's content (M_T1's text + commentary) but a **private-content placeholder** in place of M_T1's inner pointer.

**Private-content placeholder** — what it reveals and what it doesn't:

- Reveals: that a referenced message exists, the source stream's **kind** (channel / DM / scratchpad), and its **visibility** (private / public).
- Withholds: the referenced message's content, author, source stream name, and source stream membership.

Example placeholder copy: _"This message references content in a private channel you don't have access to."_ (DM/scratchpad variants substitute the kind.)

**Why one-hop, not transitive:**

A transitive model would mean B re-sharing M_T1 implicitly grants T2 members read on M1. That defeats the original sharer's privacy decision: when A first shared M1, A consented to expose it to T1 members, not to "T1 members plus anyone any of them might re-share onward to". The non-transitive rule keeps the consent boundary at exactly one hop, matching D1.

**Implication for backend hydration:**

Pointer hydration becomes recursive (with a depth limit — see Backend Design) and per-viewer access-checked. For each pointer at every depth, the backend decides per viewer whether to return content or a placeholder.

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

The `flavor` value is persisted on the `shared_messages` row. It's derived from the node type during scanning (`'pointer'` for `ThreaSharedMessage`, `'quote'` for cross-stream `ThreaQuoteReply`), not sent as a separate field in the request body. Zod validates the node payloads as part of the existing `createMessage` content validation; no separate share schema is needed.

## Backend Design

### Feature colocation (INV-51, INV-52)

New sub-feature inside the existing `messaging` feature folder, rather than a top-level feature — share is fundamentally a message-create with extra bookkeeping:

```
apps/backend/src/features/messaging/sharing/
  handlers.ts              # GET share-preview
  service.ts               # ShareService — validate share-nodes, record tracking rows
  repository.ts            # shared_messages CRUD + hydration queries
  access-check.ts          # Pure functions for "crosses privacy?" / "subset?" checks
  outbox-handler.ts        # Handle message:updated → emit pointer:invalidated
  index.ts                 # Barrel (INV-52)
  __tests__/
    service.test.ts
    access-check.test.ts
    handlers.test.ts
```

The share service is **called from inside** the existing `MessageEventService.createMessage` transaction — it does not create messages itself. The existing create-message path stays the single write path for messages (INV-35, INV-37).

### API surface

Since the share flow reuses the normal composer + send path, there is **no new `POST messages/share` endpoint**. The existing `createMessage` handler becomes share-aware. One new read endpoint is added for the privacy-preview step:

- `GET /api/streams/:sourceStreamId/messages/:messageId/share-preview?targetStreamId=...` — returns `{ privacyWarning: { triggered: boolean, exposedUserCount: number, targetName: string } }`. Called by the modal before it navigates the user to the target composer. Pure read; no side effects.

- `POST /api/streams/:streamId/messages` (existing, extended) — the body's `contentJson` may now contain `ThreaSharedMessage` or `ThreaQuoteReply` nodes whose `streamId` differs from the current stream. Backend detects these nodes during create, runs the share validations, and writes the `shared_messages` row in the same transaction. The request body gains one optional field:

  ```ts
  confirmedPrivacyWarning: z.boolean().optional()
  ```

  The frontend sets this to `true` when the user clicked "Share anyway" in the modal. Backend requires it when the share-node crosses a privacy boundary; otherwise rejects with `HttpError(409, 'privacy_confirmation_required')` — which in normal flow never reaches the user because the modal already asked.

Handlers stay thin (INV-34): `createMessage` delegates to its existing service, which calls the new `ShareService.validateAndRecordShares` helper as a step in the transaction. Errors throw `HttpError` (INV-32).

### `ShareService.validateAndRecordShares`

Called from inside the existing `MessageEventService.createMessage` transaction, before the outbox event is written. Flow:

1. Scan `contentJson` for `ThreaSharedMessage` and `ThreaQuoteReply` nodes whose `streamId` is different from the target stream. (Same-stream `ThreaQuoteReply` is the existing in-stream quote-reply behavior — not a share.)
2. For each share-node:
   - Load source message + source stream (single batched read per `createMessage` call — INV-56). Verify the sharer has read access (`stream_members` or public visibility).
   - If source and target streams are in different workspaces → `HttpError(400, 'cross_workspace_share_forbidden')` (INV-8).
   - Compute privacy-warning state via `access-check.ts::crossesPrivacyBoundary(sourceStreamId, targetStreamId, tx)`.
   - If warning would trigger and `confirmedPrivacyWarning !== true` → `HttpError(409, 'privacy_confirmation_required')`.
3. Insert one `shared_messages` row per share-node in the same transaction as the message's event row. This preserves INV-7 (event-source + projection committed together) — the share-grant row is the access-projection for pointer renders.

Same-stream shares (user picks the stream they're already in) are **allowed** — no guard. Cross-workspace is blocked. Write-access to the target is already enforced by the existing `createMessage` auth check (the sharer is posting into the target as themselves), so no extra check is needed here.

Single-query helpers use `pool` directly (INV-30). All the above runs inside the existing `withTransaction` scope opened by `MessageEventService.createMessage`.

### Pointer hydration on message fetch

When the frontend fetches messages for a stream, the backend resolves any `ThreaSharedMessage` nodes in `contentJson` into current source-message content. Hydration is **recursive** (chains supported per D8) with a hard depth cap, and **per-viewer access-checked** at every level.

**Algorithm** — for a stream-read request by viewer V:

1. Compute V's access set once at the start of the request:
   - `viewerStreams` — stream ids V is a member of (single query: `SELECT stream_id FROM stream_members WHERE user_id = $V AND workspace_id = $ws`).
2. Collect the set of pointer-referenced message ids from the top-level batch (`level = 0`).
3. For the current level's id set:
   - Batch-read `messages` and join the share-grant lookup: `SELECT m.id, m.stream_id, m.deleted_at, ..., array_agg(s.target_stream_id) AS share_targets FROM messages m LEFT JOIN shared_messages s ON s.source_message_id = m.id WHERE m.id IN (...) GROUP BY m.id` — single query (INV-56).
   - For each result row: viewer has access iff `m.stream_id ∈ viewerStreams` OR `share_targets ∩ viewerStreams ≠ ∅`.
   - If access: return full hydrated payload (`{ id, content, author, streamId, deletedAt? }`).
   - If no access: return placeholder (`{ private: true, sourceStreamKind: 'channel'|'dm'|'scratchpad', sourceVisibility: 'private'|'public' }`) — see D8.
4. For accessible payloads at this level, scan their `content` for nested `ThreaSharedMessage` nodes; collect their referenced message ids into the next level's set.
5. Increment level. If `level < MAX_HYDRATION_DEPTH` (default 3) and the set is non-empty, loop to step 3.
6. Beyond `MAX_HYDRATION_DEPTH`, render the unresolved pointer as a placeholder labelled `{ truncated: true }` so the renderer can show a "see in source stream" link. Cycles are impossible in practice (a message can't reference one created after itself), but the depth cap also protects against pathological data.

**Response shape**: a sibling map on the response keyed by source message id, e.g. `message.sharedMessages: Record<MessageId, HydratedShare | PlaceholderShare>`. The map is shared across the whole stream-read response (deduped — if the same source message is referenced from multiple places, it's resolved once). The node `contentJson` stays canonical (INV-58); the renderer overlays from the map.

**Tombstones**: if the message exists but `deleted_at IS NOT NULL` AND the viewer has access, return `{ deleted: true, deletedAt }`. If the source message row doesn't exist at all (shouldn't normally happen, defend for it), return `{ missing: true }`.

**Performance**: per request, hydration is `MAX_HYDRATION_DEPTH` rounds of one batched query each. With realistic usage (chains rarely exceed 1–2 hops) this is 1–2 SQL round-trips. Indexes on `messages(id)` (PK) and `shared_messages(source_message_id)` cover the join. No N+1.

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

Extend `apps/frontend/src/components/timeline/message-actions.ts` with three new actions, mirroring the multi-entry copy pattern already established in that file:

- `'share-to-parent'` — fast path. `when()` returns true iff current stream has `parentStreamId` AND parent type ∈ {channel, dm, scratchpad}. Label derived from parent type (`"Share to #{parentName}"`, `"Share to DM"`, `"Share to scratchpad"`). Callback inserts a `ThreaSharedMessage` pointer into the parent stream's composer (no modal, no privacy prompt — parent ⊇ thread by construction) and navigates there.
- `'share'` — pointer flavor. Always visible. Opens `ShareMessageModal` with `flavor='pointer'`.
- `'share-as-quote'` — quote flavor (full message). Always visible. Opens `ShareMessageModal` with `flavor='quote'`.

Extend `MessageActionContext` with `onShare`, `onShareAsQuote`, and `onShareToParent` callbacks — same shape as existing `onQuoteReply` (INV-37, reuse the established context shape).

### Text-selection toolbar

Edit `apps/frontend/src/components/timeline/text-selection-quote.tsx`:

- Add a second button "Share" next to the existing "Quote" button.
- Same selection-extraction logic is reused (snippet + author metadata). The Share button calls a new callback on the quote-reply context (`onShareWithSnippet`) which opens `ShareMessageModal` with `flavor='quote'` and the `snippet` pre-populated. No flavor toggle exists in the modal so there is nothing to hide — the flavor was already pinned by the calling affordance.

Mobile: the existing file already guards with `select-none` on mobile (line 54). Mobile path uses the message context menu's long-press flow — the "Share" / "Share as quote" entries in the context menu. A mobile selection affordance is an out-of-slice follow-up; context menu is enough for this ship.

### `ShareMessageModal`

New component: `apps/frontend/src/components/share/share-message-modal.tsx`. Flavor is a prop on open, never chosen inside the modal.

Structure:

- **Step 1 — Picker**. Search input + grouped list. Data from the existing `use-stream-items` hook, filtered to top-level streams the user belongs to (channels + DMs) plus the sharer's own scratchpads. Groups:
  - **Channels** — channels the sharer is a member of.
  - **Direct messages** — existing DMs.
  - **Your scratchpads** — own scratchpads + a sticky `+ New scratchpad` row at the bottom (D5). Selecting the new-scratchpad row calls the existing scratchpad-creation API, receives the new stream ID, then proceeds as if the user had picked that stream.
  - Reuse Shadcn `Command` primitives (same as quick-switcher) — INV-14.
- **Step 2 — Privacy confirm** (only if backend `share-preview` says warning triggered for the chosen target). Text: `"{n} {people|person} in #{targetName} can't see the source message. Share anyway?"`. Cancel / Share anyway.

State machine: step 1 → optional step 2 → hand-off. Steps that don't apply auto-advance.

**Hand-off to target composer** (instead of send-from-modal):

1. Modal resolves the target stream ID (creating a new scratchpad first if needed).
2. Modal fetches `share-preview` for the chosen target. If the warning triggers and the user has not yet confirmed, show step 2. If the user clicks Cancel, close the modal and stay put.
3. On confirm (or if no warning was needed), modal closes and the frontend:
   - Stores a one-shot draft in a small Zustand/React-Query cache keyed by `targetStreamId`: `{ shareNode, confirmedPrivacyWarning, expiresAt }`.
   - Calls `navigate('/w/{ws}/s/{targetStreamId}')` (INV-40 — navigation is a link-style intent).
4. The target stream page's composer reads the one-shot draft on mount, inserts the share node as the first block, places the cursor on a new paragraph below, and clears the cache. If a draft already exists for that composer, merge by prepending (share node + blank line + existing draft content).
5. The user types optional commentary and sends via the normal send button. The send request includes `confirmedPrivacyWarning: true` if the modal set it. Backend runs `ShareService.validateAndRecordShares` as part of the normal create path.

The one-shot draft is scoped to a single navigation hop; a short TTL (e.g. 5 minutes) guards against stale cache if the user bails mid-flow. If the hand-off cache is empty on mount (e.g. user refreshed before sending), the composer just behaves normally — no ghost shares.

### Pointer NodeView

New component: `apps/frontend/src/components/editor/shared-message-view.tsx`.

Mirrors `quote-reply-view.tsx` in layout (author row + body + source-stream link) but renders **live** content from the hydrated payload provided by the backend. Reads from a new React context (`SharedMessagesProvider`) populated from the `message.sharedMessages` sibling field on each fetched message (see backend hydration).

States:

- Normal: author + live content (truncated with "See more" beyond 3 lines / 200 chars, matching the quote view's convention).
- Deleted: "[Message deleted by author]" with muted styling.
- Missing (edge case): "[Message no longer available]".
- **Private (no access)** — viewer hit a pointer they don't have a grant on (per D8 nested re-share rule). Render a muted, content-less stub showing only the source stream **kind** + **visibility**, e.g. _"This message references content in a private channel you don't have access to."_ Variants for DM and scratchpad. No author, no source stream name, no body. Not navigable (the stream link would also be inaccessible).
- **Truncated (depth cap reached)**: viewer has access but hydration stopped at `MAX_HYDRATION_DEPTH`. Render a "Open in source stream" link (which the viewer _can_ follow, since they have access). Same visual treatment as a normal pointer, minus the inline body.
- Not yet hydrated (first paint): skeleton placeholder with author name/avatar from the node's cached attrs so the user sees _something_ on first paint.

For accessible states, clicking the body navigates to the source stream + message (same URL pattern used elsewhere: `/w/{ws}/s/{sourceStreamId}?m={sourceMessageId}`). For the Private state, the body is non-interactive. Buttons for actions; links for navigation (INV-40).

### Composer pre-fill is the chosen send path

The modal is a picker + privacy-confirm only. Once the user confirms, the share node is inserted into the **target stream's normal composer** via the one-shot hand-off cache described above. The user sends via the same editor and same send button they always use — no second "editor inside a modal" is introduced. This matches the user-stated goal of "avoid many editors" and keeps the number of text-entry surfaces at exactly one per stream.

Alternative considered and rejected: send immediately from the modal, navigate to the already-posted message. See `D-Alt-1` below.

### Realtime: handling `pointer:invalidated`

In the existing socket subscription layer, add a handler for the `pointer:invalidated` event. On receipt:

- Look up which cached messages reference the invalidated `sourceMessageId` (iterate the current stream's message cache — cheap, stream caches are bounded).
- Call TanStack Query `invalidateQueries` for the affected stream's message list, or patch the `sharedMessages` side-map directly with a re-fetch of just the affected source-message IDs.

This pairs with a bootstrap-on-resubscribe refetch of pointers (INV-53) so we don't miss invalidations across reconnects.

### Markdown strip for previews (INV-60)

Extend `stripMarkdownToInline()` and `truncateContent()` to recognize:

- `ThreaSharedMessage` node → "Shared a message from #{sourceStreamName}" (or `@{authorName}` for DM sources). Source stream name is read from the node's cached attrs, which the sharer always has access to (the sharer was a member at share time). For sidebar previews of share-messages the **viewer** doesn't have access to the inner pointer's source — fall back to the type-only label "Shared a private message" without naming the source stream. Source-name leak avoidance matches D8.
- `ThreaQuoteReply` — already handled.

Sidebar and activity-feed previews must route through these helpers (already the case per INV-60; we extend the helpers, not the call sites).

## Testing Strategy

### Backend unit / integration (`bun run test`)

In `apps/backend/src/features/messaging/sharing/__tests__/`:

- `access-check.test.ts` — pure-function tests for `crossesPrivacyBoundary` and `isSubsetMembership`:
  - Public source + any target → not triggered.
  - Private source, target members ⊆ source members → not triggered.
  - Private source, target has outsiders → triggered with correct `exposedUserCount`.
  - Source = target → no warning (same stream never crosses a boundary).
- `service.test.ts` (exercises `ShareService.validateAndRecordShares` via the real `MessageEventService.createMessage` transaction path):
  - `createMessage` with a `ThreaSharedMessage` node writes `messages` row + `shared_messages` row + outbox `message:created` event in one transaction (INV-7). Drop-connection failure injection mid-transaction asserts rollback leaves nothing behind.
  - Cross-workspace share node → `HttpError(400, 'cross_workspace_share_forbidden')`; nothing written.
  - Same-stream share node → success; `shared_messages` row written, no guard fires.
  - Missing privacy confirmation when required → `HttpError(409, 'privacy_confirmation_required')`; nothing written.
  - `confirmedPrivacyWarning: true` → success.
  - Quote flavor with partial snippet: snippet lands in `ThreaQuoteReply.attrs.snippet`; `shared_messages` row is still written for symmetry/analytics, but render path doesn't need it.
  - Same-stream in-stream `ThreaQuoteReply` (existing quote-reply behavior) does **not** write a `shared_messages` row — the scanner only fires on cross-stream share-nodes.
- `handlers.test.ts`:
  - `GET share-preview` returns warning state correctly for public/private/subset/outsider cases. Zod validation on query params (INV-55).
  - `POST messages` passes through the new `confirmedPrivacyWarning` field to the service.
- Pointer hydration: in `event-service` or a new `message-read.test.ts`:
  - Stream read containing a pointer returns a `sharedMessages` map keyed by `sourceMessageId`. Deleted source → `{ deleted: true, deletedAt }`. Missing source → `{ missing: true }`.
  - Two-hop chain (re-share): viewer who is in T2 only (not T1, not S1) gets full payload for M_T1 and a `{ private: true, sourceStreamKind, sourceVisibility }` placeholder for the inner pointer to M1 (D8). Author and stream name absent from the placeholder.
  - Two-hop chain where viewer is in S1 directly: full payload at every level.
  - Hydration depth cap: a fabricated chain longer than `MAX_HYDRATION_DEPTH` returns `{ truncated: true }` at the cut-off level for accessible viewers.
  - Per-viewer access derives correctly from `stream_members` ∪ `shared_messages.target_stream_id`; a viewer who has neither gets the placeholder.
- Outbox handler: `message:updated` on a message referenced by two pointers in two different target streams emits exactly one `pointer:invalidated` per distinct target stream. Assert specific events, not counts of side effects beyond that (INV-23).

Do not use `mock.module()`; use scoped `spyOn` against namespace imports (INV-48).

### E2E (`bun run test:e2e`)

In `tests/` (cross-app Playwright):

- **E2E-share-to-parent**: two users in a channel + its thread. User A opens a thread message, clicks "Share to #channel". Asserts the message appears in the channel for user B within the realtime window, and the pointer renders live content.
- **E2E-share-cross-stream-public**: public channel → DM. No privacy prompt appears. Target composer receives the pointer node; A adds commentary and sends; asserts the shared message appears for the DM recipient with both commentary and live pointer content.
- **E2E-share-cross-stream-private-warning**: private channel (A+B) → DM (A+C). Modal shows privacy warning naming C. A confirms, adds commentary in the DM composer, sends. C sees the pointer in the DM.
- **E2E-share-cross-stream-private-subset**: private channel (A+B+C) → DM (A+C). No warning (C ⊆ source members). A sends. C sees the pointer.
- **E2E-share-quote-partial**: A selects text in a message, clicks Share in the selection toolbar, picks a target. Asserts the quote node renders with the selected snippet only (no pointer hydration).
- **E2E-share-to-new-scratchpad**: A opens Share, picks "+ New scratchpad" in the picker. Asserts a new scratchpad is created, A is navigated to it, composer contains the pointer node, send posts the message in the new scratchpad.
- **E2E-share-to-same-stream**: A shares a message from channel X while already viewing channel X. Modal closes, current composer receives the pointer node. A adds commentary and sends. Asserts the share appears in channel X as a normal message.
- **E2E-share-rechain-private-placeholder**: Three users A/B/C, three streams: private channel S1 (A only), public channel T1 (A+B), public channel T2 (B+C). A shares M1 from S1 to T1. B re-shares the resulting share-message from T1 to T2. C views T2: sees the outer pointer (M_T1) hydrated normally; sees the inner pointer to M1 as a "this references content in a private channel" placeholder (no author, no stream name). B re-fetches T2: sees full content at every level (B has access via T1 + the original share grant on M1).
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

Smallest end-to-end vertical: thread → parent, pointer flavor, no modal, no privacy check (parent ⊇ thread by construction).

- Migration: `shared_messages` table.
- `packages/types`: `ThreaSharedMessage` node spec, `SHARE_FLAVORS` constant.
- Backend `ShareService.validateAndRecordShares` called from `MessageEventService.createMessage`. Supports only `ThreaSharedMessage` nodes whose `streamId` is an ancestor stream (parent/root) for this slice — no arbitrary targets yet.
- Single-level pointer hydration on message read: the backend emits one `HydratedSharedMessage` per referenced `messageId` (ok / deleted / missing). The recursive / per-viewer / truncated / placeholder flows described in the "Pointer hydration on message fetch" section above (with `MAX_HYDRATION_DEPTH`, re-share placeholders, etc.) **are deferred to Slice 2**; a Slice 1 viewer who can't read the source sees the source-side snippet stored on the node's attrs rather than a server-computed placeholder.
- Outbox subscriber for `message:updated` → `pointer:invalidated`.
- Frontend: `share-to-parent` action in `message-actions.ts`, one-shot hand-off cache, pointer NodeView, preview-strip extension (INV-60).
- E2E: `E2E-share-to-parent`, `E2E-share-pointer-edit-propagation`, `E2E-share-pointer-delete-tombstone`.

This slice proves the data model, hydration, outbox invalidation, and the composer hand-off pattern end-to-end with the simplest UX. Everything after extends surface, not substrate.

### Slice 2 — Share to another stream, pointer only (incl. chain support)

- `ShareMessageModal` with step 1 picker only (no flavor toggle — flavor is a modal prop).
- `'share'` context-menu entry; opens modal with `flavor='pointer'`.
- Backend: scanner accepts arbitrary cross-stream targets; cross-workspace guard fires.
- Access-check helpers (`crossesPrivacyBoundary`, `isSubsetMembership`) but not yet surfaced in the UI — backend still returns `privacy_confirmation_required` and the frontend surfaces it as a blocking toast (temporary) for shares across privacy boundaries.
- **Recursive hydration with per-viewer access checks (D8)**. Pointer-NodeView gains the `Private` and `Truncated` states. This must land in Slice 2 because re-shares become possible the moment cross-stream pointers exist.
- E2E: `E2E-share-cross-stream-public`, `E2E-share-to-same-stream`, `E2E-share-rechain-private-placeholder`.

### Slice 3 — Privacy confirmation + "+ New scratchpad" + quote flavor

- `GET /api/.../share-preview` endpoint.
- Modal step 2 (privacy warning) replaces the blocking toast from slice 2.
- `'share-as-quote'` context-menu entry; opens modal with `flavor='quote'`.
- Picker gains "+ New scratchpad" row (D5).
- `ThreaQuoteReply` reused for full-message cross-stream quote shares (no node-spec change).
- E2E: `E2E-share-cross-stream-private-warning`, `E2E-share-cross-stream-private-subset`, `E2E-share-to-new-scratchpad`.

### Slice 4 — Partial-selection share from toolbar

- `text-selection-quote.tsx` gets Share button next to Quote.
- Opens modal with `flavor='quote'` and `snippet` pre-populated.
- E2E: `E2E-share-quote-partial`.

### Out of slice (follow-ups)

- Mobile text-selection affordance for Share (currently context-menu-only on mobile).
- Thread-as-target support.
- Sharer-provided commentary in-modal (explicitly rejected in this plan; revisit only if users ask).

## Alternatives Considered

### D-Alt-1: Send immediately from the modal

Sketched earlier: the modal would submit the share directly (posting the message in the target stream), then navigate the user to the already-sent message. Commentary would happen as a follow-up reply.

Rejected in favor of composer pre-fill because:

- Introduces a second text-entry surface (the modal would need an inline commentary field to be competitive with the composer-pre-fill flow), violating the user-stated goal of "avoid many editors".
- Commentary-as-a-reply produces two messages in the target timeline where one was intended.
- The one-shot hand-off cache needed for the pre-fill flow is cheap (a single Zustand key with a TTL) and the half-finished-share risk is mitigated by the TTL.

Adopted design: the modal is a picker + privacy-confirm step, and the target stream's normal composer receives the share node on mount.

### D-Alt-2: Store a snapshot for pointers instead of live hydration

Rejected: defeats the "pointer" semantic. If we wanted a snapshot, that's just the quote flavor.

### D-Alt-3: No tracking table, just a ProseMirror node

We could skip `shared_messages` entirely and let the node be the sole record. Rejected because:

- Cross-stream access resolution requires a query to find pointers to a given source message (for `message:updated` invalidation). Scanning all `messages.content_json` for node references is prohibitively expensive.
- Analytics ("how often is this message shared?") becomes impossible without scanning all content.

INV-57 already says: don't stash transient workflow state on core domain entities; use tracking tables. This is the same rule applied to durable share grants.

## Open Questions

None outstanding. Re-open by adding entries here if review surfaces new ambiguities.

## Resolved Questions

**First-round review:**

- **Pointer access semantics** — pointer share grants implicit read on the single shared message to target members (D1).
- **Flavor UX** — two context-menu entries (`Share` / `Share as quote`), mirroring the Copy-\* pattern. Flavor is a modal prop, not a user-chosen toggle inside the modal (D4).
- **Share-to-parent placement** — dedicated action in the context menu, separate from the Share / Share as quote entries.
- **Tombstone policy** — live edits and deletes propagate.
- **Scratchpad targets** — sharer's own scratchpads + a "+ New scratchpad" option that creates a fresh one on selection (D5).
- **Same-stream share** — allowed, same composer hand-off as any other target. Not blocked.
- **Send path** — modal is a picker + privacy confirm only; share node is pre-inserted into the target stream's normal composer. One editor surface per stream.

**Second-round review:**

- **Bot / agent messages as source** — same rules as user messages. No special handling.
- **Re-sharing a shared message** — chains allowed; grants are scoped per-share (one-hop). Viewers without independent access to a deeply-referenced message see a private-content placeholder revealing only stream kind and visibility, not author or stream name (D8).
- **Admin hard-delete of source** — tombstones in the target. No privileged purge path for now.
- **Attribution in target timeline** — normal message-author header (the sharer) plus the embedded share node which visually attributes the original author. No additional "shared by" chip; both attributions are already visible by construction.

## Invariant References

Invariants directly touched by this work:

- **Persistence / data integrity**: INV-1 (no FKs on `shared_messages`), INV-2 (`share_xxx` ULID), INV-3 (flavor as TEXT), INV-8 (workspace-scoped), INV-17 (append-only migration), INV-20 (no unsafe read-then-write in service), INV-30 (`pool` for single queries), INV-41 (no DB connection held during AI calls — N/A here, no AI), INV-56 (batched hydration), INV-57 (tracking table for share state).
- **Architecture / dependencies**: INV-4 (outbox for realtime), INV-5 (repository pattern for `shared_messages`), INV-6 (service owns the create transaction), INV-7 (event + share-row committed together), INV-34 (thin handler), INV-35 / INV-37 (reuse `eventService.createMessage`), INV-51 (feature colocation under `messaging/sharing/`), INV-52 (barrel exports).
- **API / contracts**: INV-31 (types derived from `SHARE_FLAVORS`), INV-32 (HttpError for errors), INV-33 (constants for flavor names), INV-55 (Zod validation), INV-58 (`contentJson` canonical, markdown only at wire boundary).
- **Frontend / UX**: INV-14 (Shadcn primitives in modal), INV-15 (NodeView stays UI-focused), INV-18 (no nested component definitions in the modal), INV-21 (no layout-shift from warning step — reserve space or use Popover), INV-40 (navigation is a link-style intent after send), INV-53 (bootstrap + resubscribe for pointer invalidations), INV-60 (preview strip extended for share node).
- **Testing**: INV-22 (no dismissed failures), INV-23 (assert specific events, not counts), INV-39 (real-component frontend tests), INV-48 (scoped spy, no `mock.module`).
- **Hygiene**: INV-25 (comments explain why, not change history), INV-36 (no speculative flags — ship the four slices as-designed, don't add feature flags unless we agree).
