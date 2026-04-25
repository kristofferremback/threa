# Improve Companion Temporal Grounding

## Goal

Make the companion agent reliably understand invocation-time "now" for temporal questions, especially relative date queries, current-events questions, and long-lived conversations where the stream started months before the latest user message.

## What Was Built

### Companion temporal context

The companion prompt now treats the generated Current Time section as the authoritative invocation-time definition of now. The instruction explicitly separates invocation time from the model training cutoff and stream creation time, and tells the model to resolve relative dates silently unless the user asks about time directly.

**Files:**
- `apps/backend/src/lib/temporal.ts` — strengthens Current Time prompt grounding.
- `apps/backend/src/lib/temporal.test.ts` — asserts the new grounding language is present.
- `apps/backend/src/features/agents/companion/prompt/system-prompt.ts` — adds recency guidance for web-search-backed answers.

### Invocation-time plumbing

The companion runtime can now accept a deterministic invocation time for evals/tests, while production continues to default to `new Date()`. The same invocation time flows into temporal context, participant timezone offsets, and web-search tool construction.

**Files:**
- `apps/backend/src/features/agents/persona-agent.ts` — accepts optional `currentTime` and passes temporal context into tools.
- `apps/backend/src/features/agents/companion/context.ts` — passes invocation time into stream context construction.
- `apps/backend/src/features/agents/context-builder.ts` — uses the supplied invocation time for participant UTC offsets.
- `apps/backend/src/features/agents/companion/tool-set.ts` — passes temporal context into `web_search`.

### Web search recency grounding

The `web_search` tool now includes invocation-time guidance in its description and returns `searchedAt` metadata in tool output. This helps the model search with the relevant current year/date for latest, recent, current, and news queries.

**Files:**
- `apps/backend/src/features/agents/tools/web-search-tool.ts` — adds recency hint and `searchedAt`/`timezone` output metadata.
- `apps/backend/src/features/agents/tools/web-search-tool.test.ts` — verifies temporal metadata and description hints.

### Companion temporal evals

The companion eval suite can now set invocation time, user timezone, and historical message timestamps. Three temporal cases cover direct relative-date resolution, long-lived stream recency, and current-news web search.

**Files:**
- `apps/backend/evals/suites/companion/cases.ts` — adds temporal case inputs and expected query checks.
- `apps/backend/evals/suites/companion/evaluators.ts` — adds a web-search query evaluator.
- `apps/backend/evals/suites/companion/suite.ts` — threads eval invocation time into production `PersonaAgent.run()` and resets timezone per case.

### Messaging barrel initialization

The messaging barrel exports metadata schemas before handler exports so public API schema imports can use the feature barrel without hitting initialization order issues.

**Files:**
- `apps/backend/src/features/messaging/index.ts` — reorders metadata exports ahead of handler exports.

## Design Decisions

### Keep time grounding low-noise

**Chose:** Strengthen the existing Current Time section instead of introducing a new agent behavior mode.
**Why:** The agent should reason with time as background context, not talk about time unless asked.
**Alternatives considered:** Adding a separate temporal reasoning prompt block or tool. That would make time overly salient for ordinary responses.

### Use invocation time, not stream time

**Chose:** Define now at each agent invocation and allow evals to override it deterministically.
**Why:** Long-lived conversations must interpret "recent" against the latest user turn, not when the stream was created.
**Alternatives considered:** Deriving now from the trigger message timestamp only. That is less explicit for production and less convenient for evals.

### Ground current-events search at the tool boundary

**Chose:** Pass invocation time into `web_search` and expose it in both tool description and output metadata.
**Why:** Current-events correctness depends on search behavior as much as final response wording.
**Alternatives considered:** Prompt-only web-search guidance. That would not give tool output a timestamp for later reasoning.

## Design Evolution

- **Self-review fix:** The first eval plumbing only updated timezone when a case specified it. That could leak non-default timezones across eval cases sharing the same user. The final version resets the eval user timezone to the case timezone or UTC for every case.

## Schema Changes

None.

## What's NOT Included

- No new database columns or persisted temporal state.
- No new time-resolution tool.
- No frontend changes.
- No attempt to make the companion narrate its temporal reasoning in normal answers.

## Status

- [x] Companion prompt treats now as invocation time.
- [x] Web search receives invocation-time grounding.
- [x] Eval suite covers relative dates, current news, and long-lived streams.
- [x] Targeted tests, backend typecheck, lint, and temporal companion evals passed.
