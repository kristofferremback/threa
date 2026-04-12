# Improve Memo Generation Quality (Phase 1)

## Context

Threa's GAM (General Agentic Memory) extracts knowledge from conversations into memos. The memo pipeline currently uses `openrouter:openai/gpt-oss-120b` -- a cheap, low-quality model that produces garbage memos in production. PR #333 (now merged) already migrated the *researcher* pathway from the same model to `claude-haiku-4.5` with documented quality + latency wins. That PR's plan file explicitly deferred memorizer quality as "Option H -- separate PR; user wants to focus on it properly." This is that PR.

Three improvements, shipped together:

1. **Model split** -- Haiku 4.5 for classifier, GPT-5 Mini for memorizer
2. **Confidence floor** -- skip memos when classifier confidence < 0.7
3. **Author name resolution** -- message memos currently see "user (3fa8b2c1)" instead of "user (Alice)"

## Changes

### 1. Model split

**`apps/backend/src/features/memos/config.ts`** (line 20)
- Replace `MEMO_MODEL_ID` with two constants:
  ```
  MEMO_CLASSIFIER_MODEL_ID = "openrouter:anthropic/claude-haiku-4.5"
  MEMO_MEMORIZER_MODEL_ID  = "openrouter:openai/gpt-5-mini"
  ```
- Remove stale comment about `AI_MEMO_MODEL` env var override

**`apps/backend/src/features/memos/index.ts`** (line 25)
- Replace `MEMO_MODEL_ID` export with `MEMO_CLASSIFIER_MODEL_ID` and `MEMO_MEMORIZER_MODEL_ID`

**`apps/backend/src/lib/ai/static-config-resolver.ts`** (lines 19, 52-59)
- Update import: `MEMO_CLASSIFIER_MODEL_ID, MEMO_MEMORIZER_MODEL_ID, MEMO_TEMPERATURES`
- Use `MEMO_CLASSIFIER_MODEL_ID` for `COMPONENT_PATHS.MEMO_CLASSIFIER`
- Use `MEMO_MEMORIZER_MODEL_ID` for `COMPONENT_PATHS.MEMO_MEMORIZER`

**`apps/backend/evals/suites/memo-classifier/suite.ts`** (lines 11, ~137)
- Import `MEMO_CLASSIFIER_MODEL_ID` instead of `MEMO_MODEL_ID`
- Use in `defaultPermutations`

**`apps/backend/evals/suites/memorizer/suite.ts`** (lines 19, ~224)
- Import `MEMO_MEMORIZER_MODEL_ID` instead of `MEMO_MODEL_ID`
- Use in `defaultPermutations`

**`apps/backend/src/lib/env.ts`** (lines 14-15, 137)
- Remove dead `memoModel` property from `AIConfig` interface and `createEnv()` -- confirmed zero consumers via grep

### 2. Confidence floor

**`apps/backend/src/features/memos/config.ts`**
- Add `MEMO_GEM_CONFIDENCE_FLOOR = 0.7`

**`apps/backend/src/features/memos/service.ts`** (after line 217, after line 314)
- After classifier returns `isGem: true`, check `confidence < MEMO_GEM_CONFIDENCE_FLOOR`
- If below threshold: `logger.info(...)` with messageId/confidence/threshold, then `continue`
- Apply same check for conversation classification path

**`apps/backend/src/features/memos/index.ts`**
- Export `MEMO_GEM_CONFIDENCE_FLOOR`

### 3. Author name resolution for message memos

**Problem**: `memorizeMessage()` receives a raw `Message` and shows `From: user` with no name. `classifyMessage()` shows `From: user (3fa8b2c1)` -- last 8 chars of a ULID. Conversation memos already get proper names via `MessageFormatter.formatMessages()`.

**`apps/backend/src/features/memos/service.ts`** -- Phase 1 data fetch (lines 155-173)
- The code already calls `UserRepository.findByIds(client, workspaceId, ...)` to get timezones
- Also extract `member.name` into a new `authorNames: Map<string, string>` alongside `authorTimezones`
- Zero additional DB queries -- reuse the existing result set
- Add `authorNames` to `fetchedData` return object

**`apps/backend/src/features/memos/service.ts`** -- Phase 2 message processing (lines 203-268)
- Resolve: `const authorName = fetchedData.authorNames.get(message.authorId) ?? undefined`
- Pass to classifier: `this.classifier.classifyMessage(message, { workspaceId, authorName })`
- Pass to memorizer: `this.memorizer.memorizeMessage({ ..., authorName })`

**`apps/backend/src/features/memos/classifier.ts`** (lines 22-24, 55-83)
- Add `authorName?: string` to `ClassifierContext` interface
- In `classifyMessage()`: use `context.authorName ?? message.authorId.slice(-8)` as the author label in the prompt. No template change needed -- `{{AUTHOR_ID}}` placeholder now receives a name instead of a ULID suffix.

**`apps/backend/src/features/memos/memorizer.ts`** (lines 32-41, 50-91)
- Add `authorName?: string` to `MemorizerContext` interface
- In `memorizeMessage()`: use `context.authorName ?? "Unknown"` as author label

**`apps/backend/src/features/memos/config.ts`** -- prompt template (line 195)
- Change `MEMORIZER_MESSAGE_PROMPT` line from:
  `From: {{AUTHOR_TYPE}}`
  to:
  `From: {{AUTHOR_TYPE}} ({{AUTHOR_NAME}})`
- Add `{{AUTHOR_NAME}}` replacement in `memorizer.ts` line 65

## Implementation order

1. `config.ts` -- model constants, confidence floor constant, prompt template update
2. `index.ts` -- update exports
3. `static-config-resolver.ts` -- use split model constants
4. `classifier.ts` -- accept `authorName` in context
5. `memorizer.ts` -- accept `authorName` in context, use in prompt
6. `service.ts` -- collect author names in Phase 1, pass to classifier/memorizer in Phase 2, add confidence floor checks
7. `env.ts` -- remove dead `memoModel`
8. Eval suites -- update imports to per-component model IDs

## Verification

**Typecheck**: `bun run typecheck` must pass

**Unit tests**: `bun run --cwd apps/backend test` -- existing tests must pass

**Eval comparison** (before merging, to validate model picks):
```bash
cd apps/backend

# Classifier: compare old vs new
bun run evals/run.ts -s memo-classifier \
  -m "openrouter:openai/gpt-oss-120b,openrouter:anthropic/claude-haiku-4.5" -p 2

# Memorizer: compare old vs new
bun run evals/run.ts -s memorizer \
  -m "openrouter:openai/gpt-oss-120b,openrouter:openai/gpt-5-mini" -p 2

# Run with new defaults (after code change)
bun run evals/run.ts -s memo-classifier
bun run evals/run.ts -s memorizer
```

**Eval suite updates**: update eval task functions to pass a synthetic `authorName: "Alex"` so prompts contain realistic data instead of exercising the fallback path.

## Not in this PR

- Kill the single-message memo path (Approach 2) -- architectural, separate PR
- Completeness gating / context windowing (Approach 3) -- depends on boundary extraction changes
- Self-verification / critic pass (Approach 5) -- deferred until we measure quality after model upgrade
- Provenance tracking migration (`generated_with_model`, `generated_with_prompt_version`) -- separate PR, enables backfill
- Backfill script for historical memos -- depends on provenance tracking
