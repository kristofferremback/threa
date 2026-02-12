# Companion Agent Structure Plan

## Goal

Make the companion agent easy to understand at a glance and keep files small enough that each file has one clear responsibility.

## Current Runtime Map

Companion and mention invocations currently flow through these modules:

1. Trigger listeners
   - `apps/backend/src/features/agents/companion-outbox-handler.ts`
   - `apps/backend/src/features/agents/mention-invoke-outbox-handler.ts`
2. Queue worker
   - `apps/backend/src/features/agents/persona-agent-worker.ts`
3. Session orchestration + callback wiring + prompt formatting
   - `apps/backend/src/features/agents/persona-agent.ts`
4. Graph runtime wiring (model + tools + callbacks + checkpoints)
   - `apps/backend/src/features/agents/companion-runner.ts`
5. Companion graph state + nodes + routing + helper utilities
   - `apps/backend/src/features/agents/companion-graph.ts`
6. Workspace retrieval loop
   - `apps/backend/src/features/agents/researcher/researcher.ts`

## File Size Snapshot (feature `agents`)

- Total TypeScript LOC: 11,789
- Top 3 files: 4,254 LOC (36.1%)
  - `apps/backend/src/features/agents/persona-agent.ts` (1,630)
  - `apps/backend/src/features/agents/companion-graph.ts` (1,405)
  - `apps/backend/src/features/agents/researcher/researcher.ts` (1,219)
- Top 5 files: 5,308 LOC (45.0%)

This is the core readability problem: too much behavior concentrated in a few files.

## Why It Feels Hard To Navigate

### 1) Companion logic is physically split in a confusing way

There is a `companion/` folder, but most companion runtime logic lives in root-level files (`persona-agent.ts`, `companion-runner.ts`, `companion-graph.ts`).

### 2) Single files mix multiple concerns

- `persona-agent.ts` mixes session lifecycle, context building orchestration, callback construction, attachment retrieval behavior, prompt assembly, and message formatting.
- `companion-graph.ts` mixes graph state schema, node implementations, routing decisions, message truncation policy, tool result parsing, and source aggregation.
- `researcher/researcher.ts` mixes query planning, loop orchestration, search execution, caching conversion, and result shaping.

### 3) Some behavior is duplicated in nearby modules

- Multiple source extraction paths in `companion-graph.ts` (`extractSourcesFromWebSearch`, `extractSearchSources`).
- Similar author enrichment behavior appears in both `persona-agent.ts` and `researcher/context-formatter.ts`.
- Multimodal content block types are duplicated in `companion-graph.ts` and `companion-runner.ts`.

### 4) The feature barrel is broad

`apps/backend/src/features/agents/index.ts` exports many concerns at once, so importers do not get clear sub-domain cues.

## External Pattern References (What Others Usually Do)

- LangGraph documents a small-module layout for agents (`state`, `nodes`, `tools`, `prompts`, `graph`) and recommends subgraphs/orchestrator-worker composition for complex flows.
- OpenAI Agents SDK documents an explicit loop where model output, tool execution, handoffs, memory, and guardrails are distinct concepts.
- AutoGen organizes runtime around explicit team orchestrators (`RoundRobinGroupChat`, selectors, swarm) instead of embedding all orchestration in one agent file.
- Semantic Kernel explicitly separates orchestration strategies (sequential, concurrent, handoff, group chat) from individual agent behavior.

## Target Structure (Proposed)

```text
apps/backend/src/features/agents/
  index.ts

  companion/
    index.ts
    config.ts

    session/
      with-session.ts
      session-events.ts

    prompt/
      system-prompt.ts
      stream-context-sections.ts
      message-format.ts

    callbacks/
      search-callbacks.ts
      attachment-callbacks.ts
      trace-callbacks.ts

    graph/
      index.ts
      state.ts
      routing.ts
      truncation.ts
      sources.ts
      nodes/
        agent-node.ts
        tools-node.ts
        finalize-or-reconsider-node.ts
        check-new-messages-node.ts
        prefetch-workspace-research-node.ts
        synthesize-node.ts
        ensure-response-node.ts

    runtime/
      response-generator.ts
      tool-registry.ts
      graph-invocation.ts

  researcher/
    index.ts
    service.ts
    loop/
      state.ts
      graph.ts
      decide-node.ts
      execute-queries-node.ts
      evaluate-node.ts
    retrieval/
      memo-search.ts
      message-search.ts
      attachment-search.ts
    query/
      query-variants.ts
      baseline-queries.ts
    result/
      sources.ts
      cache-mapping.ts
```

## Suggested LOC Budgets

- Node files: <= 180 LOC
- Helper/mapper files: <= 150 LOC
- Orchestrator files: <= 300 LOC
- Hard warning threshold: 450 LOC

## Migration Plan

### Phase 1: Extract Pure Helpers (low risk)

- Move prompt builders + message formatting out of `persona-agent.ts`.
- Move graph truncation/source helpers out of `companion-graph.ts`.
- Move query variant/baseline builders out of `researcher/researcher.ts`.
- Keep behavior identical and update imports only.

Expected result: large files lose 200-400 LOC each without flow changes.

### Phase 2: Split Callback Construction (medium risk)

- Extract search callback builder from `persona-agent.ts`.
- Extract attachment callback builder from `persona-agent.ts`.
- Extract trace step recording adapter from `persona-agent.ts`.

Expected result: `persona-agent.ts` becomes coordinator-only.

### Phase 3: Split Graph Nodes (medium/high risk)

- Move each node factory from `companion-graph.ts` to `companion/graph/nodes/*`.
- Keep `companion/graph/index.ts` as graph assembly only.
- Add focused unit tests per node module.

Expected result: graph behavior becomes readable by node name and file path.

### Phase 4: Split Researcher Service Internals (medium/high risk)

- Keep `Researcher` class as public entrypoint.
- Extract loop graph creation and retrieval executors into dedicated files.
- Keep cache and formatting contracts stable.

Expected result: `researcher/researcher.ts` reduced to API + high-level orchestration.

### Phase 5: Narrow Barrels + Add Overview Docs (low risk)

- Add sub-barrels (`companion/index.ts`, `researcher/index.ts`, etc.).
- Reduce root barrel noise by re-exporting sub-barrels intentionally.
- Add a compact `agents/README.md` that explains runtime flow and ownership.

## Guardrails To Prevent Regression

1. Add a CI check for per-file LOC thresholds in `apps/backend/src/features/agents/**`.
2. Require new graph nodes to live under `companion/graph/nodes/`.
3. Keep one runtime coordinator per concern:
   - `PersonaAgent` for session orchestration
   - `LangGraphResponseGenerator` for graph execution wiring
   - `Researcher` for retrieval orchestration
4. Prefer extracted modules over adding new sections inside the top three hotspot files.

## Notes On Fit With Existing Invariants

This plan aligns with current project invariants:

- INV-34 (thin wrappers): workers/handlers stay thin.
- INV-43/INV-44 (co-located variant and AI config): config stays next to component.
- INV-51/INV-52 (feature colocation + barrel imports): all modules stay inside `features/agents` with explicit barrels.
- INV-41 (three-phase DB usage): preserved by keeping `withSession` and `Researcher.research` phase behavior explicit.
