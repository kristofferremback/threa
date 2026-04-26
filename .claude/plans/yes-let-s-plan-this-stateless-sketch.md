# Plan: ContextBag primitive + "Discuss with Ariadne"

## Context

Today, starting a conversation with Ariadne about an existing thread means either copy-pasting content into a scratchpad or @mentioning her inline, which pollutes the source thread and loses the "private side-conversation" framing. We want a first-class "Discuss with Ariadne" affordance from any message (context-menu action + slash command) that creates a private scratchpad, auto-attaches the source thread as context, and has Ariadne already oriented when the user types their first question.

Rather than bolting thread-reference onto scratchpad entities, this plan introduces a **reusable `ContextBag` primitive**: a typed collection of context references (thread, message, memo, stream, ...) attached to a stream, resolved at each AI turn, with:

- **Shared, access-gated summary cache** keyed by an explicit input manifest
- **Live-follow semantics**: the bag is re-resolved on every turn; edits, deletes, and appends in the referenced content flow through
- **Cache-friendly rendering**: the inline region is append-only so the Anthropic prompt-cache prefix stays stable; mutations are narrated in a volatile "since last turn" delta
- **Intent-driven system prompt**: the intent (`discuss-thread`) drives the prompt template and the per-kind summarize-vs-inline strategy

First consumer is "Discuss with Ariadne" from the message context menu and the `/discuss-with-ariadne` slash command. The primitive is deliberately shaped to support later intents (summarize-stream, explain-selection, ...) and later ref kinds (memo, saved messages, attachments) without revisiting the core.

## Scope — v1

**In:**
- `ContextBag` types in `@threa/types`
- Two new tables: `stream_context_attachments`, `context_summaries`
- Resolver registry in `features/agents/` with a `thread` resolver
- Intent config colocated; first intent is `discuss-thread`
- Integration into `buildStreamContext` — new `resolvedContextBag` on `StreamContext`
- Rendering strategy: stable (append-only) + delta (volatile), with summarize-when-large path using `gpt-5.4-nano`
- Orientation-turn mechanism: new outbox event `stream:created` consumed by `CompanionHandler`
- Frontend entry points: message-context-menu action + `/discuss-with-ariadne` slash command (client-action variant)
- New backend endpoint: `POST /api/workspaces/:workspaceId/streams/with-context` (or extend existing create) accepting an initial bag

**Deferred (fast-follow, not in v1):**
- `cache_control` wiring inside `createAI` — rendering will *already* be cache-friendly; we just don't emit markers yet. Adding them is a narrow follow-up that lights up the caching.
- Additional ref kinds (`memo`, `message`, `stream`, `attachment`)
- Additional intents beyond `discuss-thread`
- "Refresh context" UI chip (live-follow works without it; chip is UX polish)
- "Absorb delta into summary" maintenance job — rendering handles edits/deletes in the delta indefinitely; absorption is an optimization once delta-size becomes a real problem

## Architecture at a glance

Four layers, each independently extensible:

1. **Primitive** — `ContextBag` types + `stream_context_attachments` table + `context_summaries` table (shared, access-gated)
2. **Resolver registry** — one resolver per `ref.kind`, returns `{ rendered, delta, fingerprint }`
3. **Intent config** — template for system prompt + per-kind size/strategy choices
4. **Entry points + pipeline** — message-menu action + slash command → server-side scratchpad create with bag → outbox `stream:created` → companion handler fires orientation job → agent reads bag via `buildStreamContext` on every subsequent turn

## Data model

### Shared types — `packages/types/src/context-bag.ts` (new)

```ts
export const ContextIntents = {
  DISCUSS_THREAD: "discuss-thread",
} as const
export type ContextIntent = typeof ContextIntents[keyof typeof ContextIntents]

export const ContextRefKinds = {
  THREAD: "thread",
} as const
export type ContextRefKind = typeof ContextRefKinds[keyof typeof ContextRefKinds]

// v1 only ships the `thread` kind; discriminated union left open for future kinds
export type ContextRef =
  | {
      kind: typeof ContextRefKinds.THREAD
      streamId: string
      // Optional anchors; omit both = "whole thread, live-follow"
      fromMessageId?: string
      toMessageId?: string
    }

export interface ContextBag {
  intent: ContextIntent
  refs: ContextRef[]
}
```

Exported via `packages/types/src/index.ts` barrel.

### Table — `stream_context_attachments`

```sql
CREATE TABLE stream_context_attachments (
  id                   TEXT PRIMARY KEY,           -- ulid: sca_...
  workspace_id         TEXT NOT NULL,
  stream_id            TEXT NOT NULL,              -- the scratchpad this bag belongs to
  intent               TEXT NOT NULL,              -- ContextIntent
  refs                 JSONB NOT NULL,             -- ContextRef[]
  last_rendered        JSONB,                      -- snapshot from previous turn, NULL before first turn
  created_by           TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sca_stream ON stream_context_attachments (stream_id);
CREATE INDEX idx_sca_workspace ON stream_context_attachments (workspace_id);
```

`last_rendered` shape (updated atomically after each turn renders):
```jsonc
{
  "renderedAt": "2026-04-22T09:31:00Z",
  "items": [
    { "messageId": "msg_abc", "contentFingerprint": "sha256:...", "editedAt": "2026-04-22T09:10:00Z", "deleted": false }
  ],
  "tailMessageId": "msg_xyz"
}
```

No FKs (INV-1). Prefixed ULIDs (INV-2). Workspace-scoped (INV-8). Intent/kind are TEXT + code-level validation, not enums (INV-3). Append-only migration (INV-17). This is workflow/tracking state — lives in its own table rather than on `streams` (INV-57).

### Table — `context_summaries` (shared, access-gated cache)

```sql
CREATE TABLE context_summaries (
  id                   TEXT PRIMARY KEY,            -- ulid: cs_...
  workspace_id         TEXT NOT NULL,
  ref_kind             TEXT NOT NULL,               -- ContextRefKind
  ref_key              TEXT NOT NULL,               -- kind-specific canonical key (e.g. "thread:<streamId>")
  fingerprint          TEXT NOT NULL,               -- hash over inputs manifest
  inputs               JSONB NOT NULL,              -- explicit manifest: [{ messageId, contentFingerprint, editedAt, deleted }]
  summary_text         TEXT NOT NULL,
  model                TEXT NOT NULL,               -- the model id that produced it
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_cs_lookup ON context_summaries (workspace_id, ref_kind, ref_key, fingerprint);
```

- **Shared**: no `user_id` on the row. A cache hit is only returned after the resolver re-verifies the caller can access the underlying ref (workspace membership + stream access). Cache hit without access = behave as miss.
- **Access-gated read order**: `assertCanAccess(ref, user) → lookup(workspace_id, ref_kind, ref_key, fingerprint) → else summarize → insert`.
- **Audit trail**: `inputs` pins down exactly which `(messageId, version)` tuples went into the summary. Any drift in any input produces a different `fingerprint` → cache miss → fresh summary. No silent-drift failure mode.

## Resolver registry + rendering strategy

### Location — `apps/backend/src/features/agents/context-bag/` (new subfolder)

Per INV-51 (feature colocation) and INV-52 (barrel exports):

```
apps/backend/src/features/agents/context-bag/
├── index.ts                       # barrel
├── registry.ts                    # ResolverRegistry, intent registry
├── types.ts                       # internal ResolvedRef, ResolvedBag, Resolver interface
├── repository.ts                  # stream_context_attachments repo
├── summary-repository.ts          # context_summaries repo
├── render.ts                      # stable + delta splitting + cache-friendly assembly
├── summarizer.ts                  # cheap-model summary producer (via createAI)
├── resolvers/
│   └── thread-resolver.ts         # ContextRefKinds.THREAD
└── intents/
    └── discuss-thread.ts          # intent config (prompt template + strategy)
```

The existing `features/agents/context-builder.ts` imports from `./context-bag` to invoke resolution; it does not contain bag logic itself.

### Resolver interface

```ts
export interface Resolver<TRef extends ContextRef = ContextRef> {
  readonly kind: TRef["kind"]
  canonicalKey(ref: TRef): string                                    // e.g. `thread:<streamId>`
  assertAccess(db: Querier, ref: TRef, userId: string, workspaceId: string): Promise<void>
  // Fetch current state of the ref and build the inputs manifest
  fetch(db: Querier, ref: TRef): Promise<{
    items: RenderableMessage[]        // or kind-specific renderable unit
    inputs: SummaryInput[]
    fingerprint: string               // hash over canonical `inputs`
    tailMessageId: string | null
  }>
}
```

Each resolver is a plain object registered in `registry.ts`. `canonicalKey` + `fingerprint` together form the summary-cache key.

### Rendering rule — stable region vs volatile delta

The output of resolution + render is structured so a later `createAI` cache_control step can mark breakpoints cleanly:

```
┌── STABLE (cacheable, append-only across turns) ─────────────┐
│ System prompt (intent preamble + place-of-running)          │
│ [Intent-chosen context body per ref:                        │
│   - small: inlined messages in chronological order          │
│   - large: summary_text (from context_summaries)]           │
│ Appends from prior turns (monotonic; new breakpoint per batch)│
├── VOLATILE (rebuilt each turn) ─────────────────────────────┤
│ "Since last turn:" delta                                    │
│   - N messages appended (only if NOT already in stable)     │
│   - Edits: `msg X (v2): <new> — previously said: <old>`     │
│   - Deletes: `msg Y (deleted) — last said: <old content>`   │
│ Conversation history (Ariadne ↔ user in this scratchpad)    │
│ Current turn                                                │
└──────────────────────────────────────────────────────────────┘
```

Invariant the rendering code must uphold: **the stable region is never mutated for already-rendered content**. If a previously-rendered message was edited, the stable region still shows the old text; the delta carries the new text + "previously said" line. This is what makes the cache prefix byte-stable across turns.

The intent template must include an instruction: *"If a message appears in both the main thread and the 'since last turn' section, treat the delta as authoritative."* Small prompt-engineering cost, large cache payoff.

### Diff computation

After resolver `fetch()`, compare `items` (current) against `last_rendered.items` (previous snapshot):

- **Append**: current has a `messageId` not in previous, and its `sequence > previous.tailMessageId.sequence`.
- **Edit**: `messageId` in both; `contentFingerprint` differs.
- **Delete**: `messageId` in previous, absent from current (or `deleted: true` if soft-deleted with preserved row).

One pass, O(n). Items render into a `delta` string.

After the turn is successfully dispatched, persist the new `last_rendered` snapshot in the same transaction as the outbox write for Ariadne's reply (INV-7: event-source and projection update together).

### Summarization

In `summarizer.ts`. Triggered by the intent config's per-kind strategy: `discuss-thread` says *inline when thread items ≤ N tokens, summarize otherwise* (start with N = 8,000 tokens worth).

Summary call:
- Uses `createAI` (INV-28) with telemetry `{ functionId: "context-bag.summarize", intent, ref_kind }` (INV-19)
- Model: `openrouter:openai/gpt-5.4-nano` from `docs/model-reference.md` (INV-16) — cheapest approved tier, on par with haiku for extraction/summarization tasks in practice
- Prompt requires inline citations in the output like `[msg_abc]` so downstream Ariadne answers can point to specific messages
- Stored in `context_summaries` with the full `inputs` manifest on write

Summary is computed **before** the agent AI call, released from any DB connection first (INV-41). On busy streams the summary call is still a few hundred ms; amortized across all future turns (cache hits until fingerprint drifts).

No "absorb delta into summary" maintenance job in v1. The stable region holds whatever was there at first-render; the delta grows across edits/deletes. When delta size becomes a real cost, add an absorption step as a separate change.

## Backend changes

### 1. Migration — `apps/backend/src/db/migrations/<timestamp>_context_bag.sql` (new)

Creates both tables above. Naming follows the existing convention (`YYYYMMDDHHMMSS_snake_case_description.sql`, see `20251211084312_reactions_table.sql`).

### 2. Shared types — `packages/types/src/context-bag.ts` (new) + barrel export

Per the data-model section.

### 3. Context-bag feature folder — `apps/backend/src/features/agents/context-bag/` (new)

Files per the resolver-registry section. Key points:

- `repository.ts` exposes `ContextBagRepository.findByStream(db, streamId)`, `insert(db, bag)`, `updateLastRendered(db, id, lastRendered)`. Pure data access (INV-5). First arg always `Querier` (INV-30).
- `thread-resolver.ts` uses `MessageRepository.list(db, streamId, ...)` from `features/messaging/repository.ts:213` (already exists; no new method needed). For bounded ranges with `fromMessageId`/`toMessageId`, convert to sequence filters.
- Intent registry is a simple `Map<ContextIntent, IntentConfig>`; `discuss-thread.ts` registers itself at module load.
- All exports via `context-bag/index.ts`; consumers elsewhere import from the barrel (INV-52).

### 4. `context-builder.ts` — integration (modify)

`apps/backend/src/features/agents/context-builder.ts`:

- Extend `StreamContext` (line 105) with an optional field:
  ```ts
  resolvedBag?: {
    intent: ContextIntent
    stable: string              // cache-friendly body (inline or summary)
    delta: string | null        // null on first turn, empty string when no drift
  }
  ```
- In `buildStreamContext` (line 166), after the attachment-enrichment block (after line 206), look up `ContextBagRepository.findByStream(db, stream.id)`. If present:
  1. Load intent config by `bag.intent`.
  2. For each ref, call resolver: `assertAccess`, `fetch`, compute diff against `bag.lastRendered`, render via intent strategy (inline-or-summary for stable, delta string for volatile).
  3. Build `resolvedBag` on the returned `StreamContext`.
  4. Queue a post-turn hook to update `last_rendered` (actual write happens in the same transaction as the agent's reply — passed back out and applied by the caller).
- Keep resolution DB-only. The summary AI call happens inside the resolver's render path but releases the DB connection first (INV-41).

### 5. Persona-agent worker — system-prompt assembly (modify)

The persona-agent worker (consumes `JobQueues.PERSONA_AGENT`; follow imports from `CompanionHandler` in `apps/backend/src/features/agents/companion-outbox-handler.ts:212`) is where `buildStreamContext` is called and the system prompt is built. Where today it merges `streamInfo` + `conversationHistory` into the system prompt, add a branch that — when `resolvedBag` is present — injects the intent preamble + `stable` block as part of the cached prefix, and the `delta` as a volatile section just before the user turn.

### 6. Orientation-turn pipeline — extend `CompanionHandler` (modify)

`apps/backend/src/features/agents/companion-outbox-handler.ts`:

- Today it only handles `event.eventType === "message:created"` (line 99).
- Add a second branch for `event.eventType === "stream:created"`:
  - Parse payload (streamId, createdBy).
  - Fetch stream; require `type === SCRATCHPAD`, `companionMode === ON`.
  - Require a `stream_context_attachments` row for this stream (no bag = no orientation; normal companion-mode scratchpads keep their existing "wait for user message" behavior).
  - Resolve persona via `PersonaRepository` (same as line 155).
  - Dispatch a `PERSONA_AGENT` job with a new `triggerKind: "orientation"` field so the worker knows to generate a kickoff turn instead of replying to a user message.

This means we need to emit `stream:created` on scratchpad creation. Check if it already exists — `StreamService.createScratchpad` currently emits `stream:created` in some form (verify during implementation). If not, add it in the same transaction as the stream insert + bag insert (INV-7).

### 7. Persona-agent worker — orientation trigger handling (modify)

The worker needs to accept the new `triggerKind: "orientation"` job variant. When set:
- Skip the "respond to last user message" path.
- Build context via `buildStreamContext` as normal (the bag is there).
- Prompt intent: produce a short orientation message — what the referenced thread is about, key open questions, invitation to dig in — using the `discuss-thread` intent's orientation template.
- Persist the reply as a normal Ariadne message through the existing reply path.

### 8. Scratchpad creation with initial bag — new endpoint

Add `POST /api/workspaces/:workspaceId/scratchpads/with-context` (or extend the existing scratchpad create path with an optional `contextBag` body field — I'd extend, to avoid route sprawl).

Handler (in `features/streams/`):
1. Validate body with Zod (INV-55): same shape as existing scratchpad create + optional `contextBag: { intent, refs }`.
2. Service call in a transaction (INV-6):
   - `StreamService.createScratchpad(...)` — already supports `companionMode: "on"` + `companionPersonaId` (line 367–395).
   - If bag present: `ContextBagRepository.insert(client, { streamId, ...bag, createdBy })`.
   - Emit `stream:created` outbox event (INV-4, INV-7).
3. Return the new stream + bag id.

Ariadne's persona id is resolved server-side via `PersonaRepository.findBySlug(db, "ariadne")` — the client doesn't send it (keeps Ariadne's id out of client code).

## Frontend changes

### 1. Shared helper — `apps/frontend/src/lib/ariadne/discuss.ts` (new)

One helper used by both entry points:

```ts
export async function startDiscussWithAriadne(args: {
  workspaceId: string
  sourceStreamId: string    // thread or parent stream
  originMessageId?: string  // when invoked from a specific message; not required
  navigate: NavigateFn
}) {
  // POST /api/workspaces/:workspaceId/scratchpads with body:
  // { companionMode: "on", contextBag: { intent: "discuss-thread", refs: [{ kind: "thread", streamId: sourceStreamId }] } }
  // On success → navigate(`/w/${workspaceId}/s/${newStreamId}`)
}
```

One TanStack mutation backs it. Optimistic cache updates for the sidebar stream list follow the existing workspace-sync / sidebar cache pattern (`WorkspaceBootstrap.streams` is `StreamWithPreview[]`, so spread with `{ ...stream, lastMessagePreview: null }` per the `CLAUDE.md` note).

### 2. Message context menu action — `apps/frontend/src/components/timeline/message-actions.ts` (modify)

Add one entry to `messageActions` (after line 105, grouped with other AI-themed actions):

```ts
{
  id: "discuss-with-ariadne",
  label: "Discuss with Ariadne",
  icon: Sparkles,
  when: (ctx) => !!ctx.streamId,       // show everywhere; slash-command does the same on thread composer
  action: async (ctx) => {
    await startDiscussWithAriadne({
      workspaceId: ctx.workspaceId!,
      sourceStreamId: ctx.streamId!,
      originMessageId: ctx.messageId,
      navigate: /* from hook at render site */,
    })
  },
}
```

The `navigate` function is passed in at context-assembly time from `message-context-menu.tsx` (the component already has a hook context and threads callbacks into `MessageActionContext`). Follow the existing mutation-action pattern (e.g. "Save message" at lines 131-136 — `action: (ctx) => ctx.onToggleSave?.()`). Extend `MessageActionContext` with an `onDiscussWithAriadne?: () => Promise<void>` callback wired in the menu component; keeps business logic out of the registry (INV-15).

### 3. Slash command — `/discuss-with-ariadne`

Two pieces of work:

**a. New "client-action" command shape.** Today commands round-trip to the backend (see `apps/frontend/src/components/editor/triggers/command-extension.ts` + `use-command-suggestion.tsx`). We don't want a server round-trip for an action that's purely "open a scratchpad and navigate". Add support for a client-side command in `use-command-suggestion.tsx`:

- Extend the `CommandItem` type with an optional `clientAction?: (ctx: ClientActionContext) => void | Promise<void>`.
- In the select handler, if `clientAction` is defined, invoke it and skip the `slashCommand` node insertion. Otherwise fall through to today's node-insertion path.

**b. Register `discuss-with-ariadne` as a client-action command.** Sourced from workspace bootstrap metadata today (`metadata.commands`, see `use-command-suggestion.tsx:43-55`). Two ways:

- **Preferred**: add it to the bootstrap metadata with a `{ kind: "client-action", id: "discuss-with-ariadne" }` marker, and have the frontend map that id to the helper in `startDiscussWithAriadne`. Keeps server as the source of truth for which commands exist.
- **Alternative**: register it purely client-side in the suggestion list. Simpler but diverges from the "bootstrap-driven commands" pattern.

Go with the preferred path; it keeps the command discoverable from a single source (INV-33: centralize constants).

The slash command's context is the current stream: if the user types it inside a thread, `sourceStreamId` is the thread; inside a channel, the channel. `originMessageId` is omitted. Semantics match the context-menu action in every case.

### 4. Ariadne persona lookup — not needed on client

Client doesn't send `companionPersonaId` (server resolves `ariadne` slug). No frontend persona code changes beyond the existing `useWorkspacePersonas` hook, which is already used elsewhere and needs no modification.

### 5. Icons

`Sparkles` from `lucide-react` is already used for "Show trace and sources" at `message-actions.ts:109`. Reuse it. No new icon.

## Critical files

### Added
- `apps/backend/src/db/migrations/<timestamp>_context_bag.sql`
- `packages/types/src/context-bag.ts` (+ barrel export in `packages/types/src/index.ts`)
- `apps/backend/src/features/agents/context-bag/` (folder, per section above)
- `apps/frontend/src/lib/ariadne/discuss.ts`

### Modified
- `apps/backend/src/features/agents/context-builder.ts` — `StreamContext` field + resolution block in `buildStreamContext` (around line 206)
- `apps/backend/src/features/agents/companion-outbox-handler.ts` — accept `stream:created` event, dispatch orientation job (around line 99)
- `apps/backend/src/features/agents/` persona-agent worker — accept `triggerKind: "orientation"`, inject `resolvedBag.stable` + `.delta` into system prompt
- `apps/backend/src/features/streams/service.ts` — `createScratchpad` accepts optional `contextBag` and emits it + `stream:created` in the same transaction
- `apps/backend/src/routes.ts` — endpoint (extend existing stream-create route; INV-55 Zod validation)
- `apps/frontend/src/components/timeline/message-actions.ts` — new action
- `apps/frontend/src/components/timeline/message-context-menu.tsx` — wire `onDiscussWithAriadne` into `MessageActionContext`
- `apps/frontend/src/components/editor/triggers/use-command-suggestion.tsx` — client-action command support
- Workspace bootstrap command metadata (server-side registration of `discuss-with-ariadne` as client-action)

## Verification

### Unit tests (Bun `bun run test`)
- `context-bag/render.test.ts` — stable-region stability across mutations: given the same `lastRendered`, a second render with edited message X keeps the stable region byte-identical and moves the edit to the delta.
- `context-bag/thread-resolver.test.ts` — fingerprint changes iff any `inputs` entry changes (content, editedAt, deleted).
- `context-bag/summary-repository.test.ts` — access-gated read: miss-when-no-access even if a row with matching fingerprint exists.
- `context-bag/diff.test.ts` — append/edit/delete detection with synthetic `items` + `lastRendered`.
- `companion-outbox-handler.test.ts` — existing tests still pass; new test asserts `stream:created` event with matching bag dispatches a `triggerKind: "orientation"` job, and without a bag dispatches nothing.
- Intent config tests — `discuss-thread.test.ts` covers the inline-vs-summarize threshold branching.

### Integration tests
- `apps/backend/tests/` — end-to-end: create scratchpad with bag → assert Ariadne orientation message posted within N seconds → append a message to source thread → trigger next Ariadne turn → assert delta section includes the appended message and stable region is unchanged.

### E2E (`bun run test:e2e`)
- Playwright: user opens a thread, right-clicks a message, picks "Discuss with Ariadne", asserts navigation to new scratchpad, asserts Ariadne's first message appears, then types a question and asserts reply references the source thread.
- Playwright: user types `/discuss-with-ariadne` in a thread composer, picks the suggestion, same asserts as above.

### Manual
- Open a long thread, trigger "Discuss with Ariadne", confirm Ariadne's orientation message cites specific messages by id-anchor, confirm the scratchpad is private (INV-8 workspace scope respected).
- Edit a message in the source thread, send a follow-up to Ariadne, confirm she notices the edit.
- Delete a message in the source thread, confirm Ariadne acknowledges the deletion in her next turn.

## Tradeoffs and deferred work

- **Prompt caching**: rendering is cache-ready but `createAI` doesn't emit `cache_control` markers yet. A follow-up will add `{ cacheBreakpoints?: CacheBreakpoint[] }` to the `createAI` call options and have the persona-agent worker emit breakpoints at the end of the stable region and after each append batch. Lights up real latency/cost wins with no rendering changes needed.
- **Cost per invocation**: every "Discuss with Ariadne" click spawns one summary call (if thread is large) and one orientation call. Small cost, big UX win. No rate-limiting in v1; add a soft per-user-per-minute guard if abuse shows up.
- **Live-follow vs frozen**: v1 is live-follow. If product feedback says Ariadne should stick to "the thread as it was when I clicked", we can add a `frozen: true` flag on the ref later.
- **Orientation tone**: the `discuss-thread` intent's orientation template must be conservative — summarize neutrally, invite questions, avoid opinions on first turn. Worth a second reviewer pass on the prompt.
- **Single-persona assumption**: the bag is conceptually persona-agnostic. In v1, the endpoint hard-wires Ariadne. A future extension could pass a `personaSlug` and let other personas host discussions using the same primitive.
- **Summary absorption**: deferred. Until delta size becomes a real cost, we keep edits/deletes in the volatile region indefinitely.
