# Agentic Companion - Work Notes

**Started**: 2025-12-16
**Branch**: main
**Status**: Complete
**Task Doc**: tasks/002-agentic-companion.md

## Session Log

### 2025-12-16 - Full Implementation

**Context reviewed**:
- Read task doc (002-agentic-companion.md) - comprehensive design for durable agentic pipeline
- Verified Task 001 complete - multi-listener outbox infrastructure exists
- Read openrouter.ts - simple HTTP client (96 lines), replaced by AI SDK
- Checked stream schema - `companion_mode` and `companion_persona_id` fields exist
- Confirmed Ariadne persona seeded in migrations

**Applicable invariants**:
- INV-4 (Outbox for Real-time) - outbox triggers companion jobs
- INV-5 (Repository Pattern) - agent-session-repository follows pattern
- INV-7 (Events + Projections) - agent sessions are persisted state

**Completed all 7 phases**:
- [x] Phase 1: AI SDK + Provider Registry
- [x] Phase 2: pg-boss Setup
- [x] Phase 3: Agent Sessions (migration + repository)
- [x] Phase 4: CompanionListener (outbox listener)
- [x] Phase 5: Companion Agent (simplified from LangGraph)
- [x] Phase 6: CompanionJobWorker
- [x] Phase 7: Stub + Tests

---

## Key Decisions

### AI SDK Provider Package
**Choice**: `@openrouter/ai-sdk-provider` instead of `@ai-sdk/openrouter`
**Rationale**: The `@ai-sdk/` package doesn't exist; OpenRouter provides their own AI SDK compatible package
**Alternatives considered**: `@ai-sdk/openrouter` (doesn't exist)

### Simplified Agent Architecture
**Choice**: Simple `generateText()` with step checkpointing instead of full LangGraph
**Rationale**: LangGraph uses LangChain's model interface which conflicts with AI SDK. A single-turn generation with step recording provides the needed durability without extra complexity. Tools can be added later using AI SDK's native tool support.
**Alternatives considered**: LangGraph (model interface mismatch), LangChain (different provider abstraction)

### Job Handler Array Handling
**Choice**: Wrap single-job handlers in `registerHandler` to iterate over job arrays
**Rationale**: pg-boss v12 passes `Job<T>[]` to handlers, not single jobs. The wrapper maintains the simple `JobHandler<T>` interface while handling the array internally.

### Transaction Boundaries
**Choice**: Separate transactions for session management, agent execution, and message creation
**Rationale**: EventService manages its own transaction. Nesting would cause issues. Session state provides recovery point if any step fails.

---

## Blockers / Open Questions

All resolved:
- [x] Migration number: Used 007 (checked existing migrations)
- [x] pg-boss vs outbox: Outbox dispatches jobs, pg-boss provides durability and retries

---

## Files Created

- `apps/backend/src/lib/ai/provider-registry.ts` - AI provider abstraction
- `apps/backend/src/lib/ai/index.ts` - Exports
- `apps/backend/src/lib/job-queue.ts` - pg-boss wrapper with typed helpers
- `apps/backend/src/lib/companion-listener.ts` - Outbox listener for companion jobs
- `apps/backend/src/repositories/agent-session-repository.ts` - Session CRUD
- `apps/backend/src/repositories/persona-repository.ts` - Persona lookups
- `apps/backend/src/agents/companion-agent.ts` - Agent execution logic
- `apps/backend/src/workers/companion-worker.ts` - Job handler
- `apps/backend/src/workers/companion-worker.stub.ts` - Test stub
- `apps/backend/src/db/migrations/007_agent_sessions.sql` - Session tables

## Files Modified

- `apps/backend/src/server.ts` - Integrated job queue, listeners, workers
- `apps/backend/src/lib/env.ts` - Added AIConfig and useStubCompanion
- `apps/backend/src/services/stream-naming-service.ts` - Uses AI SDK
- `apps/backend/src/lib/id.ts` - Added sessionId(), stepId()

## Files Deleted

- `apps/backend/src/lib/openrouter.ts` - Replaced by AI SDK

---

## Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | AI SDK + Provider Registry | Complete |
| 2 | pg-boss Setup | Complete |
| 3 | Agent Sessions | Complete |
| 4 | CompanionListener | Complete |
| 5 | Companion Agent | Complete |
| 6 | CompanionJobWorker | Complete |
| 7 | Stub + Tests | Complete |

---

## Divergence Report

**PLAN SAID**: Use LangGraph for agent orchestration
**ACTUALLY DID**: Used AI SDK's native `generateText()` with manual step checkpointing
**DIVERGENCE**: Simplified architecture - no LangGraph dependency
**REASON**: LangGraph uses LangChain's model interface which is incompatible with AI SDK providers. The simpler approach provides equivalent durability via session/step tables. Tools can be added later using AI SDK's native tool support.

This divergence is an improvement - fewer dependencies, simpler code, same guarantees.
