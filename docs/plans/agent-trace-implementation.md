# Agent Trace Implementation Plan

## Executive Summary

Real-time visibility into AI agent reasoning, tool calls, and sources. The system provides:

1. **Stream Events** - Agent session lifecycle events in the message stream
2. **Socket Room** - Dedicated real-time channel for trace streaming
3. **Trace Modal** - URL-driven modal showing detailed step-by-step execution
4. **Cross-Stream Activity** - "Ariadne is thinking..." on parent messages
5. **Agent Instrumentation** - Step recording via TraceEmitter

**Key Decisions:**

- Keep LangGraph, add trace callbacks (not a rewrite)
- Persist per step, not batch — crash mid-run must not lose progress
- Modal per kitchen sink design
- Subscribe-then-bootstrap pattern for real-time data
- Injectable TraceEmitter — not tied to PersonaAgent, simple API anything can use

---

## Architecture

### TraceEmitter (`apps/backend/src/lib/trace-emitter.ts`)

Injectable service for step lifecycle. Three classes:

```
TraceEmitter → forSession() → SessionTrace → startStep() → ActiveStep → progress() / complete()
```

- **TraceEmitter**: Factory. Holds `io` + `pool`.
- **SessionTrace**: Owns step numbering, session-scoped socket rooms. Methods: `startStep()`, `notifyCompleted()`, `notifyFailed()`.
- **ActiveStep**: Handle for an in-progress step. `progress()` (ephemeral socket), `complete()` (persist + emit).

**Step lifecycle:**

1. `startStep` → INSERT step row (completedAt NULL) + UPDATE session.current_step_type + emit to session room + stream room
2. `progress` → emit to session room only (not persisted)
3. `complete` → UPDATE step row (set completedAt, content, sources, messageId) + emit to session room

**Crash resilience:** Step row exists with `completedAt = NULL` after crash. Frontend sees it as interrupted.

### Socket Events

| Event                          | Room         | Persisted                 | When                          |
| ------------------------------ | ------------ | ------------------------- | ----------------------------- |
| `agent_session:step:started`   | Session room | Yes (INSERT step)         | Step begins                   |
| `agent_session:step:progress`  | Session room | No (ephemeral)            | During step (streaming, etc.) |
| `agent_session:step:completed` | Session room | Yes (UPDATE step)         | Step finishes                 |
| `agent_session:progress`       | Stream room  | No                        | Each step (for timeline card) |
| `agent_session:completed`      | Session room | No (lifecycle via outbox) | Session done                  |
| `agent_session:failed`         | Session room | No (lifecycle via outbox) | Session failed                |

### Frontend Hook (`apps/frontend/src/hooks/use-agent-trace.ts`)

Subscribe-then-bootstrap pattern:

1. Join session room, listen for step events
2. Single API fetch for historical data
3. Merge: realtime steps win on ID collision
4. No polling — socket events are primary, API fetch is bootstrap only

Returns: `{ steps, streamingContent, session, persona, status, isLoading }`

### Session Heartbeat

Periodic heartbeat (15s) during agent work prevents orphan cleanup (60s threshold) from killing active sessions during long AI calls. Implemented in `withSession` Phase 2 with `setInterval` + `finally` cleanup.

---

## What's Done

### Phase 1: Minimal Vertical Slice ✅

- [x] `sessionId` on message_created payload when persona sends
- [x] TraceProvider with URL state (`contexts/trace-context.tsx`)
- [x] TraceDialog fetches session + steps
- [x] TraceStep component with config-colocated rendering (INV-43)
- [x] TraceStepList with scroll-to-highlight
- [x] API endpoint GET `/api/workspaces/:workspaceId/agent-sessions/:sessionId`
- [x] Agent session socket room with auth (`socket.ts`)
- [x] Agent session event types and step types (`packages/types`)
- [x] Database migration for `sources`, `current_step_type`, `message_id` columns
- [x] Repository methods: `insertStep`, `updateStep`, `updateCurrentStepType`, `findStepsBySession`
- [x] Outbox events for session lifecycle
- [x] AgentSessionEvent component for timeline card
- [x] EventList session grouping logic
- [x] useStreamSocket handling for session lifecycle events

### Phase 2: Real-time Step Updates ✅

- [x] TraceEmitter service (injectable, decoupled from PersonaAgent)
- [x] PersonaAgent wired to use TraceEmitter
- [x] useAgentTrace hook with subscribe-then-bootstrap (no polling)
- [x] TraceDialog refactored to use useAgentTrace
- [x] Session room notifications on completed/failed
- [x] Shared socket event payload types (`StepStartedPayload`, etc.)
- [x] Periodic heartbeat (15s) during agent work

---

## What's Left

### Phase 3: Thinking Streaming

See steps appear live while agent is thinking.

1. Hold `ActiveStep` open during LLM call (don't immediately `complete()`)
2. Call `step.progress({ content })` with accumulated tokens (~50ms batches)
3. Frontend renders `streamingContent[stepId]` with cursor animation
4. `step.complete()` on LLM end with final content

The `ActiveStep.progress()` method and `useAgentTrace.streamingContent` are already wired — this phase is about calling them from the LangGraph callbacks.

### Phase 4: Cross-Stream Activity & Polish

"Ariadne is thinking..." on channel messages when agent responds in thread.

1. On step changes, emit `message:updated` with `updateType: "agent_activity"` to parent stream room
2. Bootstrap: query running sessions for child threads on stream load
3. Frontend: merge bootstrap + real-time activity state
4. MessageEvent shows activity indicator with truncation + tooltip
5. Message context menu with action registry ("Show trace and sources", "Copy message", "Reply in thread")
6. AI message clickability (Link to trace URL)

### Phase 5: Testing & Hardening

1. E2E tests for trace modal flow
2. Integration tests for socket room auth
3. Test cross-stream activity updates
4. Performance testing with many steps
5. Error handling edge cases

---

## Key Files

### Backend

| File                                       | Status      | Purpose                                     |
| ------------------------------------------ | ----------- | ------------------------------------------- |
| `lib/trace-emitter.ts`                     | ✅ New      | Injectable step lifecycle service           |
| `agents/persona-agent.ts`                  | ✅ Modified | Uses TraceEmitter, heartbeat in withSession |
| `agents/companion-graph.ts`                | ✅ Modified | recordStep callback interface               |
| `repositories/agent-session-repository.ts` | ✅ Modified | updateStep, updateCurrentStepType           |
| `repositories/outbox-repository.ts`        | ✅ Modified | Session lifecycle event types               |
| `handlers/agent-session-handlers.ts`       | ✅ Modified | GET session + steps endpoint                |
| `server.ts`                                | ✅ Modified | TraceEmitter instantiation                  |
| `socket.ts`                                | ✅ Modified | Agent session room with auth                |

### Frontend

| File                                          | Status      | Purpose                                   |
| --------------------------------------------- | ----------- | ----------------------------------------- |
| `hooks/use-agent-trace.ts`                    | ✅ New      | Subscribe-then-bootstrap for trace dialog |
| `hooks/use-stream-socket.ts`                  | ✅ Modified | Session lifecycle event handling          |
| `components/trace/trace-dialog.tsx`           | ✅ Modified | Uses useAgentTrace hook                   |
| `components/trace/trace-step.tsx`             | ✅ Modified | Config-colocated step rendering           |
| `components/trace/trace-step-list.tsx`        | ✅ Existing | Step list with scroll-to-highlight        |
| `components/timeline/agent-session-event.tsx` | ✅ New      | Timeline card for sessions                |
| `components/timeline/event-list.tsx`          | ✅ Modified | Session grouping logic                    |
| `components/timeline/event-item.tsx`          | ✅ Modified | Session event routing                     |
| `contexts/trace-context.tsx`                  | ✅ Existing | URL state for trace modal                 |

### Shared

| File                                | Status      | Purpose                                   |
| ----------------------------------- | ----------- | ----------------------------------------- |
| `packages/types/src/agent-trace.ts` | ✅ Modified | Step, session, socket payload types       |
| `packages/types/src/constants.ts`   | ✅ Modified | Step types, session statuses, event types |
| `packages/types/src/index.ts`       | ✅ Modified | Re-exports                                |
