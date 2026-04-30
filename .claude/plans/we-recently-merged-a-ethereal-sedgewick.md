# Ariadne: lossless message references (forward / quote / resurface attachments)

## Context

PR #442 (commit `6cbae97`, "feat: lossless message copy/paste roundtrip") gave human users three pointer-URL formats inside the markdown wire format:

- `shared-message:streamId/messageId` — `sharedMessage` block (forward)
- `quote:streamId/messageId/authorId/actorType` — `quoteReply` block (quote-reply)
- `attachment:attachmentId` — inline `attachmentReference` (resurface a previously-uploaded file)

When a user creates a message containing these, the backend (`event-service._createMessageTxn`) records `shared_messages` rows for cross-stream pointers and `attachment_references` rows for inline attachment uses, gated by the same access chain as `getDownloadUrl`. The shared `attachments/access.ts` helper even calls out the intent — *"the `attachment_references` projection that makes copy-paste resends and **Ariadne re-surfacings** work."*

Today Ariadne sees attachment/message IDs in her retrieval-tool outputs and (for `discuss-thread`) in her context bag, but she has no instruction to emit pointer URLs and the backend wrapper that turns her markdown into a real `messages` row drops the only piece needed for attachment access to propagate. The result: she has to gesture at sources via plain links instead of inserting a real forward, quote, or attachment card — and when the user copies her response, the asset doesn't come along.

This plan lights up first-class forward / quote / attachment-resurfacing for Ariadne, plus a `describe_memo` tool so she can pull source messages out of a stored memo. Her access scope is the invocation-bounded `AgentAccessSpec` reach (private channel = that channel + public, public channel = public only, DM = participants' intersection, private scratchpad = user-full) — narrower than the invoking user's full access, so there is no leak surface beyond what the user could already surface from this invocation point.

## TL;DR

1. **Backend wiring fix** — extract `attachment:` IDs from Ariadne's parsed markdown and pass them as `attachmentIds` so the existing access check + `attachment_references` insert run. Without this everything else is decorative.
2. **Prompt + context exposure** — surface message/stream/author IDs in the formatted conversation history, document the three pointer formats in the system prompt, carve an exception into `discuss-thread.ts`'s "never paste IDs" rule.
3. **`describe_memo` tool** — small new tool over the existing `MemoExplorerService.getById()`, returns memo abstract + resolved source-message IDs so Ariadne can forward/quote them.

## Slices

- [Slice A — Backend: extract attachment IDs from agent markdown](#slice-a)
- [Slice B — Prompt: expose IDs and teach the three formats](#slice-b)
- [Slice C — `describe_memo` tool over existing memo explorer](#slice-c)
- [Verification](#verification)
- [Out of scope / follow-ups](#out-of-scope)

## Slice A — Backend: extract attachment IDs from agent markdown {#slice-a}

### Problem

`apps/backend/src/server.ts:300-324` is the single adapter that turns Ariadne's `content: string` into an `EventService.createMessage` call. It already does the right thing for two of the three pointer formats:

```ts
const contentMarkdown = normalizeMessage(params.content)
const contentJson = parseMarkdown(contentMarkdown, undefined, toEmoji)
return eventService.createMessage({ ..., contentJson, contentMarkdown, ... })
```

`parseMarkdown` produces `sharedMessage` and `quoteReply` nodes, and `_createMessageTxn` step 7 (`event-service.ts:489`) walks `contentJson` to validate + record share grants — so forwards and cross-stream quotes from Ariadne already work end-to-end.

The gap is `attachment:`. `parseMarkdown` produces `attachmentReference` nodes, but the adapter does **not** pass `attachmentIds`, so:

- Step 1 access check (`event-service.ts:333-387`) is skipped — Ariadne could in principle reference an out-of-scope attachment ID. (In practice she can't see one, but the gate should still run.)
- Step 6b reference insert (`event-service.ts:471-482`) is skipped — no `attachment_references` rows are written.

The second is the user-visible bug: a recipient who has access to Ariadne's *response* stream but not the *source* attachment's stream cannot resolve the download, and copy-pasting Ariadne's message will fail the access check on resend.

### Change

1. New helper in `packages/prosemirror/src/index.ts` (or a new `extractors.ts` next to `markdown.ts`):

   ```ts
   export function collectAttachmentReferenceIds(content: JSONContent): string[]
   ```

   Walks `contentJson` depth-first, returns `attrs.id` of every `attachmentReference` node whose `status === "uploaded"` (skip `uploading`/`error` to mirror the serializer's filter at `markdown.ts:181`). Dedupe while preserving first-seen order.

2. In `apps/backend/src/server.ts:300-324` and the symmetric `editMessage` adapter at `:325-343`, after `parseMarkdown`, call the helper and forward as `attachmentIds`:

   ```ts
   const contentJson = parseMarkdown(contentMarkdown, undefined, toEmoji)
   const attachmentIds = collectAttachmentReferenceIds(contentJson)
   return eventService.createMessage({ ..., contentJson, contentMarkdown, attachmentIds, ... })
   ```

   `_createMessageTxn` step 1 already classifies each ID as `attachmentsToAttach` (when `messageId === null`, never the case for Ariadne) vs `attachmentsToReference` (always, for her), so no further branching is needed. The author-id passed in is the persona id, and `isAttachmentReadableViaShareOrReference` already accepts persona authorship via the same chain.

3. Same call site for `editMessage` so an Ariadne edit that adds an `attachment:` reference also gets recorded. (Symmetry with users.)

### Why this is enough

- `validateAndRecordShares` (step 7) is already wired for Ariadne via `contentJson`. Forwards (`sharedMessage`) and cross-stream quotes (`quoteReply` flavor=`quote`) flow through it.
- Same-stream `quoteReply` writes no DB row by design — purely presentational, identical to user behavior.
- The access check inside step 1 covers the persona just like a user, so emitting an attachment ID outside her scope errors out loudly instead of silently producing a broken pointer.

### Files

- `packages/prosemirror/src/markdown.ts` (or new `extractors.ts`) — add `collectAttachmentReferenceIds`.
- `packages/prosemirror/src/index.ts` — re-export.
- `apps/backend/src/server.ts:300-343` — wire the helper into both `createMessage` and `editMessage` adapters.

## Slice B — Prompt: expose IDs and teach the three formats {#slice-b}

### Problem

Ariadne can't emit a pointer URL she doesn't have the IDs for, and she has no instruction telling her the markdown shape these pointers take. Today:

- `apps/backend/src/features/agents/companion/prompt/message-format.ts` formats conversation history as `(HH:MM) [@name] content` with no message/stream/author IDs. Search-tool outputs *do* include IDs (so she can quote a message she finds via `search_messages`), but she can't quote a message that's already in her conversation context without re-searching for it.
- The context-bag renderer (`context-bag/render.ts`) does emit `[msg_…]` and `[attach_…]` tags inline, but `discuss-thread.ts:44-47` explicitly tells her *"NEVER include them in your user-facing response."* That instruction is currently correct (raw IDs as prose are noise) and must stay — but it needs a carve-out: pointer URLs are the legitimate way to use them.
- `companion/prompt/system-prompt.ts` has no section about forwarding, quoting, or resurfacing.

### Change

1. **Surface IDs in conversation history.** In `formatMessagesWithTemporal` (`message-format.ts:17-72`), prepend each user message with a compact `[msg:<id> stream:<id> author:<id>]` tag before the existing `(HH:MM) [@name]` prefix. Persona/assistant messages get `[msg:<id>]` only so Ariadne can quote her own prior turns. In `formatAttachmentDescription` (`message-format.ts:97-120`), include the attachment id and a deterministic image-index so she can produce `[Image #N](attachment:att_xxx)` matching the canonical serializer at `markdown.ts:185-191`. Number images in conversation order on the emit side; the renderer reads `imageIndex` from node attrs so any consistent numbering roundtrips.

2. **New section in `system-prompt.ts`** appended after `## Responding to Messages` — terse, example-driven, three literal-markdown examples:

   ```text
   ## Referring to messages and attachments

   When citing a specific message or file, prefer a structural reference over a
   paraphrase — recipients can click, copy, and forward your output the same
   way they would a human's.

   - Forward a message (own line):
     `Shared a message from [Author Name](shared-message:stream_xxx/msg_yyy)`

   - Quote a section:
     > the snippet you want to quote, line by line
     >
     > — [Author Name](quote:stream_xxx/msg_yyy/user_zzz/user)
     The trailing segment is the author's actor type (`user` or `persona`).

   - Resurface an attachment by id:
     `[Image #1](attachment:att_xxx)` for images,
     `[filename.pdf](attachment:att_xxx)` for other files.

   IDs come from your conversation context (`[msg:…]`, `[attach:…]` tags),
   from `search_messages` / `search_attachments` results, or from
   `describe_memo`. Never invent IDs — if you don't have one, paraphrase.
   ```

3. **Carve-out in `discuss-thread.ts:44-47`** — replace "NEVER include them in your user-facing response" with prose-by-default plus one sentence: *"The structural pointer formats from the system prompt (`shared-message:`, `quote:`, `attachment:`) are the exception and the preferred way to point at a specific message or file."*

4. **Memo retrieval context** — in `formatRetrievedContext` / `formatMemosSection` (`researcher/context-formatter.ts:83-100`) include the memo id and the resolved `sourceMessageIds` (with their `streamId`s) so a memo Ariadne sees via `workspace_research` immediately gives her quote/forward handles without a follow-up tool call.

### Files

- `apps/backend/src/features/agents/companion/prompt/message-format.ts`
- `apps/backend/src/features/agents/companion/prompt/system-prompt.ts`
- `apps/backend/src/features/agents/context-bag/intents/discuss-thread.ts`
- `apps/backend/src/features/agents/researcher/context-formatter.ts`

## Slice C — `describe_memo` tool over existing memo explorer {#slice-c}

### Problem

Memos already carry `sourceMessageIds: string[]` (`packages/types/src/domain.ts:362-382`) and `MemoExplorerService.getById()` (`apps/backend/src/features/memos/explorer-service.ts:141-165`) already loads them with `loadSourceMessages()` returning `MemoExplorerSourceMessage[]`. Ariadne sees memos today only via `workspace_research`, which returns aggregated context but does not expose the memo id back to her in a way she can address. There is no tool to look one up by id.

### Change

1. New tool `describe_memo` next to the other workspace tools:

   - File: `apps/backend/src/features/agents/tools/describe-memo-tool.ts` (mirroring `get-attachment-tool.ts` shape).
   - Input: `{ memoId: string }`.
   - Deps: `WorkspaceToolDeps` extended with `memoExplorer: MemoExplorerService` (or the underlying `pool` + workspace id; check how `get-attachment-tool` already plumbs `attachmentService` for the pattern to follow).
   - Body: call `memoExplorer.getById(workspaceId, memoId)`, gate by `accessibleStreamIds` (reject if the memo's source stream isn't in scope), return JSON containing memo `id`, `title`, `abstract`, `keyPoints`, `tags`, plus a `sources: { messageId, streamId, authorId, authorName, contentMarkdownPreview, createdAt }[]` array — exactly what Ariadne needs to forward/quote each source.

2. Register it in `apps/backend/src/features/agents/companion/tool-set.ts` and add `DESCRIBE_MEMO` to `AgentToolNames` in `packages/types/src/constants.ts` (mirror the existing `GET_ATTACHMENT` style).

3. Short prompt block in `system-prompt.ts` gated by `isToolEnabled(persona.enabledTools, AgentToolNames.DESCRIBE_MEMO)`, mirroring the `## Getting Attachment Details` section: "use after `workspace_research` surfaces a memo id, when you need the original messages behind a memo."

4. Enable it on Ariadne's built-in persona config (`apps/backend/src/features/agents/built-in-agents.ts`) alongside `WORKSPACE_RESEARCH` / `SEARCH_ATTACHMENTS`.

### Files

- `packages/types/src/constants.ts` — add `DESCRIBE_MEMO` to `AgentToolNames`.
- `apps/backend/src/features/agents/tools/describe-memo-tool.ts` — new tool.
- `apps/backend/src/features/agents/tools/index.ts` — export.
- `apps/backend/src/features/agents/tools/tool-deps.ts` — extend `WorkspaceToolDeps` if `memoExplorer` isn't there.
- `apps/backend/src/features/agents/companion/tool-set.ts` — register.
- `apps/backend/src/features/agents/companion/prompt/system-prompt.ts` — prompt section.
- `apps/backend/src/features/agents/built-in-agents.ts` — enable on Ariadne.
- `apps/backend/src/server.ts` — wire `MemoExplorerService` into the workspace deps factory if not already present.

## Verification {#verification}

Backend (Slice A):

- Unit test for `collectAttachmentReferenceIds` in `packages/prosemirror/src/markdown.test.ts`: doc with two `attachmentReference` nodes inside a paragraph plus one nested in a list item returns all three ids in document order; nodes with `status: "uploading" | "error"` are filtered (mirror serializer at `markdown.ts:181`); duplicates dedup.
- `EventService` integration test (`event-service.test.ts`): persona-authored `createMessage` whose markdown contains `[Image #1](attachment:<id>)` (a) inserts an `attachment_references` row, (b) writes no new ownership on the original `attachments` row, (c) errors loudly when the persona has no read access to the attachment. Existing user-side tests already cover step 1's classification logic — the new tests just confirm Ariadne goes through the same gate.
- Integration test: persona-authored message whose markdown contains the `Shared a message from [...](shared-message:s/m)` literal produces a `shared_messages` row with `flavor='pointer'` and the persona id as `created_by`. Same for cross-stream `quoteReply` with `flavor='quote'`.

Slices B and C:

- Render snapshot test on `formatMessagesWithTemporal` confirming the new ID tags appear and persona messages get only the `[msg:…]` form.
- Tool test for `describe_memo`: returns memo + resolved source messages; rejects ids whose source stream isn't in `accessibleStreamIds`.
- Eval / manual: in a stream with a known image attachment from earlier, ask Ariadne "find the diagram of the deploy pipeline" — verify she emits `[Image #1](attachment:att_xxx)`, the message renders as a thumbnail, and copy-pasting her message into a new composer reconstructs the `attachmentReference` node and resends successfully.
- Manual cross-stream: in `#channel-a`, mention Ariadne and ask her to forward a relevant message from `#scratchpad-x` (where you, the invoker, have access). Verify the response contains a `Shared a message from [...](shared-message:…)` line, the rendered card shows the source preview, and a member of `#channel-a` who is *not* in `#scratchpad-x` can still view the share via the recorded `shared_messages` grant.

Run:

- `bun run test --filter @threa/backend --filter @threa/prosemirror` for the unit + integration coverage.
- `bun run test:e2e -- --grep ariadne` for the manual flows above (add a Playwright spec that mounts a stream with an attachment and exercises the resurfacing path).
- `bun run typecheck` to catch the `WorkspaceToolDeps` / `AgentToolNames` shape changes.

## Out of scope / follow-ups {#out-of-scope}

- **@mentions and #channels from Ariadne.** The parser already accepts them and the renderer already resolves slugs to nodes, but no tool produces them today. Once user-id and slug are surfaced in the conversation history (Slice B already adds `author:user_xxx`), enabling Ariadne to write `@alice` is a one-line prompt-section addition. Defer until there's a concrete use case — currently no one asked.
- **Lossless mobile paste of pointer URLs in Ariadne's responses.** PR #442 reverted the mobile beforeinput handlers; that's user-side and unrelated to whether Ariadne *produces* the formats. No action.
- **`describe_memo` write paths.** This plan exposes memos read-only. Letting Ariadne create or revise memos is a separate, larger discussion (governance, dedup, version semantics).
- **Sourcing extracted `quoteReply` snippets verbatim.** When Ariadne produces a `quote:` block she has to embed the snippet text inline. The serializer already escapes `]` and `\\` (`markdown.ts:94-95`). No backend change needed; just an example in the system-prompt section.
