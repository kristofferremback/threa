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
└── package.json     # Root workspace config
```

## Tech Stack

**Backend:**

- Runtime: Bun
- Framework: Express.js v5
- Database: PostgreSQL via `pg` + `squid` (template tag SQL)
- Migrations: Umzug
- WebSocket: Socket.io with `@socket.io/postgres-adapter`
- Auth: WorkOS AuthKit (production) + stub (dev/testing)
- Job Queue: Custom PostgreSQL queue (replaced pg-boss)
- Storage: S3-compatible (MinIO for local)
- IDs: ULID (prefixed, sortable)
- Logging: Pino
- AI: Vercel AI SDK + LangChain/LangGraph + OpenRouter
- Observability: Langfuse + OpenTelemetry
- Schema: Zod
- Testing: Bun test + Playwright

**Frontend:**

- Framework: React 19
- Build: Vite
- Routing: react-router-dom v7
- Real-time: socket.io-client
- State: TanStack Query + Dexie (IndexedDB)
- UI Components: Shadcn UI (Radix primitives)
- Styling: Tailwind CSS
- Editor: Tiptap (ProseMirror)
- Testing: Vitest + Testing Library, Playwright for browser testing

## Design System References

**Primary documentation:**

- `docs/design-system.md` - Comprehensive design system guide (typography, colors, components, patterns)
- `docs/design-system-kitchen-sink.html` - Interactive reference with all UI components and patterns

**Implementing UI components:**

1. Check `docs/design-system.md` for design decisions, patterns
2. Reference `docs/design-system-kitchen-sink.html` for visual examples, CSS implementation
3. When adding new components or patterns, update BOTH files

Kitchen sink is living reference - update when adding components, patterns, or styling. Serves as documentation and visual regression test.

## Local Development (Agent-Friendly)

Browser automation testing (Chrome DevTools MCP):

```bash
# Start services with stub auth
bun run dev:test

# Access at http://localhost:5173
# Stub auth: any email works, no password required
# Default workspace auto-created on first access
```

Stub mode bypasses WorkOS, creates test users on-demand. All features work except production auth.

**See:** `docs/agent-testing-guide.md` for comprehensive testing workflows and `docs/agent-testing-quick-reference.md` for quick patterns.

## Shadcn UI

Always use Shadcn UI components (INV-14). Components copied into codebase, not imported from npm.

**Add components:**

```bash
cd apps/frontend
bunx shadcn@latest add <component-name>
```

**Golden Thread theme**: Warm neutrals + gold accents. Use gold sparingly. Custom utilities: `thread-gradient`, `text-thread`, `border-thread`, `thread-glow`.

## Core Concepts

**Streams** - Everything that can send messages. Types: scratchpad (personal notes + AI companion, auto-named), channel (team chat, unique slug), dm (two or more members, computed display name, supports group DMs), thread (nested discussions, unlimited depth, inherits visibility from rootStreamId). All have visibility (public/private), companionMode (on/off), optional companionPersonaId.

**Memos (GAM)** - Semantic pointers preserving knowledge without copying. Store abstract + sourceMessageIds for navigation. Pipeline: message arrival → MemoAccumulator (30s debounce, 5min max) → Classifier (knowledge-worthiness) → Memorizer (title, abstract, keyPoints, tags, sourceMessageIds) → Enrichment (embeddings). Types: decision, learning, procedure, context, reference. Lifecycle: draft → active → archived | superseded.

**Personas** - Data-driven AI agents (not hardcoded). System personas (workspaceId=NULL, available to all) vs Workspace personas (single workspace). Invocation: companion mode (stream-level), mentions (@persona-slug), agent sessions. Each has enabledTools[] (send_message, web_search, read_url, create_memo, search_memos). Default: Ariadne (persona_system_ariadne).

**See:** `docs/core-concepts.md` for detailed explanations, pipelines, and implementation notes.

## Architecture Patterns

**Repository Pattern** - Static methods with Querier (Pool | PoolClient) first parameter. Pure data access, snake_case → camelCase mapping, template tag SQL (squid/pg). No transactions, no business logic.

**Service Layer** - Classes with Pool in constructor. Manage transaction boundaries (withTransaction, withClient). Coordinate repositories. Business logic lives here. Handlers are thin orchestrators.

**Outbox Pattern** - Real-time events through outbox table. Publishing: insert in transaction → automatic NOTIFY. Processing: OutboxDispatcher (NOTIFY/LISTEN on separate pool) → handlers (cursor-based, time-locked via CursorLock, debounced). Event scoping: stream/workspace/author. Handlers: BroadcastHandler, NamingHandler, CompanionHandler, EmojiUsageHandler, EmbeddingHandler, BoundaryExtractionHandler, MemoAccumulatorHandler.

**Event Sourcing + Projections** - stream_events (append-only source of truth) + projections (denormalized for queries). Both updated in same transaction. Per-stream atomic sequences via INSERT ... ON CONFLICT DO UPDATE.

**Job Queue + Workers** - PostgreSQL-backed queue. Workers are thin wrappers calling service methods. Workers: Naming, Companion, Embedding, BoundaryExtraction, MemoBatch, Command, PersonaAgent.

**Middleware Composition** - Factory functions accept dependencies, return Express middleware. Compose for flexible permissions: compose(auth, workspaceMember).

**Handler Factory Pattern** - createHandlers({ deps }) returns object with route handler methods. Explicit dependency injection.

**Database Pool Separation** - main pool (30 conns: HTTP, services, workers), listen pool (12 conns: NOTIFY/LISTEN, long-held). Prevents resource starvation.

**Cursor Lock** - Time-based locking (locked_until timestamp, auto-refresh every 5s). Process events without holding connections. Automatic failover on crash.

**See:** `docs/architecture.md` for detailed patterns, code examples, and anti-patterns to avoid.

## Database Philosophy

- No foreign keys - application manages relationships
- No database enums - use TEXT, validate in code
- Business logic in one place (code), not spread across DB + code
- Prefixed ULIDs for all entity IDs (`stream_xxx`, `user_xxx`, etc.)

## Project Invariants

Invariants are constraints that must hold across the entire codebase. Reference them by ID when planning or reviewing changes.

**INV-1: No Foreign Keys** - Application manages relationships, not database

**INV-2: Prefixed ULIDs** - All entity IDs use format `prefix_ulid` (e.g., `stream_xxx`, `user_xxx`)

**INV-3: No DB Enums** - Use TEXT columns, validate in application code

**INV-4: Outbox for Real-time** - All real-time events go through the outbox table

**INV-5: Repository Pattern** - Data access through repositories with `PoolClient` first parameter

**INV-6: Transactions in Services** - Services manage transaction boundaries, not handlers

**INV-7: Events + Projections** - Events are source of truth; projections for queries; both updated in same transaction

**INV-8: Workspace Scoping** - Resources belong to workspaces; workspace is the sharding boundary

**INV-9: No Singletons** - Pass dependencies explicitly; no module-level state or `getInstance()`. Exceptions: (1) Logger (Pino) - stateless, side-effect-free. (2) Langfuse/OTEL SDK - must initialize before LangChain imports for instrumentation; forces module-level state.

**INV-10: Self-Describing Dependencies** - Dependencies must be clear about what they are (e.g., `modelRegistry` not `apiKey`)

**INV-11: No Silent Fallbacks** - Fail loudly on misconfiguration; don't paper over missing data with defaults

**INV-12: Pass Dependencies, Not Configuration** - Pass constructed objects (`pool`, `registry`), not raw config (`connectionString`, `apiKey`). Config only goes to factories/constructors that create dependencies.

**INV-13: Construct, Don't Assemble** - Never `doThing(deps, params)` where caller assembles deps. Construct objects with deps at startup (`new Thing(deps)`), then call `thing.doThing(params)`. Callers know interfaces, not implementation dependencies.

**INV-14: Shadcn UI Components** - Always use Shadcn UI for frontend components. Never build custom buttons, inputs, dialogs, etc. from scratch. Install missing components: `bunx shadcn@latest add <component>`. Components in `apps/frontend/src/components/ui/`.

**INV-15: Dumb Components** - React components handle UI rendering and local state only. No direct database access (`@/db`), no persistence logic, no business rules. Components receive capabilities via props/context (e.g., `sendMessage`) and call them without knowing implementation. Enforced by ESLint `no-restricted-imports`.

**INV-16: Preferred AI Models** - Always use current-generation models. Never use Claude 3 models (claude-3-haiku, claude-3-sonnet, claude-3-opus) or the gpt-4o family. See `docs/model-reference.md` for up-to-date model recommendations. **For AI assistants:** If you encounter a model ID not in your knowledge base, check model-reference.md first - it may exist and be preferred. Don't assume it doesn't exist or downgrade to older models. Model format is `provider:modelPath`.

**INV-17: Immutable Migrations** - Never modify existing migration files. Committed migrations are immutable - may have already run. To change schema, add new migration with next sequence number. Modifying existing migrations causes schema drift.

**INV-18: No Inline Components** - Never define React components inside other components. Extract to separate files. Not about reusability—about codebase maneuverability. Files should be what they say they are. `sidebar.tsx` contains sidebar logic, not theme picker logic. Colocation of unrelated concerns makes code harder to find, maintain.

**INV-19: AI Telemetry Required** - All AI wrapper calls (`ai.generateText`, `ai.generateObject`, `ai.embed`, `ai.embedMany`) must include `telemetry: { functionId: "<descriptive-id>", metadata: { ...contextual-data } }`. Enables Langfuse observability. `functionId` describes operation (e.g., "stream-naming"). Include relevant IDs in metadata for traceability.

**INV-20: No Select-Then-Update** - Never SELECT-then-UPDATE/INSERT without concurrency control. Has race conditions. Use atomic operations: `INSERT ... ON CONFLICT DO UPDATE` for upserts, `UPDATE ... WHERE` with row-level conditions, or explicit locking (`SELECT FOR UPDATE`). For check-then-act, use serializable transactions or optimistic locking with version columns.

**INV-21: No Layout Shift from Hints** - Hints, tooltips, and popups must use absolute/fixed positioning and never shift surrounding content. Use `position: absolute` with appropriate z-index, not inline elements that push content around.

**INV-22: Always Fix Failing Tests** - Never dismiss test failures as "pre-existing" or "unrelated". Failing test means: (1) you broke something, (2) flaky test needs fixing, or (3) failing test merged to main. Always investigate, fix. If truly unrelated, fix in separate commit.

**INV-23: Don't Assert Event Count** - Tests should NOT assert event count. Event count is implementation detail that changes as features evolve. Verify specific event types are present with correct payloads. Use `.find()` or filtering.

**INV-24: No Assert Chains** - Avoid sequential `expect()` calls checking properties of same object. Use object comparison: build `want` object, compare with `expect(got).toMatchObject(want)` or `.toEqual(want)`. Assert chains obscure relationships, make failures harder to diagnose, clutter tests.

**INV-25: No Change Justification Comments** - Comments like `// INV-24: refactored to use toMatchObject` or `// Uses X instead of Y` reference refactoring decisions, not current behavior. Future readers don't care what code used to be. Change justifications go in commit messages; code comments explain WHY current code works, not how it differs from previous version.

**INV-26: No TODO Tests** - Never leave tests as `.todo()` or `.skip()`. Tests pass or get deleted. If test can't pass in current environment (e.g., jsdom limitations), refactor to verify behavior differently or remove with documented reason. TODO tests are technical debt that never gets paid.

**INV-27: Prefer Generic Repository Methods** - Don't add single-use repository methods when generic method can be reused. Need `getRecentScratchpadDisplayNames`? Check if `list()` with filters works. Repositories should be powerful, composable, not cluttered with specialized variants. Ten ways to get same data = unclear which to use.

**INV-28: Use AI Wrapper, Not Raw SDK** - Never import `generateText`, `generateObject`, `embed`, `embedMany` directly from `ai` module. Use `AI` wrapper (`createAI()`) providing: clean telemetry API (no `experimental_` prefixes), automatic repair for structured output, consistent `{ value, response }` return types, model string parsing. Pass `AI` instance via dependency injection.

**INV-29: Extract Variance, Share Behavior** - When handling variants (e.g., stream types, section types), extract decision logic into config objects or small functions at the point of variance. Keep ONE code path for shared behavior.

Anti-patterns:

- Separate code paths that "should behave the same" (they drift)
- Scattering `if (type === 'foo')` checks throughout shared code (config smeared across file)
- Hundreds of lines between related variant decisions

Pattern:

```typescript
// Good: All variant config in ONE place, then shared behavior
const SECTION_CONFIG = {
  favorites: { icon: Star, label: 'Favorites', canCreate: false },
  channels: { icon: Hash, label: 'Channels', canCreate: true },
} as const

function Section({ type }: { type: SectionType }) {
  const config = SECTION_CONFIG[type]  // One lookup
  return <SidebarSection {...config} />  // Shared rendering
}

// Bad: Config scattered throughout - 200 lines of sprawl
function Section({ type }: { type: SectionType }) {
  const icon = type === 'favorites' ? Star : Hash  // line 50
  // ... 100 lines of shared code ...
  const label = type === 'favorites' ? 'Favorites' : 'Channels'  // line 150
  // ... 50 more lines ...
  const canCreate = type !== 'favorites'  // line 200
}
```

**INV-30: No withClient for Single Queries** - Don't wrap single repository calls in `withClient`. Repositories accept `Querier` (Pool | PoolClient). One query? Pass `pool` directly. Use `withClient` only for multiple related queries or check-then-act patterns needing connection affinity.

**INV-31: Derive Types from Schemas** - Define constants as `as const` arrays, create Zod schemas from them, derive TypeScript types with `z.infer<>`. One source of truth, zero drift. Example: `const TYPES = ["a", "b"] as const; const schema = z.enum(TYPES); type Type = z.infer<typeof schema>`. Never maintain parallel type definitions.

**INV-32: Errors Carry HTTP Semantics** - Use `HttpError` base class with `status`, `code`. Handlers just `throw`. Centralized error handler middleware formats responses. Handlers focus on business logic. Errors know their HTTP status codes.

**INV-33: No Magic Strings** - Don't scatter string literals like `companionMode === "on"` throughout code. Define constants/enums at source of truth, import them. Catches typos at compile time, makes valid values discoverable. Magic strings hide knowledge.

**INV-34: Thin Handlers and Workers** - HTTP handlers and job workers are infrastructure. They receive input, delegate to domain logic (services, agents), and return results. Business logic belongs in dedicated modules that are reusable across contexts (API + worker + eval harness), independently testable, and focused on domain concerns.

**INV-35: Use Existing Helpers Consistently** - If helper exists (`withClient`, `withTransaction`, utility), use it everywhere. Bypassing helpers with raw operations means helper is inadequate (fix it) or code is inconsistent (fix that). Don't create parallel implementations.

**INV-36: No Speculative Features** - Don't add features, comments, or design for imagined requirements. YAGNI applies to code AND comments. Comments about hypothetical modes create confusion. Build what's needed now. Future requirements clarify when they arrive.

**INV-37: Extend Abstractions, Don't Duplicate** - When adding functionality, check if existing abstractions can be extended. Creating parallel implementations (e.g., new provider when one exists) violates DRY, confuses readers. "Why are there two ways?" should never arise. One abstraction per concern.

**INV-38: Delete Dead Code Immediately** - Code "kept as reference" is noise. It confuses reviewers, adds cognitive load, and suggests unreliability. Git has history - delete unused code. If needed later, recover from version control. Commented-out code is dead code. Delete it.

**INV-39: Frontend Integration Tests** - Frontend tests must mount real components, simulate real user behavior. Unit tests mocking too much miss real bugs (event propagation, focus, z-index). Use `render(<Component />)`, `userEvent` to interact. Test observable behavior, not implementation. Tests fail when bug exists.

**INV-40: Links Are Links, Buttons Are Buttons** - Never use `<button onClick={navigate}>` for navigation. Use `<Link to={url}>` from react-router-dom. Buttons trigger actions (submit, modal, delete). Links navigate (URL change, cmd+click). Changes URL? It's a link. cmd+click should work? It's a link. Buttons break navigation, previews, accessibility.

**INV-41: Three-Phase Pattern for Slow Operations** - NEVER hold database connections (withTransaction or withClient) during slow operations like AI/LLM calls (1-5+ seconds). This causes pool exhaustion. Use three-phase pattern: **Phase 1**: Fetch all needed data with withClient (fast reads, ~100-200ms). **Phase 2**: Perform slow operation with NO database connection held (AI calls, external APIs, heavy computation). **Phase 3**: Save results with withTransaction, re-checking state to handle race conditions (fast writes, ~100ms). Re-checking prevents corruption when another process modified data during Phase 2. Accept wasted work (e.g., discarded AI call) to prevent pool exhaustion - holding connections blocks all concurrent requests. Examples: stream-naming-service.ts, boundary-extraction-service.ts, memo-service.ts.

**INV-42: User Timezone for Dates** - NEVER use server time (`new Date()`) or assume local timezone when displaying or anchoring dates for users. ALWAYS resolve timezone from the relevant user(s). For single-user context (messages, scratchpads): use the author's timezone. For multi-user context (conversations, channels): use the first user message author's timezone, or canonical invoking user. Store timezone on User (`user.timezone`), pass through context, and use `formatDate(date, timezone, format)` from `lib/temporal.ts`. Dates like "tomorrow" should resolve to the user's tomorrow, not the server's.

**INV-43: Colocate Variant Config** - When multiple variants differ in configuration, define ALL config for each variant in ONE place. Never scatter `if (type === X)` checks throughout a file. Sprawl is the enemy: 200 lines between related decisions makes behavior impossible to understand, review, or modify safely.

Signs of sprawl (stop and refactor):

- Can't see all variant behavior on one screen
- Adding a new variant requires changes in 5+ locations
- Reviewer must scroll hundreds of lines to understand one variant
- `if/switch` on same discriminator appears multiple times in file

The fix: Create a config object or lookup table at the top. Each variant's complete behavior visible in one block. Shared code receives config, doesn't compute it.

**INV-44: AI Config Co-location** - Each AI component (classifier, memorizer, naming, etc.) must have a `config.ts` file co-located with its implementation. Config exports: model ID constant, system prompts, schemas, temperature settings. Production code and evals import from the same config file - no hardcoded duplicates. This ensures evals test the actual production configuration. Example: `lib/memo/config.ts` exports `MEMO_MODEL_ID`, `MEMO_TEMPERATURES`, prompts, schemas; both `classifier.ts` and `evals/suites/memo-classifier/suite.ts` import from it.

**INV-45: Evals Call Production Entry Points** - Eval suites must call the same entry points production uses. Never recreate graphs, prompts, or business logic in eval code. If production calls `PersonaAgent.run()`, evals call `PersonaAgent.run()`. If you need to vary config (model, temperature), inject it at the appropriate layer - don't build a parallel implementation.

Signs of violation:

- Eval has its own `buildSystemPrompt()` or similar function
- Eval calls `createGraph()` directly instead of the service/agent that wraps it
- Eval duplicates schemas, prompts, or constants instead of reading from production sources
- Eval creates "simplified" versions of production classes

The fix: Find the production entry point. Wire up the dependencies it needs. Call it. If that's hard, the production code may need refactoring to be more testable - fix that, don't work around it in the eval.

When introducing a new invariant:

1. Document it here with next available ID
2. Add tests that enforce it
3. Reference it in related code comments if non-obvious

## Backend Architecture (Quick Reference)

**Three-layer model:**

- **Handlers** (factories returning route handlers): Validate input, check auth, delegate to services, format response
- **Services** (classes with Pool in constructor): Orchestrate business logic, manage transaction boundaries via `withTransaction`/`withClient`
- **Repositories** (static objects with static methods): Pure data access, first param is `Querier` (Pool or PoolClient), snake_case ↔ camelCase mapping

**Key patterns:**

- Factory pattern for handlers/middleware (dependency injection)
- Single query: pass `pool`. Multiple reads: `withClient`. Multi-op writes: `withTransaction` (INV-30)
- Two pools: main (30 conns), listen (12 conns) - prevents LISTEN starving transactional work
- Handlers throw `HttpError` subclasses; error handler middleware catches and formats
- Outbox pattern: events written in transaction, OutboxDispatcher publishes async

**See:** `docs/backend/` for detailed guides on handlers, services, repositories, middleware, testing, and request flows.

## AI Integration

Multi-provider system using **OpenRouter** for unified billing. All AI calls go through wrapper (`createAI()`) providing:

- Clean telemetry API (no `experimental_` prefixes)
- Automatic structured output repair (markdown fences, field normalization)
- Unified `{ value, response, usage }` return types
- Cost tracking (recorded to `ai_usage_records` when context provided)
- Thread-safe cost tracking for LangChain/LangGraph via `CostTracker` + `CostTrackingCallback`

**Model format:** `provider:modelPath` (e.g., `openrouter:anthropic/claude-haiku-4.5`)

**Usage:**

```typescript
const { value } = await ai.generateObject({
  model: "openrouter:anthropic/claude-haiku-4.5",
  schema: mySchema,
  messages: [...],
  telemetry: { functionId: "memo-classify", metadata: {...} },  // INV-19: required
  context: { workspaceId, userId }  // For cost tracking
})
```

See `docs/model-reference.md` for recommended models (INV-16). All AI wrapper calls require `telemetry.functionId` (INV-19).

**See:** `docs/backend/ai-integration.md` for configuration, cost tracking, repair functions, and LangChain integration.

## Development

### Primary Folder Workflow (`/threa`)

**Database, infrastructure run ONLY in primary folder:**

```bash
# First time: Start database
bun run db:start

# Run migrations (start app, wait for migrations, kill)
bun run dev
# Ctrl+C after migrations complete

# Optional: Start Langfuse for AI observability
bun run langfuse:start

# Reset database (destroys data)
bun run db:reset
```

**IMPORTANT:** Never run `db:start`, `db:reset`, `langfuse:start` from worktrees. Infrastructure in primary folder only.

### Git Worktrees (Feature Development)

All feature work in worktrees for branch isolation:

```bash
# From /threa (on main): create worktree with brace expansion
git worktree add -b {,~/dev/personal/threa.}feature-name main
cd ~/dev/personal/threa.feature-name

# Set up worktree (copies .env, installs packages, creates branched database, copies Claude config)
bun run setup:worktree

# Start development (uses database from primary folder's postgres)
bun run dev
```

**Brace expansion explained:** `{,~/dev/personal/threa.}feature-name` expands to create branch `feature-name` at path `~/dev/personal/threa.feature-name`.

**How it works:**

- Worktree gets its own database (e.g., `threa_feature_name`)
- Database branches from primary folder's current state
- Shares same postgres container (no new docker services)
- Independent .env, node_modules, .claude config

**Testing in worktrees:**

```bash
cd apps/backend
bun run test              # All tests
bun run test:unit         # Unit tests (fast, no db)
bun run test:integration  # Integration tests (with test db)
bun run test:e2e          # E2E tests
```

### Langfuse (AI Observability)

Optional. Visibility into LLM calls, costs, performance.

```bash
# In primary /threa folder only:
docker compose -f docker-compose.langfuse.yml up -d

# UI at http://localhost:3100
# Create account, create project, copy keys to .env:
#   LANGFUSE_SECRET_KEY=sk-lf-...
#   LANGFUSE_PUBLIC_KEY=pk-lf-...
#   LANGFUSE_BASE_URL=http://localhost:3100

# Restart backend to enable tracing
```

Langfuse uses OpenTelemetry to auto-trace LangChain, Vercel AI SDK calls.

Local credentials (safe to share):
Email: dev@threa.local
Password: threa-dev-password123

## Lessons Learned

### Foundation code requires more scrutiny than feature code

Routes, schemas, core abstractions are infrastructure. Errors compound - every feature built on crooked foundation inherits its problems. Review infrastructure PRs carefully; cost of fixing grows with each dependent feature.

### URL structure encodes domain truths

Design URLs from domain understanding, not REST conventions:

- `/workspaces/:workspaceId/...` exists because workspaces are the sharding boundary
- Events on streams (not messages) because events are polymorphic
- Messages NOT under streams because they may span multiple streams
- Query params for filtering (`?stream_type=`) instead of multiple endpoints

URLs are domain models. They should guide correct usage.

### Authorization middleware must model resource lifecycle

```
Does resource exist? → 404
Does user have access? → 403
Proceed → handler
```

Checking access without checking existence returns 403 for non-existent resources. Wrong semantics.

### Push checks up, consolidate checks down

- **Up:** Move repeated checks (workspace membership) into middleware. Fail earlier, fail once.
- **Down:** Move complex validation logic (stream access) into service helpers. Single source of truth.

Handlers become thin orchestrators, not validators.

### Path changes are cross-cutting

Adding `workspaceId` to paths touched routes, handlers, services, outbox events, tests (14 files). Path structure isn't "just URLs" - it's cross-cutting architectural decision.

### Compose small middlewares

`compose(auth, workspaceMember)` beats a monolithic `authAndWorkspace` middleware:

- Each piece testable in isolation
- Routes can use different combinations
- Adding new checks is additive, not invasive

### Prefer iteration over recursion for middleware chains

Recursive implementations work but iteration is harder to get wrong, has no stack depth concerns, easier to debug. Middleware pattern is inherently iterative.

### Avoid nested ternaries

Multi-level ternaries are clever but hard to debug. First thing when troubleshooting is flattening them. Use switch statements - roughly as terse but explain each case explicitly:

```typescript
// Bad - requires mental stack to parse
const x = a ? b : c ? d : e ? f : g

// Good - each case is explicit
switch (true) {
  case a:
    return b
  case c:
    return d
  case e:
    return f
  default:
    return g
}
```

### Be consistent in initialization patterns

When class has multiple similar resources (clients, connections), initialize them same way. Mixed patterns (some eager, some lazy) create confusion about expected behavior, make code harder to reason about.

### Abstractions should fully own their domain

Helper extracting part of workflow but leaving caller managing rest adds indirection without reducing complexity. Creating abstraction for session lifecycle? It should handle find/create, run work, AND track status - not just find/create while caller manages status with separate calls. Partial abstractions can be worse than none - they add indirection while requiring caller understand full workflow.

### withClient is for connection affinity, not "being safe"

`withClient` doesn't make code safer - it holds a connection. Single query? Pass `pool` directly; it auto-acquires and releases. `withClient` is for when you need the _same_ connection: multiple queries benefiting from reuse, or check-then-act needing consistency. Wrapping single calls wastes connections and obscures intent.

### Config sprawl is a recurring agent failure mode

Coding agents tend to scatter variant logic throughout files instead of colocating config. Results: 200+ line files where variant behavior is impossible to review, modify safely, or even understand. The fix is always the same: create a config object at the top where each variant's complete behavior is visible in one block. Shared code receives config, doesn't compute it. When reviewing agent output, check: "Can I see all behavior for one variant on one screen?" If not, request consolidation before merge.

### Evals that recreate production logic are worse than no evals

An eval that builds its own prompt and graph is testing a parallel implementation, not production. When production changes, the eval keeps passing because it's testing itself. This gives false confidence while the real code diverges.

The companion eval had `buildEvalSystemPrompt()` that duplicated the persona's system prompt logic. It called `createCompanionGraph()` directly instead of `PersonaAgent.run()`. Both are violations - the eval should set up test data, call the production entry point, and verify the output.

If wiring up production dependencies for an eval is painful, that's a signal the production code needs better dependency injection, not that the eval should take shortcuts.
