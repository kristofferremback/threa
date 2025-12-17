# Agentic Companion - Work Notes

**Started**: 2025-12-16
**Branch**: feature/agentic-companion
**Status**: Complete (PR review feedback addressed)
**Task Doc**: tasks/002-agentic-companion.md

## Session Log

### 2025-12-17 - PR Review Feedback

**Context reviewed**:
- PR #10 received review feedback identifying multiple architectural issues
- Documented learnings as new invariants (INV-9 through INV-12) and lessons learned in CLAUDE.md

**Applicable invariants**:
- INV-9 (No Singletons) - removed singleton pattern from checkpointer
- INV-10 (Self-Describing Dependencies) - renamed ambiguous `apiKey` params
- INV-11 (No Silent Fallbacks) - removed system prompt fallback
- INV-12 (Pass Dependencies, Not Configuration) - pass modelRegistry, not apiKey

**Completed**:
- [x] Deleted `companion-agent.ts` (dead code)
- [x] Consolidated `langchain-provider.ts` into `ProviderRegistry` class
- [x] Renamed `checkpointer.ts` to `postgresql-checkpointer.ts`, removed singleton
- [x] Fixed nested ternary in `companion-graph.ts` (now uses switch)
- [x] Updated `companion-runner.ts` to take `modelRegistry` + `checkpointer` dependencies
- [x] Added `AuthorTypes` constant, used existing `CompanionModes` constant
- [x] Removed system prompt fallback - now throws if persona has no prompt
- [x] Updated `server.ts` to construct checkpointer and pass as dependency
- [x] Updated `companion-worker.ts` and stub to use constants and new deps
- [x] Moved `parseProviderModel` and `isSupportedProvider` into ProviderRegistry class
- [x] Added `getLangChainModel()` method to ProviderRegistry
- [x] Updated PR description to reflect LangGraph architecture

**Key learnings documented**:
1. Extend existing abstractions instead of creating parallel ones
2. Dependencies should be self-describing
3. Pass dependencies, not configuration
4. Delete dead code immediately
5. Avoid nested ternaries
6. Magic strings should be constants or enums

---

### 2025-12-16 - LangGraph Migration

**Context reviewed**:
- Original implementation used AI SDK `generateText()` with manual step checkpointing
- User requested LangGraph for GAM research capability (multi-step agent with tools)
- LangGraph + LangChain dependencies already installed but unused

**Applicable invariants**:
- INV-4 (Outbox for Real-time) - unchanged, outbox still triggers companion jobs
- INV-5 (Repository Pattern) - session repository still used for status tracking

**Completed**:
- [x] Added `@langchain/langgraph-checkpoint-postgres`, `@langchain/openai` dependencies
- [x] Created `langchain-provider.ts` - ChatOpenAI with OpenRouter baseURL
- [x] Created `checkpointer.ts` - LangGraph PostgreSQL checkpointer in `langgraph` schema
- [x] Created `companion-graph.ts` - LangGraph StateGraph with agent/tools nodes
- [x] Created `companion-runner.ts` - Graph compilation and invocation
- [x] Updated `server.ts` - Init checkpointer at startup
- [x] Updated `companion-worker.ts` - Uses `runCompanionGraph` instead of `runCompanionAgent`
- [x] Updated `lib/ai/index.ts` - Added new exports

**Key decision**: Use LangGraph's built-in PostgreSQL checkpointer instead of custom session/step tables. Simpler integration, LangGraph handles durability. Our `agent_sessions` table kept for business logic (status tracking, response message correlation).

---

### 2025-12-16 - Full Implementation (Initial)

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

- `apps/backend/src/lib/ai/provider-registry.ts` - Unified AI SDK + LangChain provider registry
- `apps/backend/src/lib/ai/postgresql-checkpointer.ts` - LangGraph PostgreSQL checkpointer (no singleton)
- `apps/backend/src/lib/ai/index.ts` - Exports
- `apps/backend/src/lib/job-queue.ts` - pg-boss wrapper with typed helpers
- `apps/backend/src/lib/companion-listener.ts` - Outbox listener for companion jobs
- `apps/backend/src/repositories/agent-session-repository.ts` - Session CRUD
- `apps/backend/src/repositories/persona-repository.ts` - Persona lookups
- `apps/backend/src/agents/companion-graph.ts` - LangGraph StateGraph definition
- `apps/backend/src/agents/companion-runner.ts` - Graph compilation and invocation
- `apps/backend/src/workers/companion-worker.ts` - Job handler (uses modelRegistry)
- `apps/backend/src/workers/companion-worker.stub.ts` - Test stub
- `apps/backend/src/db/migrations/007_agent_sessions.sql` - Session tables

## Files Modified

- `apps/backend/src/server.ts` - Job queue, checkpointer creation, dependency injection
- `apps/backend/src/lib/env.ts` - Added AIConfig and useStubCompanion
- `apps/backend/src/lib/constants.ts` - Added AuthorTypes constant
- `apps/backend/src/services/stream-naming-service.ts` - Uses AI SDK via ProviderRegistry
- `apps/backend/src/lib/id.ts` - Added sessionId(), stepId()
- `CLAUDE.md` - Added INV-9 through INV-12, new lessons learned

## Files Deleted

- `apps/backend/src/lib/openrouter.ts` - Replaced by ProviderRegistry
- `apps/backend/src/agents/companion-agent.ts` - Dead code (superseded by LangGraph)
- `apps/backend/src/lib/ai/langchain-provider.ts` - Merged into ProviderRegistry
- `apps/backend/src/lib/ai/checkpointer.ts` - Replaced by postgresql-checkpointer.ts

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

### Initial Implementation (reverted)
**PLAN SAID**: Use LangGraph for agent orchestration
**ACTUALLY DID**: Used AI SDK's native `generateText()` with manual step checkpointing
**DIVERGENCE**: Simplified architecture - no LangGraph dependency
**REASON**: LangGraph uses LangChain's model interface which is incompatible with AI SDK providers.

### LangGraph Migration (current)
**PLAN SAID**: Migrate to LangGraph for GAM research capability
**ACTUALLY DID**: Implemented LangGraph StateGraph with PostgreSQL checkpointer
**DIVERGENCE**: None - followed plan exactly
**APPROACH**: Used LangChain's model providers directly instead of bridging AI SDK. ChatOpenAI with OpenRouter baseURL provides same functionality.
