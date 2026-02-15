# Threa - AI-Powered Knowledge Chat

## What Is This?

Threa tackles "Slack, where critical information comes to die" by building knowledge foundations using language models. Core differentiator: GAM (General Agentic Memory) - auto-extracts and preserves knowledge from conversations.

**Solo-first philosophy**: For solo founders, Threa is AI-powered knowledge management that grows into team chat. Scratchpads are the entry point, not channels.

## Runtime & Build

Default to Bun instead of Node.js:

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun run test` instead of `jest` or `vitest`
- `bun build <file>` instead of `webpack` or `esbuild`
- `bun install` instead of `npm install`
- `bun run <script>` instead of `npm run <script>`
- Bun auto-loads `.env` - don't use dotenv

## Project Structure

Monorepo with Bun workspaces:

```
threa/
├── apps/
│   ├── backend/     # Express API + Socket.io + Workers
│   └── frontend/    # React 19 + Vite + Shadcn UI
├── packages/
│   ├── types/       # Shared domain types and API contracts
│   └── prosemirror/ # Editor state wrapper
├── scripts/         # Dev orchestration and utilities
├── tests/           # Cross-app tests (Playwright)
├── docs/            # Design docs and exploration notes
├── .agents/skills/  # Shared agent skills (Claude + Codex)
└── package.json     # Root workspace config
```

**Agent skills:** `.agents/skills/<name>/SKILL.md`. `.claude/skills` is a **symlink** to `.agents/skills/` — create new skills in `.agents/skills/`, not `.claude/skills/`.

### Backend: Feature Colocation (INV-51)

Domain logic organized by feature, not layer. Each feature colocates all layers:

```
apps/backend/src/
├── features/           # Domain features (colocated layers)
│   ├── streams/        # Stream CRUD, naming, display names
│   ├── memos/          # GAM pipeline, classifier, memorizer, embeddings
│   ├── attachments/    # Upload, processing (PDF, text, word, excel, image)
│   ├── conversations/  # Conversation boundaries, extraction
│   ├── agents/         # Persona agent, companion graph, tools, researcher
│   ├── messaging/      # Message CRUD, events
│   ├── search/         # Full-text + semantic search
│   ├── workspaces/     # Workspace + member management
│   ├── commands/       # Slash commands
│   ├── ai-usage/       # Cost tracking, budgets
│   ├── emoji/          # Emoji usage tracking
│   └── user-preferences/
├── lib/                # Cross-cutting infrastructure only
│   ├── ai/             # AI wrapper, model registry, cost tracking
│   ├── storage/        # S3 client
│   ├── queue-manager.ts, job-queue.ts, schedule-manager.ts
│   ├── outbox-dispatcher.ts, broadcast-handler.ts
│   ├── cursor-lock.ts, debounce.ts, temporal.ts, id.ts, ...
│   └── (utilities, logging, errors, metrics)
├── middleware/         # Express middleware
├── auth/               # Authentication (WorkOS + stub)
├── routes.ts           # Central route registration
├── server.ts           # Service wiring + startup
└── app.ts              # Express app factory
```

Feature slice convention: `index.ts` (barrel), `handlers.ts`, `service.ts`, `repository.ts`, `outbox-handler.ts`, `worker.ts`, `config.ts`, `*.test.ts`.

**Tech stack:** See .claude/reference.md. Key: Bun runtime, Express v5, PostgreSQL/squid, Socket.io, React 19, Shadcn UI, Vercel AI SDK + LangChain.

**Design system:** See docs/design-system.md and docs/design-system-kitchen-sink.html.

**Local dev:** bun run dev:test for stub auth. See docs/agent-testing-guide.md.

**Shadcn UI (INV-14):** bunx shadcn@latest add <name> from apps/frontend/. Golden Thread theme — warm neutrals + gold accents.

**Core concepts:** Streams (scratchpad/channel/dm/thread), Memos (GAM knowledge extraction), Personas (data-driven AI agents). See docs/core-concepts.md.

## Database Philosophy

- No foreign keys - application manages relationships
- No database enums - use TEXT, validate in code
- Business logic in one place (code), not spread across DB + code
- Prefixed ULIDs for all entity IDs (`stream_xxx`, `user_xxx`, etc.)

## Project Invariants

Invariants are constraints that must hold across the entire codebase. Reference by ID when planning or reviewing changes.

**INV-1: No Foreign Keys** - Application manages relationships, not database

**INV-2: Prefixed ULIDs** - All entity IDs use format `prefix_ulid` (e.g., `stream_xxx`, `user_xxx`)

**INV-3: No DB Enums** - Use TEXT columns, validate in application code

**INV-4: Outbox for Real-time** - All real-time events go through outbox table

**INV-5: Repository Pattern** - Data access through repositories with `PoolClient` first parameter

**INV-6: Transactions in Services** - Services manage transaction boundaries, not handlers

**INV-7: Events + Projections** - Events are source of truth; projections for queries; both updated in same transaction

**INV-8: Workspace Scoping** - Resources belong to workspaces; workspace is sharding boundary

**INV-9: No Singletons** - Pass deps explicitly; no module-level state or `getInstance()`. Exceptions: (1) Logger (Pino) — stateless. (2) Langfuse/OTEL — must init before LangChain imports; forces module-level state.

**INV-10: Self-Describing Dependencies** - Dependencies must be clear about what they are (e.g., `modelRegistry` not `apiKey`)

**INV-11: No Silent Fallbacks** - Fail loudly on misconfiguration; don't paper over missing data with defaults

**INV-12: Pass Dependencies, Not Configuration** - Pass constructed objects (`pool`, `registry`), not raw config (`connectionString`, `apiKey`). Config only goes to factories/constructors.

**INV-13: Construct, Don't Assemble** - Never `doThing(deps, params)` where caller assembles deps. Construct with deps at startup (`new Thing(deps)`), call `thing.doThing(params)`.

**INV-14: Shadcn UI Components** - Always use Shadcn UI. Never build custom buttons, inputs, dialogs from scratch. Install: `bunx shadcn@latest add <component>`. Components in `apps/frontend/src/components/ui/`.

**INV-15: Dumb Components** - React components handle UI rendering and local state only. No `@/db`, no persistence logic, no business rules. Components receive capabilities via props/context. Enforced by ESLint `no-restricted-imports`.

**INV-16: Preferred AI Models** - Always use current-generation models. Never Claude 3 or gpt-4o family. See `docs/model-reference.md`. Model format: `provider:modelPath`.

**INV-17: Immutable Migrations** - Never modify existing migration files. Add new migration with next sequence number.

**INV-18: No Inline Components** - Never define React components inside other components. Extract to separate files. About codebase maneuverability, not reusability.

**INV-19: AI Telemetry Required** - All AI wrapper calls must include `telemetry: { functionId: "<descriptive-id>", metadata: {...} }`. Enables Langfuse observability.

**INV-20: No Select-Then-Update** - Never SELECT-then-UPDATE/INSERT without concurrency control — race conditions. Use: `INSERT ... ON CONFLICT DO UPDATE`, `UPDATE ... WHERE` with row-level conditions, `SELECT FOR UPDATE`. Check-then-act: serializable transactions or optimistic locking.

**INV-21: No Layout Shift from Hints** - Hints, tooltips, popups use absolute/fixed positioning. Never shift surrounding content.

**INV-22: Always Fix Failing Tests** - Never dismiss failures as "pre-existing" or "unrelated". Investigate and fix. If truly unrelated, fix in separate commit.

**INV-23: Don't Assert Event Count** - Event count is implementation detail. Verify specific event types with correct payloads via `.find()` or filtering.

**INV-24: No Assert Chains** - Build `want` object, compare with `toMatchObject(want)` or `.toEqual(want)`. Assert chains obscure relationships.

**INV-25: No Change Justification Comments** - Comments explain WHY current code works, not how it differs from previous version. Change justifications go in commit messages.

**INV-26: No TODO Tests** - Tests pass or get deleted. No `.todo()` or `.skip()`.

**INV-27: Prefer Generic Repository Methods** - Don't add single-use repository methods when generic `list()` with filters works. Repositories: powerful, composable, not cluttered.

**INV-28: Use AI Wrapper, Not Raw SDK** - Never import directly from `ai` module. Use `createAI()` wrapper. Pass `AI` instance via dependency injection.

**INV-29: Extract Variance, Share Behavior** - Extract variant decision logic into config objects or small functions. Keep ONE code path for shared behavior. Don't scatter `if (type === 'foo')` checks throughout shared code.

**INV-30: No withClient for Single Queries** - One query? Pass `pool` directly. Use `withClient` only for multiple related queries or check-then-act needing connection affinity.

**INV-31: Derive Types from Schemas** - `as const` arrays -> Zod schemas -> `z.infer<>`. One source of truth, zero drift.

**INV-32: Errors Carry HTTP Semantics** - `HttpError` base class with `status`, `code`. Handlers throw, error middleware formats.

**INV-33: No Magic Strings** - Define constants/enums at source of truth, import them. Magic strings hide knowledge.

**INV-34: Thin Handlers and Workers** - Infrastructure only. Business logic in dedicated modules reusable across API + worker + eval harness.

**INV-35: Use Existing Helpers Consistently** - If helper exists, use it everywhere. Don't create parallel implementations.

**INV-36: No Speculative Features** - YAGNI applies to code AND comments. Build what's needed now.

**INV-37: Extend Abstractions, Don't Duplicate** - One abstraction per concern. "Why are there two ways?" should never arise.

**INV-38: Delete Dead Code Immediately** - Git has history. Commented-out code is dead code. Delete it.

**INV-39: Frontend Integration Tests** - Mount real components, simulate real user behavior. Test observable behavior via `render()` + `userEvent`.

**INV-40: Links Are Links, Buttons Are Buttons** - Navigation = `<Link to={url}>`. Actions = `<button>`. Never `<button onClick={navigate}>`.

**INV-41: Three-Phase Pattern for Slow Operations** - NEVER hold db connections during slow operations (AI/LLM, 1-5+ sec) — pool exhaustion. **Phase 1:** Fetch data with withClient (fast reads). **Phase 2:** Slow operation, NO connection held. **Phase 3:** Save with withTransaction, re-check state for race conditions. Accept wasted work over pool exhaustion.

**INV-42: User Timezone for Dates** - NEVER use server time or assume local timezone for user-facing dates. Resolve timezone from relevant user(s). Single-user: author's timezone. Multi-user: first message author's timezone. Use `formatDate(date, timezone, format)` from `lib/temporal.ts`.

**INV-43: Colocate Variant Config** - Define ALL config for each variant in ONE place. Never scatter `if (type === X)` checks. Signs of sprawl: can't see all variant behavior on one screen, adding variant requires 5+ location changes, if/switch on same discriminator appears multiple times.

**INV-44: AI Config Co-location** - Each AI component has co-located `config.ts` exporting model ID, prompts, schemas, temperatures. Production and evals import from same config.

**INV-45: Evals Call Production Entry Points** - Never recreate graphs, prompts, or business logic in eval code. Call the same entry points production uses. If wiring deps is hard, fix production code's testability.

**INV-46: No Hardcoded Display Text in Backend** - Return structured data; frontend formats for display. LLM output is fine.

**INV-47: No Nested Ternaries** - One level fine. Two or more: use switch, early returns, or config lookups.

**INV-48: No mock.module for Shared Modules** - `mock.module()` pollutes global module cache. Use `spyOn()` on object methods instead — scoped to current test. Only use `mock.module()` for modules exclusively used by code under test.

**INV-49: No Deprecated Aliases** - When renaming, update all call sites in same commit. No `@deprecated` export aliases.

**INV-50: Reference Members, Not Users** — Outside auth and `workspace_members` table, always reference `MemberId`, never `UserId`. Socket infrastructure (pre-workspace) exempt. Enforced by branded ID types and ESLint.

**INV-51: Feature Colocation** — Backend domain logic lives in `features/<name>/`. Each feature colocates its handler, service, repository, outbox handler, worker, config, and tests. `lib/` is reserved for cross-cutting infrastructure (queue, outbox dispatcher, AI wrapper, utilities, logging). Domain-specific classifiers, prompt builders, extractors, and event handlers belong in features, not `lib/`. Enforced by ESLint (`apps/backend/eslint.config.js`).

**INV-52: Feature Barrel Imports** — Features export their public API through `index.ts` barrels. Other features import only from the barrel (`features/x`), never from internals (`features/x/some-file`). `lib/` never imports from `features/`. Enforced by ESLint (`apps/backend/eslint.config.js`).

**INV-53: Subscribe+Bootstrap Pairing** — Every socket room subscribe MUST be paired with a bootstrap fetch. No gaps allowed. When re-subscribing (navigation back, socket reconnect), invalidate bootstrap to fill the event gap. See `docs/frontend/subscribe-then-bootstrap.md`.

**INV-54: No Language-Specific Heuristic Decisions** — Never assume English (or any specific language) and never use language-specific literal/regex heuristics to decide semantic behavior (for example memory recall detection, trivial-message filtering, research gating, or intent classification). Use LLM/model-based semantic decisions for language-dependent behavior.

**INV-55: Zod for All Input Validation** — Validate all handler inputs (body, query, params) with Zod schemas. Never use manual `typeof` checks or hand-rolled validation. Zod gives exhaustive error collection (all violations returned, not just the first) and a consistent `{ error, details: fieldErrors }` response shape. Type-specific field rules use `superRefine` with config-driven disallowed-field maps.

When introducing a new invariant:

1. Document here with next available ID
2. Add tests that enforce it
3. Reference in related code comments if non-obvious

## Backend Architecture (Quick Reference)

**Three-layer model:**

- **Handlers** (factories returning route handlers): Validate input, check auth, delegate to services, format response
- **Services** (classes with Pool in constructor): Orchestrate business logic, manage transaction boundaries via `withTransaction`/`withClient`
- **Repositories** (static objects with static methods): Pure data access, first param is `Querier` (Pool or PoolClient), snake_case <-> camelCase mapping

**Key patterns:**

- Factory pattern for handlers/middleware (dependency injection)
- Single query: pass `pool`. Multiple reads: `withClient`. Multi-op writes: `withTransaction` (INV-30)
- Two pools: main (30 conns), listen (12 conns) - prevents LISTEN starving transactional work
- Handlers throw `HttpError` subclasses; error handler middleware catches and formats
- Outbox pattern: events written in transaction, OutboxDispatcher publishes async

**See:** `docs/backend/` for detailed guides on handlers, services, repositories, middleware, testing, and request flows.

**AI integration:** All AI calls through createAI() wrapper (INV-28). Model format: provider:modelPath. Telemetry required (INV-19). See docs/model-reference.md and docs/backend/ai-integration.md.

**Development:** Database/infra only in primary /threa folder, never worktrees. Feature work in worktrees (bun run setup:worktree). See .claude/reference.md for full setup.

## Frontend Patterns

**Cache-only observer (TanStack Query v5):** To subscribe reactively to query cache without triggering fetches, provide a `queryFn` that reads from the cache. `enabled: false` alone is not enough — v5 requires `queryFn` to be present. Never use `queryClient.getQueryData()` directly in component render — it's a non-reactive snapshot.

```tsx
const { data } = useQuery({
  queryKey: someKeys.bootstrap(id),
  queryFn: () => queryClient.getQueryData<SomeType>(someKeys.bootstrap(id)) ?? null,
  enabled: false,
  staleTime: Infinity,
})
```

See `use-workspace-emoji.ts` and `use-socket-events.ts` for reference.

**WorkspaceBootstrap.streams type:** `streams` is `StreamWithPreview[]`, not `Stream[]`. When adding streams to the sidebar cache, spread with `{ ...stream, lastMessagePreview: null }`.
