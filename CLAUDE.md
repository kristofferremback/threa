# Threa - AI-Powered Knowledge Chat

## What This Is

Threa tackles "Slack, where critical information comes to die" by building knowledge foundations with language models. The core differentiator is GAM (General Agentic Memory): automatically extracting and preserving knowledge from conversations.

**Solo-first philosophy:** Threa starts as AI-powered personal knowledge management and grows into team chat. Scratchpads are the primary entry point, not channels.

## How To Use This Document

This file is the project source of truth for architecture and code constraints.

When rules compete, use this precedence order:

1. **Correctness and safety first** (data integrity, concurrency, transaction safety)
2. **Architecture boundaries second** (feature placement, layering, dependency flow)
3. **Task scope third** (smallest working change that solves the request)
4. **Style and ergonomics last** (cleanup, formatting, readability polish)

Default implementation mode for routine tasks: **minimal patch**. Do not refactor, rename, or generalize unless it is required to satisfy a higher-priority rule above.

## Runtime and Build

Default to Bun instead of Node.js:

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun run test` instead of `jest` or `vitest`
- `bun build <file>` instead of `webpack` or `esbuild`
- `bun install` instead of `npm install`
- `bun run <script>` instead of `npm run <script>`
- Bun auto-loads `.env` - do not use `dotenv`

## Workflow and Verification

Prefer test-first development: write or update a failing test that captures the desired behavior, then implement the fix.

For small bug fixes where a reproducible test is not practical, at minimum run the most relevant existing test suite and verify behavior manually.

Never ship unexecuted tests. Run:

- `bun run test:e2e` for E2E coverage
- `bun run test` for unit/integration coverage

If tests fail, fix them or explicitly isolate the failure in a separate follow-up change.

## Project Structure

Monorepo with Bun workspaces:

```text
threa/
|- apps/
|  |- backend/     # Express API + Socket.io + workers
|  `- frontend/    # React 19 + Vite + Shadcn UI
|- packages/
|  |- types/       # Shared domain types and API contracts
|  `- prosemirror/ # Editor state wrapper
|- scripts/        # Dev orchestration and utilities
|- tests/          # Cross-app tests (Playwright)
|- docs/           # Design docs and exploration notes
|- .agents/skills/ # Shared agent skills (Claude + Codex)
`- package.json    # Root workspace config
```

Agent skills live in `.agents/skills/<name>/SKILL.md`. `.claude/skills` is a symlink to `.agents/skills/`.

### Backend Feature Colocation

Backend domain logic lives in `apps/backend/src/features/<name>/` (INV-51). Each feature colocates handler, service, repository, outbox handler, worker, config, and tests.

`lib/` is for cross-cutting infrastructure only (queueing, outbox dispatch, AI wrapper, utilities, logging). Domain-specific prompt builders, classifiers, extractors, and event handlers stay in feature folders.

Feature public APIs are exported via `index.ts` barrels; other features import from barrels only (INV-52).

## Invariant Playbook (Narrative)

Use invariant IDs in planning, review notes, and PR comments. The rules below are grouped by intent, with concrete examples.

### 1) Data Model and Persistence Safety

Relational integrity is enforced in application code, not in PostgreSQL schema design:

- No foreign keys (INV-1)
- No DB enums; use `TEXT` and validate in code (INV-3)
- All entities use prefixed ULIDs like `stream_xxx` (INV-2)
- Workspace is the data ownership and sharding boundary (INV-8)
- Outside auth and `workspace_members`, reference `MemberId`, not `UserId` (INV-50)

Migrations are append-only (INV-17). Never edit existing migration files.

Write paths must be race-safe:

- Never do select-then-update without locking/concurrency control (INV-20)
- Prefer set-based/batch DB operations over per-row loops (INV-56)
- Avoid `withClient` for single-query paths; pass `pool` directly (INV-30)
- Do not keep DB connections open during slow AI/network work (INV-41)
- Do not store transient workflow state on core domain entities; use tracking tables (INV-57)

Example: race-safe upsert instead of check-then-act.

```sql
-- Preferred (INV-20)
INSERT INTO workspace_members (id, workspace_id, user_id)
VALUES ($1, $2, $3)
ON CONFLICT (workspace_id, user_id)
DO UPDATE SET updated_at = NOW();
```

```sql
-- Avoid (INV-20)
SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2;
-- then conditionally INSERT or UPDATE in app code
```

### 2) Architecture Boundaries and Dependency Flow

Real-time delivery goes through the outbox pattern, not ad hoc publish calls (INV-4). Event-source updates and read projections are committed together (INV-7).

Services own transactions (INV-6). Handlers and workers stay thin and infrastructure-focused (INV-34), delegating business logic to services and domain modules.

Repository pattern expectations:

- Data access goes through repositories (INV-5)
- Prefer composable generic repo methods over one-off method sprawl (INV-27)

Dependency rules are strict:

- No hidden singletons (except approved logger and Langfuse/OTEL bootstrap constraints) (INV-9)
- Dependency names must describe what they are (INV-10)
- Fail loudly; no silent fallback defaults (INV-11)
- Pass constructed dependencies, not raw config values (INV-12)
- Construct long-lived collaborators once; avoid per-call dependency assembly (INV-13)
- Reuse existing helpers and abstractions instead of parallel implementations (INV-35, INV-37)

Example: construct once, then call with params.

```ts
// Preferred (INV-12, INV-13)
const conversationService = new ConversationService({ pool, outboxPublisher })
await conversationService.createMessage({ streamId, content })
```

```ts
// Avoid (INV-12, INV-13)
await createMessage(
  { connectionString, redisUrl, apiKey },
  { streamId, content }
)
```

### 3) API Contracts, Validation, and Types

Inputs (`body`, `query`, `params`) are validated with Zod schemas, not manual `typeof` checks (INV-55).

Errors carry explicit HTTP semantics via `HttpError` classes (`status`, `code`) and are formatted by middleware (INV-32).

Type derivation should flow from schemas/constants to inferred types to avoid drift (INV-31).

Avoid hardcoded display text in backend responses; return structured data and format in frontend (INV-46).

Avoid magic strings by centralizing constants at the source of truth (INV-33).

### 4) AI Integration and Language Behavior

Use only current-generation models listed in `docs/model-reference.md` (INV-16). All AI usage goes through the project AI wrapper (`createAI`), not raw SDK imports (INV-28).

Every AI wrapper call must include telemetry metadata (INV-19).

AI component config lives next to the component in `config.ts` and is shared by production and evals (INV-44). Evals call production entry points rather than reimplementing logic (INV-45).

Do not make semantic decisions with language-specific heuristics or English-only literals/regexes; use model-based decisions for language-dependent behavior (INV-54).

### 5) Frontend Composition and UX Semantics

Use Shadcn UI components from `apps/frontend/src/components/ui/` for primitives (INV-14). React components should stay UI-focused and avoid business logic or persistence access (INV-15).

Do not define components inside other components (INV-18).

Hints/tooltips/popovers must not cause layout shift (INV-21).

Navigation uses links; actions use buttons (INV-40):

```tsx
// Preferred (INV-40)
<Link to={streamUrl}>Open stream</Link>
<button onClick={archiveStream}>Archive</button>
```

```tsx
// Avoid (INV-40)
<button onClick={() => navigate(streamUrl)}>Open stream</button>
```

Socket subscriptions must always pair with bootstrap fetches, and bootstrap must be invalidated on reconnect/resubscribe to close event gaps (INV-53).

User-facing dates must use user timezone resolution via `formatDate(date, timezone, format)` from `lib/temporal.ts` (INV-42).

### 6) Testing and Reliability Expectations

Always resolve failing tests; do not dismiss failures as pre-existing (INV-22).

Tests should verify behavior, not brittle internals:

- Do not assert event counts; assert presence/content of specific events (INV-23)
- Prefer one object comparison over chains of narrow assertions (INV-24)
- No `.skip()` or `.todo()` tests (INV-26)
- Avoid `mock.module()` for shared modules; prefer scoped `spyOn` patterns (INV-48)

Frontend integration tests should mount real components and exercise observable user behavior (INV-39).

### 7) Maintainability and Scope Control

Do not add speculative features, configuration, or comments for imagined requirements (INV-36).

Delete dead code immediately (INV-38). Do not carry deprecated aliases after renames (INV-49).

Comments explain why the current implementation works; they do not narrate the change history (INV-25).

Avoid nested ternaries beyond one level (INV-47).

When handling variants, colocate variant config and keep shared behavior on one path (INV-29, INV-43).

## Quick Invariant Lookup

- **Persistence and data integrity:** INV-1, INV-2, INV-3, INV-8, INV-17, INV-20, INV-30, INV-41, INV-50, INV-56, INV-57
- **Architecture and dependencies:** INV-4, INV-5, INV-6, INV-7, INV-9, INV-10, INV-11, INV-12, INV-13, INV-27, INV-34, INV-35, INV-37, INV-51, INV-52
- **API and backend contracts:** INV-31, INV-32, INV-33, INV-46, INV-55
- **AI and eval discipline:** INV-16, INV-19, INV-28, INV-44, INV-45, INV-54
- **Frontend and UX behavior:** INV-14, INV-15, INV-18, INV-21, INV-40, INV-42, INV-53
- **Testing:** INV-22, INV-23, INV-24, INV-26, INV-39, INV-48
- **Code hygiene and maneuverability:** INV-25, INV-29, INV-36, INV-38, INV-43, INV-47, INV-49

When introducing a new invariant:

1. Document it in this file with the next available ID.
2. Add tests that enforce it.
3. Reference it in nearby code comments if the constraint is non-obvious.

## Backend Architecture Quick Reference

Three-layer model:

- **Handlers**: validate input, check auth, delegate to services, format responses
- **Services**: orchestrate business logic and transaction boundaries
- **Repositories**: pure data access, first arg is a `Querier` (`Pool` or `PoolClient`), map snake_case <-> camelCase

Common patterns:

- Factory pattern for handlers/middleware dependency injection
- Single query: pass `pool`; multiple related reads: `withClient`; multi-operation writes: `withTransaction`
- Two pools: main (30 conns) and listen (12 conns) to avoid LISTEN starving transactional work
- Handlers throw `HttpError`; error middleware handles response formatting
- Outbox events are written in the same transaction as domain writes; dispatcher publishes asynchronously

See `docs/backend/` for deeper guides.

## Frontend Patterns

Cache-only observer pattern for TanStack Query v5: provide a `queryFn` that reads from cache. `enabled: false` alone is not enough.

```tsx
const { data } = useQuery({
  queryKey: someKeys.bootstrap(id),
  queryFn: () => queryClient.getQueryData<SomeType>(someKeys.bootstrap(id)) ?? null,
  enabled: false,
  staleTime: Infinity,
})
```

Do not call `queryClient.getQueryData()` directly in render for reactive reads.

`WorkspaceBootstrap.streams` is `StreamWithPreview[]`, not `Stream[]`. When adding streams to sidebar cache, spread with `{ ...stream, lastMessagePreview: null }`.
