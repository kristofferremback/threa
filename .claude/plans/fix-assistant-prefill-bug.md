# Fix Assistant Prefill Bug

## Goal

Prevent companion supersede reruns from failing against Anthropic models that reject assistant-prefill requests. Edited-message reruns must still reconsider the prior response, but the outgoing provider request must end with a user turn instead of the previous assistant reply.

## What Was Built

### Runtime request normalization

The agent runtime now normalizes the conversation immediately before each model call. If the in-memory conversation ends with an `assistant` or `system` message, it appends a synthetic trailing `user` prompt so the provider sees a valid request shape.

**Files:**
- `apps/backend/src/features/agents/runtime/agent-runtime.ts` - Adds conversation preparation before each `generateTextWithTools` call.

### Reconsideration prompt role changes

Internal reconsideration and revision prompts now enter the runtime conversation as `user` messages instead of `system` messages. This keeps later turns compatible with providers that require the conversation to end with a user message.

**Files:**
- `apps/backend/src/features/agents/runtime/agent-runtime.ts` - Replaces runtime-injected `system` follow-ups with `user` follow-ups.

### Regression coverage

Added a regression test for the supersede-rerun case where history starts as `user -> assistant` and the rerun must bridge that with a trailing user prompt before asking the model to decide between `keep_response` and `send_message`.

**Files:**
- `apps/backend/src/features/agents/runtime/agent-runtime.test.ts` - Covers the edited-message rerun path and preserves existing message-counting assertions.

## Design Decisions

### Fix it in the agent runtime

**Chose:** Normalize the message sequence in `AgentRuntime` instead of adding provider-specific logic higher up the stack.
**Why:** The invalid request is created by runtime loop behavior during reconsideration, so the fix belongs at the point where messages are assembled for each model call.
**Alternatives considered:** Patching only the persona-agent rerun entrypoint would miss later runtime-generated reconsideration turns.

### Use user-role continuation prompts

**Chose:** Convert runtime-injected reconsideration prompts to `user` messages.
**Why:** The provider constraint is about the final conversational turn. Making these prompts user-role preserves their directive effect while keeping each subsequent model request valid.
**Alternatives considered:** Leaving them as `system` and only appending a bridge at the start would still allow later iterations to end with `system`.

## Schema Changes

None.

## What's NOT Included

- No provider-wide adapter changes outside the agent runtime.
- No changes to persona-agent context building or message formatting.
- No new end-to-end test coverage for the full edited-message flow.

## Status

- [x] Normalize runtime conversations before model calls
- [x] Update reconsideration prompts to use user-role follow-ups
- [x] Add regression coverage for supersede reruns
- [x] Run targeted agent tests and backend typecheck
