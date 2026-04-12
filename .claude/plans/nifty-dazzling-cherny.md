# Kill Single-Message Memo Path

## Context

PR #342 (merged) upgraded memo models to GPT-5.4 Nano, added a confidence floor, and resolved author names. This is the next-highest-leverage improvement: removing the single-message memo path entirely.

**Problem:** The current pipeline has two parallel paths. When a user sends a message, the accumulator queues BOTH a `message` item AND a `conversation` item (after boundary extraction). The message path processes the message in isolation — no surrounding context — producing "question without answer" garbage memos. The conversation path naturally groups Q+A but has a `MIN_CONVERSATION_MESSAGES = 2` guard that skips 1-message conversations, so the message path picks up the slack with zero-context memos.

**Solution:** Stop queuing message items. Lower `MIN_CONVERSATION_MESSAGES` to 1 with a 10-minute age gate so standalone knowledge drops still get memoed, but young conversations (waiting for replies) are deferred. Delete all dead code per INV-38.

## Changes

### 1. Stop queuing message items in the accumulator

**`apps/backend/src/features/memos/accumulator-outbox-handler.ts`**

- Remove `handleMessageCreated()` method entirely (lines 121-161)
- Remove the `case "message:created"` from the switch (lines 96-98)
- Remove now-unused imports: `parseMessagePayload`, `AuthorTypes`
- Keep `pendingItemId` (still used by `handleConversationEvent`)

Conversations are queued via `conversation:created` / `conversation:updated` events emitted by boundary extraction, which runs on every `message:created`. No messages are lost.

### 2. Remove message processing from service.ts

**`apps/backend/src/features/memos/service.ts`**

**Phase 1 (data fetch):**
- Remove `messageItemIds` computation and `messages` fetch (lines 122-124)
- Remove message-specific author ID collection (lines 156-161, the loop over `messages.values()`)
- Remove `authorNames` map (line 169, 174) — only used by the message path; conversation path resolves names via `MessageFormatter`
- Remove `messages` and `authorNames` from the returned `fetchedData` object

**Phase 2 (AI processing):**
- Remove entire "Process message items" block (lines 205-289)
- Add age gate to conversation loop: change `MIN_CONVERSATION_MESSAGES` to `MIN_CONVERSATION_MESSAGES = 1` (line 20, now that conversations with 1 message are allowed)
- Add new constant: `MEMO_SINGLE_MESSAGE_AGE_GATE_MS = 10 * 60 * 1000` (10 minutes)
- In the conversation loop (around line 301), replace the existing guard:
  ```typescript
  // Old:
  if (conversation.messageIds.length < MIN_CONVERSATION_MESSAGES) {
    continue
  }

  // New:
  if (conversation.messageIds.length < MIN_CONVERSATION_MESSAGES) {
    continue
  }
  // Defer young single-message conversations — give time for replies to arrive
  if (conversation.messageIds.length === 1) {
    const ageMs = Date.now() - new Date(conversation.lastActivityAt).getTime()
    if (ageMs < MEMO_SINGLE_MESSAGE_AGE_GATE_MS) {
      deferredItemIds.add(item.id)
      logger.debug(
        { conversationId: conversation.id, ageMs, threshold: MEMO_SINGLE_MESSAGE_AGE_GATE_MS },
        "Deferring young single-message conversation"
      )
      continue
    }
  }
  ```
- Add `const deferredItemIds = new Set<string>()` before the conversation loop

**Phase 3 (atomic save):**
- Change `markProcessed` to exclude deferred items:
  ```typescript
  const itemsToMark = fetchedData.pending.filter((p) => !deferredItemIds.has(p.id))
  if (itemsToMark.length > 0) {
    await PendingItemRepository.markProcessed(client, itemsToMark.map((p) => p.id))
  }
  ```
- Keep `StreamStateRepository.markProcessed` call — deferred items get retried on next 5-minute cap cycle
- Update `processed` count in return value to reflect actual processed (not deferred) items

**Deferral lifecycle:** Deferred items stay `processed_at IS NULL`. The batch worker's 5-minute cap interval re-processes the stream. After ~10 minutes, the conversation is old enough and gets processed. Worst case: 2-3 batch cycles before a standalone knowledge drop is memoed.

### 3. Delete dead code from classifier (INV-38)

**`apps/backend/src/features/memos/classifier.ts`**

- Remove `classifyMessage()` method (lines 57-87) — only callsite was service.ts message loop
- Remove `MessageClassification` interface (lines 31-37) — only used by `classifyMessage`
- Remove `authorName` from `ClassifierContext` (line 23) — only used by `classifyMessage`; `classifyConversation` never uses it
- Remove unused imports: `Message` type (not used by `classifyConversation`), `CLASSIFIER_MESSAGE_SYSTEM_PROMPT`, `CLASSIFIER_MESSAGE_PROMPT`, `messageClassificationSchema`

### 4. Delete dead code from memorizer (INV-38)

**`apps/backend/src/features/memos/memorizer.ts`**

- Remove `memorizeMessage()` method (lines 52-95) — only callsite was service.ts message loop
- Remove `authorName` from `MemorizerContext` (line 42) — only used by `memorizeMessage`
- Remove unused imports: `MEMORIZER_MESSAGE_PROMPT`

### 5. Delete dead prompts and schemas from config (INV-38)

**`apps/backend/src/features/memos/config.ts`**

Remove:
- `messageClassificationSchema` and `MessageClassificationOutput` (lines 60-70)
- `CLASSIFIER_MESSAGE_SYSTEM_PROMPT` (lines 108-129)
- `CLASSIFIER_MESSAGE_PROMPT` (lines 154-159)
- `MEMORIZER_MESSAGE_PROMPT` (lines 209-222)

Keep: all conversation-related prompts, schemas, `memoContentSchema`, `getMemorizerSystemPrompt`, `MEMO_GEM_CONFIDENCE_FLOOR`, model constants.

### 6. Update barrel exports

**`apps/backend/src/features/memos/index.ts`**

- Remove `MessageClassification` from type exports (line 18)
- Remove `messageClassificationSchema` from config exports (line 29)

### 7. Delete message-level eval suites (INV-38)

Both eval suites test removed functionality:

- **Delete** `apps/backend/evals/suites/memo-classifier/` directory (suite.ts + cases.ts) — tests `classifyMessage()`
- **Delete** `apps/backend/evals/suites/memorizer/` directory (suite.ts + cases.ts) — tests `memorizeMessage()`
- **Update** `apps/backend/evals/run.ts` — remove imports (lines 16-17) and suite registrations (lines 26-27) for `memoClassifierSuite` and `memorizerSuite`

Conversation-level eval suites are a follow-up concern (INV-36: no speculative features).

### 8. Update config-resolver test

**`apps/backend/src/lib/ai/config-resolver.test.ts`**

- The test references `MEMO_CLASSIFIER` and `MEMO_MEMORIZER` configs — these still exist. No changes expected unless the config resolver itself changes. Verify tests still pass.

## What stays unchanged

| File | Reason |
|------|--------|
| `packages/types/src/constants.ts` | `MEMO_TYPES` and `PENDING_ITEM_TYPES` keep `"message"` for DB compatibility |
| `pending-item-repository.ts` | Type-agnostic; no changes needed |
| `batch-worker.ts` | Dispatches to service which handles filtering |
| `repository.ts` | Keeps `memoType` column for existing memos |
| `explorer-service.ts` | Keeps memo type filter for existing message memos |
| `tests/e2e/memos.test.ts` | Tests read path with inserted memos; `MemoTypes.MESSAGE` still valid |

## Implementation order

1. `config.ts` — remove message schemas and prompts, add `MEMO_SINGLE_MESSAGE_AGE_GATE_MS`
2. `classifier.ts` — remove `classifyMessage`, `MessageClassification`, clean `ClassifierContext`
3. `memorizer.ts` — remove `memorizeMessage`, clean `MemorizerContext`
4. `index.ts` — remove dead exports
5. `accumulator-outbox-handler.ts` — remove `handleMessageCreated`, remove `message:created` case
6. `service.ts` — remove message fetch/processing, lower min to 1, add age gate + deferral
7. Delete eval suites + update registry
8. Run typecheck + tests

## Verification

- `bun run typecheck` must pass
- `bun run --cwd apps/backend test` (unit tests) must pass
- Grep for `classifyMessage`, `memorizeMessage`, `CLASSIFIER_MESSAGE`, `MEMORIZER_MESSAGE_PROMPT` — should only appear in test fixtures or DB data, not production code
- Verify no runtime imports of deleted eval suites

## Risks

1. **Boundary extraction fails** → message never gets a conversation → never gets memoed. Strictly better than garbage single-message memo. Boundary extraction has its own retry infrastructure.
2. **Standalone knowledge drops deferred** → gets memoed after ~10-15 minutes (2-3 batch cycles). Acceptable delay.
3. **Eval coverage gap** → classifier and memorizer evals deleted. Conversation-level evals are a follow-up.
