# Agents Feature Overview

This feature owns persona-driven agent behavior (companion responses, mention invocations, simulation, and session tracing).

## Runtime Flow

1. Outbox listeners dispatch jobs:
   - `companion-outbox-handler.ts` for companion mode
   - `mention-invoke-outbox-handler.ts` for `@persona` mentions
2. Queue worker runs the agent:
   - `persona-agent-worker.ts`
3. Session orchestration and callback wiring:
   - `persona-agent.ts`
4. Graph runtime wiring (tools, model, checkpoints):
   - `companion-runner.ts`
5. Graph loop execution:
   - `companion-graph.ts`
6. Optional workspace retrieval:
   - `researcher/researcher.ts`

## Folder Map

- `companion/`
  - Companion-specific config and extracted prompt/graph helpers
- `researcher/`
  - Workspace retrieval and formatting
- `tools/`
  - Agent tool definitions and tool contracts
- Root `agents/*.ts`
  - Session, repositories, outbox handlers, worker entrypoints

## Primary Entry Points

- `index.ts`: public feature barrel
- `persona-agent.ts`: main orchestration API (`PersonaAgent.run`)
- `companion-runner.ts`: LangGraph response generator
- `companion-graph.ts`: companion state machine

## Guideline For New Code

- Keep one concern per file.
- Prefer extracting helpers to `companion/*` or `researcher/*` instead of growing root hotspot files.
- Keep workers/handlers thin and move business logic into reusable modules.
