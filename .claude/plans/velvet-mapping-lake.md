# Quote-reply context resolution for Ariadne

## Context

Quote replies are implemented as `quoteReply` ProseMirror atom nodes embedded in `messages.content_json` (`packages/types/src/prosemirror.ts:106`). The node carries `{messageId, streamId, authorId, authorName, actorType, snippet}` — a denormalized excerpt, not a structural DB link (per INV-1, no FKs). When the markdown serializer runs (`packages/prosemirror/src/markdown.ts:80`), the node becomes:

```
> snippet here
>
> — [Author](quote:streamId/messageId/authorId/actorType)
```

This is all Ariadne ever sees today. Both the in-stream history path (`companion/context.ts:167` → `formatMessagesWithTemporal`) and the researcher retrieval path (`researcher.ts:664` → `enrichMessageSearchResults`) feed her messages via `contentMarkdown` only. There is no code that parses the `quote:` URI, no fetch of the referenced message, and no expansion of context. If a user quotes 2 lines of a 40-line message, the other 38 lines are invisible to her — which defeats the point of the feature, since the whole reason to quote is to reply with reference to a prior statement that carries its own surrounding meaning.

The fix is to detect `quoteReply` nodes when assembling Ariadne's prompt context, fetch the full source message(s) recursively (up to 5 precursors), and inline them as `<quoted-source>` blocks alongside the existing snippet. Applies to both paths. No DB migration — all the data already exists in `content_json.attrs.messageId`.

## Approach

### 1. New module: `apps/backend/src/features/agents/quote-resolver.ts`

Two exported functions, colocated for testability but logically separate:

**`resolveQuoteReplies(db, workspaceId, input)`** — BFS walker that returns a `Map<messageId, Message>` of all resolved precursors.

```ts
export interface ResolveQuoteRepliesInput {
  seedMessages: Message[]              // caller already has these; not re-fetched
  accessibleStreamIds: Set<string>     // cross-stream access filter
  maxDepth?: number                    // default 5 (per user spec)
  maxTotalResolved?: number            // default 100, DoS cap across all levels
}

export interface ResolveQuoteRepliesResult {
  resolved: Map<string, Message>       // precursorId -> full Message
  authorNames: Map<string, string>     // batch-resolved for all resolved messages
}

export async function resolveQuoteReplies(
  db: Querier,
  workspaceId: string,
  input: ResolveQuoteRepliesInput
): Promise<ResolveQuoteRepliesResult>
```

Algorithm:
1. `visited = new Set<string>(seedMessages.map(m => m.id))` — seeded **before** level-0 walking so adjacent history messages quoting each other aren't re-fetched as duplicates.
2. Walk each seed's `contentJson` via a small local `walkJsonNodes` helper; collect each `quoteReply.attrs.messageId` into a frontier, skipping any already in `visited`.
3. Batch-fetch the frontier via a **new** `MessageRepository.findByIdsInStreams(db, ids, accessibleStreamIds)` (see §2). This single SQL already applies workspace scoping (via stream membership), access filtering, and `deleted_at IS NULL` — all three concerns in one query. Defense in depth: even if `quoteReply.attrs.streamId` is hostile client data, it cannot point outside the caller's accessible streams.
4. For each returned message, mark resolved, add its ID to `visited`, walk its `contentJson` to build the next frontier. Stop when frontier is empty, depth reaches `maxDepth`, or `resolved.size` reaches `maxTotalResolved`.
5. Log skipped quotes at debug with `{ messageId, quotedId, reason: "not_accessible" | "not_found" | "cycle" | "depth_cap" | "total_cap" }` — silent skips hide access bugs.
6. After BFS, batch-resolve author names for every resolved message via `UserRepository.findByIds` and `PersonaRepository.findByIds`.

Cycle safety: because `updateContent` mutates in place (`repository.ts:264`), edit-induced cycles (A→B, then A is edited to quote itself, or A→B→A) all resolve to the same message IDs and terminate on the `visited` check.

**`renderMessageWithQuoteContext(message, resolved, authorNames, depth, maxDepth)`** — pure string builder, no DB:

- Starts with `message.contentMarkdown` (the already-serialized base, including the existing `> snippet\n> — [Author](quote:...)` attribution lines — do **not** re-serialize, that would mangle it).
- Walks `message.contentJson` to find `quoteReply` nodes at any nesting.
- For each found `quoteReply.attrs.messageId` that has a hit in `resolved`, appends a `<quoted-source>` block after the base markdown:

  ```
  <quoted-source id="msg_456" author="Bob" streamId="stream_abc" createdAt="2024-01-01T10:00:00.000Z">
  [serializeToMarkdown(resolved.get(msg_456).contentJson), recursively expanded]
  </quoted-source>
  ```

- Recurses on the resolved message's `contentJson` to nest further `<quoted-source>` blocks for deeper precursors, up to `maxDepth`.
- Unresolved quotes are skipped silently in the output (the inline snippet + attribution line still appears, so the model still knows *something* was quoted). The debug log from the resolver captures why.
- XML attribute values go through `escapeXmlAttr` (same helper pattern as `lib/ai/message-formatter.ts:11`).

### 2. `MessageRepository.findByIdsInStreams` (new)

Add to `apps/backend/src/features/messaging/repository.ts` next to `findByIds`:

```ts
async findByIdsInStreams(db: Querier, ids: string[], streamIds: string[]): Promise<Map<string, Message>> {
  if (ids.length === 0 || streamIds.length === 0) return new Map()
  const result = await db.query<MessageRow>(sql`
    SELECT ${sql.raw(SELECT_FIELDS)} FROM messages
    WHERE id = ANY(${ids})
      AND stream_id = ANY(${streamIds})
      AND deleted_at IS NULL
  `)
  // ... same reaction aggregation as findByIds
}
```

Single query, set-based (INV-56), no connection held (INV-30 — caller passes `pool` directly).

### 3. Thread `accessibleStreamIds` through `AgentContext`

Per the Plan agent's critique, duplicating the accessSpec computation in two places is a drift risk. Single source of truth:

- Extend `AgentContext` (`companion/context.ts:34`) with `accessibleStreamIds: Set<string> | null` (null when no `invokingUserId` — bot turn).
- Inside `buildAgentContext`, after `invokingUserId` is determined (line 76) and before `buildStreamContext`, compute:
  ```ts
  let accessibleStreamIds: Set<string> | null = null
  if (invokingUserId) {
    const accessSpec = await computeAgentAccessSpec(db, { stream, invokingUserId })
    const ids = await SearchRepository.getAccessibleStreamsForAgent(db, accessSpec, workspaceId)
    accessibleStreamIds = new Set(ids)
  }
  ```
- `persona-agent.ts:312` stops recomputing; it reads `agentContext.accessibleStreamIds` and builds `workspaceDeps` from it. (Preserves the existing null-on-bot-turn behavior: `workspaceDeps` is still gated on `invokingUserId`.)
- For bot turns (null), quote resolution defaults to `new Set([stream.id])` — expand only within the current stream. Documented asymmetry vs workspace tools (which skip access check entirely on bot turns); the conservative default here is "least surprise" for a feature explicitly about cross-stream references.

### 4. In-stream path integration (`companion/context.ts`)

After `buildStreamContext` populates `streamContext.conversationHistory` (line 104) and after the author-name maps are built (line 147), but **before** `formatMessagesWithTemporal` (line 167):

```ts
const { resolved, authorNames: quotedAuthorNames } = await resolveQuoteReplies(
  db,
  workspaceId,
  {
    seedMessages: streamContext.conversationHistory,
    accessibleStreamIds: accessibleStreamIds ?? new Set([stream.id]),
    maxDepth: 5,
  }
)

// Merge quoted author names into the existing authorNames map for downstream consumers
for (const [id, name] of quotedAuthorNames) authorNames.set(id, name)

// Produce a new conversation history where each message's contentMarkdown is expanded
const expandedHistory = streamContext.conversationHistory.map(m => ({
  ...m,
  contentMarkdown: renderMessageWithQuoteContext(m, resolved, authorNames, 0, 5),
}))
streamContext.conversationHistory = expandedHistory
```

`formatMessagesWithTemporal` is untouched — it still reads `contentMarkdown`, now containing the `<quoted-source>` expansions. This is the minimal-surface integration (INV-35).

### 5. Researcher path integration (`researcher/researcher.ts` + `researcher/context-formatter.ts`)

`EnrichedMessageResult` only carries `content: string`, not `contentJson`. Two surgical changes:

- **Extend `EnrichedMessageResult`** with `quoteContext?: string` (pre-rendered, defaults to undefined).
- **In `WorkspaceAgent.searchMessages`** (`researcher.ts:664`), after `enrichMessageSearchResults` returns, do a single batch fetch to get `contentJson` (the enrichment step doesn't carry it through today, and threading it through would ripple into `SearchRepository`):
  ```ts
  const enriched = await enrichMessageSearchResults(client, workspaceId, [...dedupedResultsById.values()])
  if (enriched.length > 0) {
    const seedMessageMap = await MessageRepository.findByIdsInStreams(
      client, enriched.map(e => e.id), accessibleStreamIds
    )
    const { resolved, authorNames } = await resolveQuoteReplies(client, workspaceId, {
      seedMessages: [...seedMessageMap.values()],
      accessibleStreamIds: new Set(accessibleStreamIds),
      maxDepth: 5,
    })
    // Pre-render quote context per enriched result
    for (const e of enriched) {
      const seed = seedMessageMap.get(e.id)
      if (!seed) continue
      const rendered = renderMessageWithQuoteContext(seed, resolved, mergedAuthorNames, 0, 5)
      // Only set if there's actually expansion (avoids equality with base markdown)
      if (rendered !== seed.contentMarkdown) {
        e.quoteContext = extractAppendedQuotedSourceBlocks(rendered, seed.contentMarkdown)
      }
    }
  }
  ```
  (The extract helper just returns the trailing `<quoted-source>` blocks — the portion the renderer appended beyond `contentMarkdown`. Clean separation so `e.content` stays as the snippet and `e.quoteContext` is the additive block.)
- **In `formatMessagesSection`** (`context-formatter.ts:96`): keep the existing `msg.content.replace(/\s+/g, " ").trim()` collapse untouched for the base line (that's an unrelated concern; deferred). Append `quoteContext` after the collapsed line as a multi-line block if present:
  ```ts
  const quoteBlock = msg.quoteContext ? `\n${msg.quoteContext}` : ""
  return `> **${author}** in _${msg.streamName}_ (${relativeDate}):\n> ${content}${quoteBlock}`
  ```
  The `<quoted-source>` XML wrapper parses fine in any context and is unambiguous to the model.

### 6. Walker helper

Small local function in `quote-resolver.ts`, not exported:

```ts
function walkJsonNodes(node: JSONContent, visit: (node: JSONContent) => void): void {
  visit(node)
  if (!node.content) return
  for (const child of node.content) walkJsonNodes(child, visit)
}
```

If it turns out a second consumer needs this later, it can be promoted to `packages/prosemirror/src/walk.ts`. YAGNI for now.

## Critical files to modify

- `apps/backend/src/features/agents/quote-resolver.ts` (new)
- `apps/backend/src/features/agents/quote-resolver.test.ts` (new)
- `apps/backend/src/features/agents/index.ts` — export the resolver via barrel (INV-52)
- `apps/backend/src/features/messaging/repository.ts` — add `findByIdsInStreams`
- `apps/backend/src/features/agents/companion/context.ts` — compute `accessibleStreamIds`, call resolver, expand history, extend `AgentContext`
- `apps/backend/src/features/agents/persona-agent.ts` — read `accessibleStreamIds` from `agentContext` instead of recomputing (lines 312-316)
- `apps/backend/src/features/agents/researcher/researcher.ts` — extend `searchMessages` to render quote context
- `apps/backend/src/features/agents/researcher/context-formatter.ts` — extend `EnrichedMessageResult` with `quoteContext?: string`; append in `formatMessagesSection`

## Reused utilities

- `MessageRepository.findByIds` (pattern) → cloned as `findByIdsInStreams` in same file
- `computeAgentAccessSpec` (`features/agents/researcher/access-spec.ts`) — already used by `persona-agent.ts:312`
- `SearchRepository.getAccessibleStreamsForAgent` — same
- `UserRepository.findByIds` + `PersonaRepository.findByIds` — for author name batch resolution inside the resolver (same pattern as `context-formatter.ts:171`)
- `serializeToMarkdown` (`packages/prosemirror/src/markdown.ts:49`) — used by the renderer to serialize nested quoted messages
- `escapeXmlAttr` pattern from `lib/ai/message-formatter.ts:11` — duplicate locally in resolver (three lines, not worth a shared util)

## Verification

### Unit tests (`quote-resolver.test.ts`)

Mock `MessageRepository.findByIdsInStreams`, `UserRepository.findByIds`, `PersonaRepository.findByIds` via `spyOn` (same pattern as `message-formatter.test.ts`). Cases:

- Single quote: seed A → quoteReply(B) → resolves B, renders with one `<quoted-source>` block
- Depth chain: A→B→C→D→E→F, maxDepth=5 → resolves B..F, stops before going past F; debug log for depth cap
- Cycle via edit: A→B→A → resolves B once, cycle detected on A
- Self-cycle: A→A (edited) → resolves nothing (self in `visited` from seed), debug log for cycle
- Multiple quotes in one message: A→[B,C] → both resolved, both `<quoted-source>` blocks present
- Adjacent seeds referencing each other: seed [A, B] where A quotes B → B is in `visited` from seeds, not re-fetched (no duplicate rendering)
- Dedup: A quotes B, C quotes B → B fetched once (verify single `findByIdsInStreams` call at level 1 contains only [B])
- Access denied: quoted message's streamId not in `accessibleStreamIds` → `findByIdsInStreams` excludes it → not in `resolved` → inline snippet remains but no `<quoted-source>` block; debug log for not_accessible
- Soft-deleted source: `findByIdsInStreams` filters at SQL → not resolved → debug log for not_found
- `maxTotalResolved` cap: seed with 20 branches each of depth 5 → stops at 100 total; debug log for total_cap
- Renderer XML escape: author name with quotes/brackets is properly escaped

### Integration test (`apps/backend/src/features/agents/companion/context.test.ts` — extend or create)

Mock `buildStreamContext`, `MessageRepository.findById`, `MessageRepository.findByIdsInStreams`, access-spec computation. Build a conversation history where message M (by Alice) contains a `quoteReply` to message Q (by Bob, from a different accessible stream). Assert that the `AgentContext.messages[M_index].content` contains both the original inline snippet AND a `<quoted-source id="Q" author="Bob" ...>` block with Q's full content.

### Manual smoke

Start a dev backend + frontend. In a workspace with at least two streams that the test user can access:
1. Post a multi-paragraph message M1 in stream A.
2. From stream B, quote-reply to a 1-line snippet of M1 and `@ariadne explain this in context of the full original message`.
3. Verify Ariadne's response references content from M1 that was not in the quoted snippet (proves she saw the full source).
4. Repeat with a message in an inaccessible stream (e.g. a DM she's not in) and confirm she falls back to snippet-only reasoning, with a debug log showing `reason: "not_accessible"`.

### Commands

- `bun run test apps/backend/src/features/agents/quote-resolver.test.ts`
- `bun run test apps/backend/src/features/agents/companion/context.test.ts` (if extended)
- `bun run test apps/backend/src/features/messaging/repository.test.ts` (if `findByIdsInStreams` gets unit coverage there)
- `bun run test:e2e` — full regression before PR

## Invariants touched / respected

- **INV-1/INV-8**: No new FKs; workspace scoping enforced via stream-ID join at the query layer (`findByIdsInStreams` filters `stream_id = ANY(streamIds)` where `streamIds` is always workspace-scoped by construction).
- **INV-30/INV-41**: Resolver takes `Querier`, does single batch queries, no connection held through iteration; callers pass `pool` directly.
- **INV-51/INV-52**: New module in `features/agents/`, exported via barrel, imported by both `companion/` and `researcher/` via the barrel.
- **INV-56**: Set-based batch fetches; one query per BFS level, not per-message.
- **INV-36**: Cap `maxDepth` exposed for future tuning; no other speculative config. Debug logging is targeted at access-control correctness, not vanity.

## Non-goals (explicitly deferred)

- Summarization of quoted sources (the user said "we don't have that infra; just pull in the entire conversation at once").
- Multi-line rendering in `formatMessagesSection`'s base line (the `replace(/\s+/g, " ")` collapse stays; quote context is appended as a separate block).
- Promoting `walkJsonNodes` to a shared package (YAGNI until a second consumer exists).
- Extending `SearchRepository` / `RawMessageSearchResult` to carry `contentJson`; the researcher path does one extra batch fetch instead.
