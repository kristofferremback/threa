# Threa - AI-Powered Knowledge Chat

## What Is This?

Threa tackles "Slack, where critical information comes to die" by building a knowledge foundation around your organization using language models. The core differentiator is GAM (General Agentic Memory) - automatically extracting and preserving knowledge from conversations.

**Solo-first philosophy**: For solo founders, Threa is an AI-powered knowledge management system that grows into team chat. Scratchpads are the entry point, not channels.

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

**When implementing UI components:**

1. Check `docs/design-system.md` for design decisions and patterns
2. Reference `docs/design-system-kitchen-sink.html` for visual examples and CSS implementation
3. When adding new components or patterns, update BOTH files to keep them in sync

The kitchen sink is a living reference - update it whenever you add new components, patterns, or styling. It serves as both documentation and a visual regression test.

## Local Development (Agent-Friendly)

For browser automation testing with Chrome DevTools MCP:

```bash
# Start services with stub auth
bun run dev:test

# Access at http://localhost:5173
# Stub auth: any email works, no password required
# Default workspace auto-created on first access
```

Stub mode bypasses WorkOS, creates test users on-demand. All features work except production auth flows.

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

**Streams** - Everything that can send messages. Types: scratchpad (personal notes + AI companion, auto-named), channel (team chat, unique slug), dm (two members, computed display name), thread (nested discussions, unlimited depth, inherits visibility from rootStreamId). All have visibility (public/private), companionMode (on/off), optional companionPersonaId.

**Memos (GAM)** - Semantic pointers preserving knowledge without copying. Store abstract + sourceMessageIds for navigation. Pipeline: message arrival → MemoAccumulator (30s debounce, 5min max) → Classifier (knowledge-worthiness) → Memorizer (title, abstract, keyPoints, tags, sourceMessageIds) → Enrichment (embeddings). Types: decision, learning, procedure, context, reference. Lifecycle: draft → active → archived | superseded.

**Personas** - Data-driven AI agents (not hardcoded). System personas (workspaceId=NULL, available to all) vs Workspace personas (single workspace). Invocation: companion mode (stream-level), mentions (@persona-slug), agent sessions. Each has enabledTools[] (send_message, web_search, read_url, create_memo, search_memos). Default: Ariadne (persona_system_ariadne).

**See:** `docs/core-concepts.md` for detailed explanations, pipelines, and implementation notes.

## Architecture Patterns

**Repository Pattern** - Static methods with Querier (Pool | PoolClient) first parameter. Pure data access, snake_case → camelCase mapping, template tag SQL (squid/pg). No transactions, no business logic.

**Service Layer** - Classes with Pool in constructor. Manage transaction boundaries (withTransaction, withClient). Coordinate repositories. Business logic lives here. Handlers are thin orchestrators.

**Outbox Pattern** - Real-time events through outbox table. Publishing: insert in transaction → automatic NOTIFY. Processing: OutboxDispatcher (NOTIFY/LISTEN on separate pool) → handlers (cursor-based, time-locked via CursorLock, debounced). Event scoping: stream/workspace/author. Handlers: BroadcastHandler, NamingHandler, CompanionHandler, EmojiUsageHandler, EmbeddingHandler, BoundaryExtractionHandler, MemoAccumulatorHandler.

**Event Sourcing + Projections** - stream_events (append-only source of truth) + projections (denormalized for queries). Both updated in same transaction. Per-stream atomic sequences via INSERT ... ON CONFLICT DO UPDATE.

**Job Queue + Workers** - PostgreSQL-backed queue. Workers are thin wrappers calling service methods for reusability. Workers: Naming, Companion, Embedding, BoundaryExtraction, MemoBatch, Command, PersonaAgent.

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

**INV-9: No Singletons** - Pass dependencies explicitly; no module-level state or `getInstance()` patterns. Exceptions: (1) Logger (Pino) - stateless and side-effect-free. (2) Langfuse/OTEL SDK - must initialize before any LangChain imports to instrument them; this constraint forces module-level state.

**INV-10: Self-Describing Dependencies** - Dependencies must be clear about what they are (e.g., `modelRegistry` not `apiKey`)

**INV-11: No Silent Fallbacks** - Fail loudly on misconfiguration; don't paper over missing data with defaults

**INV-12: Pass Dependencies, Not Configuration** - Pass constructed objects (`pool`, `registry`), not raw config (`connectionString`, `apiKey`). Config only goes to factories/constructors that create dependencies.

**INV-13: Construct, Don't Assemble** - Never `doThing(deps, params)` where caller assembles deps. Instead, construct objects with their deps at startup (`new Thing(deps)`), then callers just call `thing.doThing(params)`. Callers should know interfaces, not implementation dependencies.

**INV-14: Shadcn UI Components** - Always use Shadcn UI for frontend components. Never build custom buttons, inputs, dialogs, etc. from scratch. Install missing components via `bunx shadcn@latest add <component>`. Components live in `apps/frontend/src/components/ui/`. See "Shadcn UI Reference" section below for available components.

**INV-15: Dumb Components** - React components handle UI rendering and local state only. No direct database access (`@/db`), no persistence logic, no business rules. Components receive capabilities via props/context (e.g., `sendMessage`) and call them without knowing implementation. Enforced by ESLint `no-restricted-imports`.

**INV-16: Preferred AI Models** - Always use current-generation models. Never use Claude 3 models (claude-3-haiku, claude-3-sonnet, claude-3-opus) or the gpt-4o family. See `docs/preferred-models.md` for up-to-date model recommendations. **For AI assistants:** If you encounter a model ID not in your knowledge base, check preferred-models.md first - it may exist and be preferred. Don't assume it doesn't exist or downgrade to older models. Model format is `provider:modelPath`.

**INV-17: Immutable Migrations** - Never modify existing migration files. Migrations that have been committed are immutable - they may have already run on databases. To change schema, add a new migration file with the next sequence number. Modifying existing migrations causes schema drift between environments.

**INV-18: No Inline Components** - Never define React components inside other components. Extract them to separate files. This isn't about reusability—it's about codebase maneuverability. Files should be what they say they are. A `sidebar.tsx` should contain sidebar logic, not theme picker logic. Colocation of unrelated concerns makes code harder to find and maintain.

**INV-19: AI Telemetry Required** - All AI wrapper calls (`ai.generateText`, `ai.generateObject`, `ai.embed`, `ai.embedMany`) must include `telemetry: { functionId: "<descriptive-id>", metadata: { ...contextual-data } }`. This enables Langfuse observability. The `functionId` should describe the operation (e.g., "stream-naming", "memo-classify-message"). Include relevant IDs in metadata for traceability.

**INV-20: No Select-Then-Update** - Never do SELECT-then-UPDATE/INSERT without proper concurrency control. This pattern has race conditions. Use atomic operations instead: `INSERT ... ON CONFLICT DO UPDATE` for upserts, `UPDATE ... WHERE` with row-level conditions, or explicit locking (`SELECT FOR UPDATE`). If you must check-then-act, use serializable transactions or optimistic locking with version columns.

**INV-21: No Layout Shift from Hints** - Hints, tooltips, and popups must use absolute/fixed positioning and never shift surrounding content. Use `position: absolute` with appropriate z-index, not inline elements that push content around.

**INV-22: Always Fix Failing Tests** - Never dismiss test failures as "pre-existing" or "unrelated". A failing test means one of: (1) you broke something and didn't realize it, (2) a flaky test that needs fixing, or (3) a failing test was merged to main (which is bad). Always investigate and fix. If truly unrelated to your changes, fix in a separate commit.

**INV-23: Don't Assert Event Count** - Tests should NOT assert the number of events emitted after an operation. Event count is an implementation detail that changes as features evolve. Instead, verify that specific event types you care about are present and have correct payloads. Use `.find()` or filtering to locate expected events.

**INV-24: No Assert Chains** - Avoid sequential `expect()` calls checking properties of the same object. Use object comparison instead: build a `want` object and compare with `expect(got).toMatchObject(want)` or `expect(got).toEqual(want)`. Assert chains obscure relationships, make failures harder to diagnose, and clutter tests.

**INV-25: No Change Justification Comments** - Comments like `// INV-24: refactored to use toMatchObject` or `// Uses X instead of Y` reference refactoring decisions, not current behavior. Future readers don't care what the code used to be. Put change justifications in commit messages; code comments explain WHY the current code works this way, not how it differs from a previous version.

**INV-26: No TODO Tests** - Never leave tests as `.todo()` or `.skip()`. Tests must either pass or be deleted. If a test cannot be made to pass in the current environment (e.g., jsdom limitations), either refactor the test to verify the behavior differently or remove it and document why in a comment. TODO tests are technical debt that never gets paid.

**INV-27: Prefer Generic Repository Methods** - Don't add single-use repository methods when a generic method can be reused. If you need `getRecentScratchpadDisplayNames`, check if `list()` with filters covers the use case. Repositories should be powerful and composable, not cluttered with specialized variants. When ten ways exist to get the same data, it's unclear which to use.

**INV-28: Use AI Wrapper, Not Raw SDK** - Never import `generateText`, `generateObject`, `embed`, or `embedMany` directly from the `ai` module. Always use the `AI` wrapper (`createAI()`) which provides: clean telemetry API without `experimental_` prefixes, automatic repair functions for structured output, consistent `{ value, response }` return types, and model string parsing. Pass the `AI` instance via dependency injection.

**INV-29: Extract Variance, Share Behavior** - When handling variants (e.g., different stream types), extract only the decision logic into small functions returning a common shape. Keep one code path for shared behavior. Don't create separate code paths that "should behave the same" - they will drift. Example: `const decision = isA ? decideForA() : decideForB()` then one shared flow using `decision`.

**INV-30: No withClient for Single Queries** - Don't wrap single repository calls in `withClient`. Repositories accept `Querier` (Pool or PoolClient). Bad: `withClient(pool, client => repo.doThing(client, opts))`. Good: `repo.doThing(pool, opts)`. Use `withClient` only when multiple queries need the same connection or for connection affinity across calls.

**INV-31: Derive Types from Schemas** - Define constants as `as const` arrays, create Zod schemas from them, derive TypeScript types with `z.infer<>`. One source of truth, zero drift. Example: `const TYPES = ["a", "b"] as const; const schema = z.enum(TYPES); type Type = z.infer<typeof schema>`. Never maintain parallel type definitions.

**INV-32: Errors Carry HTTP Semantics** - Use `HttpError` base class with `status` and `code`. Let handlers just `throw`. Centralized error handler middleware formats responses. Handlers focus on business logic, not response formatting. Errors know their own HTTP status codes.

**INV-33: No Magic Strings** - Don't scatter string literals like `companionMode === "on"` throughout code. Define constants or enums at source of truth and import them. Catches typos at compile time, makes valid values discoverable. Magic strings hide knowledge that should be explicit.

**INV-34: Thin Handlers and Workers** - HTTP handlers and job workers are infrastructure. They receive input, delegate to domain logic (services, agents), and return results. Business logic belongs in dedicated modules that are reusable across contexts (API + worker + eval harness), independently testable, and focused on domain concerns.

**INV-35: Use Existing Helpers Consistently** - If a helper exists (`withClient`, `withTransaction`, utility function), use it everywhere. Bypassing helpers with raw operations suggests either the helper is inadequate (fix it) or the code is inconsistent (fix that). Don't create parallel implementations of the same behavior.

**INV-36: No Speculative Features** - Don't add features, comments, or design for imagined requirements. YAGNI applies to code AND comments. A comment about hypothetical modes creates confusion about what's actually supported. Build what's needed now. Future requirements will be clearer when they actually arrive.

**INV-37: Extend Abstractions, Don't Duplicate** - When adding functionality, check if existing abstractions can be extended. Creating parallel implementations (e.g., new provider when one exists) violates DRY and confuses readers about which to use. The question "why are there two ways to do this?" should never arise. One abstraction per concern.

**INV-38: Delete Dead Code Immediately** - Code "kept as reference" is noise. It confuses reviewers, adds cognitive load, and suggests unreliability. Git has history - delete unused code. If needed later, recover from version control. Commented-out code is dead code. Delete it.

**INV-39: Frontend Integration Tests** - Frontend tests must mount real components and simulate real user behavior. Unit tests that mock too much miss real bugs (event propagation, focus management, z-index issues). Use `render(<Component />)` and `userEvent` to interact. Test observable behavior, not implementation. Write tests that fail when the bug exists.

**INV-40: Links Are Links, Buttons Are Buttons** - Never use `<button onClick={navigate}>` for navigation. Use `<Link to={url}>` from react-router-dom. Buttons trigger actions (submit, open modal, delete). Links navigate (change URL, open new tab with cmd+click). If it changes the URL, it's a link. If cmd+click should work, it's a link. Buttons break browser navigation, link previews, and accessibility.

When introducing a new invariant:

1. Document it here with next available ID
2. Add tests that enforce it
3. Reference it in related code comments if non-obvious

## Backend Architecture (Quick Reference)

**Three-layer model:**

- **Handlers** (factories returning route handlers): Validate input, check auth, delegate to services, format responses
- **Services** (classes with Pool in constructor): Orchestrate business logic, manage transaction boundaries via `withTransaction`/`withClient`
- **Repositories** (static objects with static methods): Pure data access, first param is `Querier` (Pool or PoolClient), snake_case ↔ camelCase mapping

**Key patterns:**

- Factory pattern for handlers/middleware (dependency injection)
- `withTransaction` for multi-step writes, `withClient` for simple reads (INV-30: don't wrap single queries)
- Two pools: main (30 conns), listen (12 conns) - prevents LISTEN from starving transactional work
- Handlers throw `HttpError` subclasses; error handler middleware catches and formats
- Outbox pattern: events written in transaction, OutboxDispatcher publishes async

**See:** `docs/backend/` for detailed guides on handlers, services, repositories, middleware, testing, and request flows.

## AI Integration

Multi-provider system using **OpenRouter** as unified billing interface. All AI calls go through the wrapper (`createAI()`) which provides:

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

Always use Claude 4.5+ models (INV-16). All AI wrapper calls require `telemetry.functionId` (INV-19).

**See:** `docs/backend/ai-integration.md` for configuration, cost tracking, repair functions, and LangChain integration.

## Development

### Primary Folder Workflow (`/threa`)

**Database and infrastructure run ONLY in primary folder:**

```bash
# First time: Start database
bun run db:start

# Run migrations (start app, let migrations run, then kill)
bun run dev
# Ctrl+C after migrations complete

# Optional: Start Langfuse for AI observability
bun run langfuse:start

# Reset database (destroys data)
bun run db:reset
```

**IMPORTANT:** Never run `db:start`, `db:reset`, or `langfuse:start` from worktrees. Infrastructure lives in primary folder only.

### Git Worktrees (Feature Development)

All feature work happens in worktrees to keep branches isolated:

```bash
# In primary /threa folder: create worktree
git worktree add ../threa-feature-xyz feature/xyz
cd ../threa-feature-xyz

# Set up worktree (copies .env, installs packages, creates branched database, copies Claude config)
bun run setup:worktree

# Start development (uses database from primary folder's postgres)
bun run dev
```

**How it works:**

- Worktree gets its own database (e.g., `threa_feature_xyz`)
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

Optional. Provides visibility into LLM calls, costs, performance.

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

Langfuse uses OpenTelemetry to automatically trace LangChain and Vercel AI SDK calls.

## Lessons Learned

### Foundation code requires more scrutiny than feature code

Routes, schemas, and core abstractions are infrastructure. Errors compound - every feature built on a crooked foundation inherits its problems. Review infrastructure PRs more carefully; the cost of fixing later grows with each dependent feature.

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

Checking access without checking existence returns 403 for non-existent resources. Wrong semantics, even if it leaks no information.

### Push checks up, consolidate checks down

- **Up:** Move repeated checks (workspace membership) into middleware. Fail earlier, fail once.
- **Down:** Move complex validation logic (stream access) into service helpers. Single source of truth.

Handlers become thin orchestrators, not validators.

### Path changes are cross-cutting

Adding `workspaceId` to paths touched routes, handlers, services, outbox events, and tests (14 files). Path structure isn't "just URLs" - it's a cross-cutting architectural decision.

### Compose small middlewares

`compose(auth, workspaceMember)` beats a monolithic `authAndWorkspace` middleware:

- Each piece testable in isolation
- Routes can use different combinations
- Adding new checks is additive, not invasive

### Prefer iteration over recursion for middleware chains

Recursive implementations work but iteration is harder to get wrong, has no stack depth concerns, and is easier to debug. The middleware pattern is inherently iterative anyway.

### Avoid nested ternaries

Multi-level ternaries are clever but hard to debug. The first thing you do when troubleshooting is flatten them. Use switch statements instead - they're roughly as terse but explain each case explicitly:

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

When a class has multiple similar resources (clients, connections), initialize them the same way. Mixed patterns (some eager, some lazy) create confusion about expected behavior and make the code harder to reason about.

### Abstractions should fully own their domain

A helper that extracts part of a workflow but leaves the caller managing the rest adds indirection without reducing complexity. If you're creating an abstraction for session lifecycle, it should handle find/create, run work, AND track status - not just find/create while the caller still manages status with separate calls. Partial abstractions can be worse than no abstraction because they add a layer of indirection while still requiring the caller to understand the full workflow.
