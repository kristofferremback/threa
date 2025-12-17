# Threa - AI-Powered Knowledge Chat

## What Is This?

Threa tackles "Slack, where critical information comes to die" by building a knowledge foundation around your organization using language models. The core differentiator is GAM (General Agentic Memory) - automatically extracting and preserving knowledge from conversations.

**Solo-first philosophy**: For solo founders, Threa is an AI-powered knowledge management system that grows into team chat. Scratchpads are the entry point, not channels.

## Runtime & Build

Default to Bun instead of Node.js:

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun test` instead of `jest` or `vitest`
- `bun build <file>` instead of `webpack` or `esbuild`
- `bun install` instead of `npm install`
- `bun run <script>` instead of `npm run <script>`
- Bun auto-loads `.env` - don't use dotenv

## Project Structure

Monorepo with Bun workspaces:

```
threa/
├── apps/
│   ├── backend/     # Express API + Socket.io
│   └── frontend/    # React 19 + Vite
├── docs/            # Design docs and exploration notes
└── package.json     # Root workspace config
```

## Tech Stack

**Backend:**
- Runtime: Bun
- Framework: Express.js
- Database: PostgreSQL via `pg` + `squid` (template tags)
- WebSocket: Socket.io with `@socket.io/postgres-adapter`
- Auth: WorkOS AuthKit
- IDs: ULID (prefixed, sortable)
- Logging: Pino

**Frontend:**
- Framework: React 19
- Build: Vite
- Routing: react-router-dom v7
- Real-time: socket.io-client

## Core Concepts

### Streams

Everything that can send messages is a stream. Types:
- `scratchpad` - Personal notes + AI companion (primary for solo users)
- `channel` - Public/private team channels
- `dm` - Direct messages (exactly two members)
- `thread` - Nested discussions (unlimited depth, graph structure)

### Memos (GAM)

Memos are semantic pointers to valuable conversations - they link to source messages, not copy content. Created via:
1. Message arrives
2. Classification worker (cheap model) determines if knowledge-worthy
3. Memorizer extracts key info into memo
4. Enrichment adds summary, tags, embedding

### Personas

AI agents are data-driven personas, not hardcoded entities. Ariadne is the default system persona. All code paths treat personas uniformly - no special-casing.

Schema uses `managed_by` enum (`system` | `workspace`), not `is_system` boolean.

## Architecture Patterns

### Repository Pattern
- Each repository is a namespace with static-like methods
- All methods take `PoolClient` as first parameter (transaction control)
- Internal row types (snake_case) mapped to domain types (camelCase)
- Pure data access - no side effects

### Outbox Pattern
- Real-time events go through outbox table
- `publishOutboxEvent()` called within transactions
- Listener polls outbox, publishes to Socket.io
- Ensures exactly-once delivery

### Handler Factory Pattern
```typescript
createStreamHandlers({ pool, authService, ...deps })
// Returns object of handlers
```

### Event Sourcing + Projections
- Events are source of truth (audit, sync, undo)
- Projections for query performance
- Both tables updated in same transaction

## Database Philosophy

- No foreign keys - application manages relationships
- No database enums - use TEXT, validate in code
- Business logic in one place (code), not spread across DB + code
- Prefixed ULIDs for all entity IDs (`stream_xxx`, `user_xxx`, etc.)

## Project Invariants

Invariants are constraints that must hold across the entire codebase. Reference them by ID when planning or reviewing changes.

| ID | Name | Rule |
|----|------|------|
| **INV-1** | No Foreign Keys | Application manages relationships, not database |
| **INV-2** | Prefixed ULIDs | All entity IDs use format `prefix_ulid` (e.g., `stream_xxx`, `user_xxx`) |
| **INV-3** | No DB Enums | Use TEXT columns, validate in application code |
| **INV-4** | Outbox for Real-time | All real-time events go through the outbox table |
| **INV-5** | Repository Pattern | Data access through repositories with `PoolClient` first parameter |
| **INV-6** | Transactions in Services | Services manage transaction boundaries, not handlers |
| **INV-7** | Events + Projections | Events are source of truth; projections for queries; both updated in same transaction |
| **INV-8** | Workspace Scoping | Resources belong to workspaces; workspace is the sharding boundary |
| **INV-9** | No Singletons | Pass dependencies explicitly; no module-level state or `getInstance()` patterns |
| **INV-10** | Self-Describing Dependencies | Dependencies must be clear about what they are (e.g., `modelRegistry` not `apiKey`) |
| **INV-11** | No Silent Fallbacks | Fail loudly on misconfiguration; don't paper over missing data with defaults |
| **INV-12** | Pass Dependencies, Not Configuration | Pass constructed objects (`pool`, `registry`), not raw config (`connectionString`, `apiKey`). Config only goes to factories/constructors that create dependencies. |

When introducing a new invariant:
1. Document it here with next available ID
2. Add tests that enforce it
3. Reference it in related code comments if non-obvious

## Service Guidelines

- Services <500 lines
- Split when too large: StreamService (CRUD), EventService, MembershipService
- Use repositories for data access
- Manage transactions in services

## AI Integration

Multi-provider system with `provider:model` format:
- `anthropic:claude-sonnet-4-20250514`
- `openai:gpt-4o-mini`
- `ollama:granite4:1b`

Dual-tier classification: fast/free SLM for most messages, expensive model only when uncertain.

Ollama-first for embeddings (free), fallback to paid APIs.

## Development

```bash
# Start everything
bun run dev

# Start database
bun run db:start

# Reset database
bun run db:reset
```

### Testing

Tests are organized by type:
- **Unit tests** (`src/**/*.test.ts`) - Pure unit tests, no external dependencies
- **Integration tests** (`tests/integration/`) - Tests requiring database
- **E2E tests** (`tests/e2e/`) - Full HTTP API tests

```bash
cd apps/backend

bun test              # All tests
bun test:unit         # Unit tests only (fast, no db needed)
bun test:integration  # Integration tests (needs postgres)
bun test:e2e          # E2E tests (needs server + postgres)
bun test:watch        # Watch mode for TDD
```

### Git Worktrees

For working on multiple branches simultaneously:

```bash
# Create a new worktree
git worktree add ../threa-feature-xyz feature/xyz
cd ../threa-feature-xyz

# Set up the worktree (copies .env, creates database)
bun run setup:worktree

# Start development
bun run dev
```

Each worktree gets its own database (e.g., `threa_feature_xyz`) while sharing the same postgres container.

## Agent Workflow

### Divergence Protocol

After significant implementation milestones, explicitly compare plan vs. reality:

```
PLAN SAID: [what the plan/task specified]
ACTUALLY DID: [what was implemented]
DIVERGENCE: [none | description of difference]
REASON: [why divergence occurred, if any]
```

If there was meaningful divergence:
1. Stop and surface it before continuing
2. Assess whether the divergence was correct (better approach discovered) or a mistake
3. Update the plan if the divergence should be preserved
4. Get confirmation before proceeding

**Key prompt**: "Did you follow the plan so far, or did you diverge? If you diverged, how and why?"

### Work Notes for Multi-Session Tasks

For features spanning multiple sessions, create `docs/plans/<feature>/work_notes.md`:

```markdown
# <Feature Name> - Work Notes

**Started**: <date>
**Branch**: <branch-name>
**Status**: <In Progress | Blocked | Complete>

## Session Log

### <date> - <Focus Area>

**Context reviewed**:
- Read <file> - understood <what>

**Applicable invariants**: INV-X, INV-Y

**Completed**:
- [x] <task>

**Discovered**:
- <insight or issue found>

**Next steps**:
1. <next task>

---

## Key Decisions

### <Decision Title>
**Choice**: <what was decided>
**Rationale**: <why>
**Alternatives considered**: <what else was considered>

---

## Blockers / Open Questions

- [ ] <unresolved issue>

---

## Files Modified

- `path/to/file` - <what changed>
```

### Request Protocol for Blockers

When blocked by tech debt or a bug that's outside current scope:

1. Document the blocker in `docs/requests/<issue-name>.md`
2. Include: problem statement, proposed solution, affected files, acceptance criteria
3. Continue with workaround if possible, or stop and surface to Kris
4. When the fix lands, merge and revisit the original plan

This enables parallel work: one agent continues on the feature, another fixes the blocker.

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

### Derive types from schemas, not alongside them
Define constants as `as const` arrays, create Zod schemas from them, derive TypeScript types with `z.infer<>`. One source of truth, zero drift:
```typescript
const STREAM_TYPES = ["scratchpad", "channel"] as const
const streamTypeSchema = z.enum(STREAM_TYPES)
type StreamType = z.infer<typeof streamTypeSchema>
```

### Errors should carry their own HTTP semantics
An `HttpError` base class with `status` and `code` lets handlers just `throw`. Centralized error handler middleware formats the response. Handlers focus on business logic, not response formatting.

### Prefer iteration over recursion for middleware chains
Recursive implementations work but iteration is harder to get wrong, has no stack depth concerns, and is easier to debug. The middleware pattern is inherently iterative anyway.

### Comments justifying changes belong in commit messages, not code
Comments like "Uses composition instead of inheritance" reference a previous design that no longer exists. Future readers won't know or care about the old approach. Put change justifications in commit messages where they provide context for reviewers; code comments should explain the current design's "why", not contrast with history.

### Extend existing abstractions instead of creating parallel ones
When adding new functionality, check if existing abstractions can be extended. Creating parallel implementations (e.g., a new `langchain-provider.ts` when `ProviderRegistry` already exists) violates DRY and confuses readers about which to use. The question "why are there two ways to do this?" should never arise.

### Dependencies should be self-describing
A parameter named `apiKey` is ambiguous - OpenRouter? Anthropic? Gmail? Pass a `modelRegistry` that knows how to create models, not a string that could mean anything. The type and name should tell you what it is without reading the implementation.

### Pass dependencies, not configuration
Configuration values (`apiKey`, `connectionString`, `port`) go to factories that construct dependencies. After construction, pass the dependency itself:
```typescript
// Bad - passing config through layers
function createWorker(apiKey: string) { ... }

// Good - config used at construction, dependency passed thereafter
const registry = new ModelRegistry({ openrouter: { apiKey } })
function createWorker(registry: ModelRegistry) { ... }
```
This makes the dependency graph explicit and testable. Workers don't need to know about API keys - they need models.

### Delete dead code immediately
Code "kept as reference" is noise. It confuses reviewers, adds cognitive load, and suggests the codebase is unreliable. Git has history - delete unused code. If it's needed later, recover it from version control.

### Avoid nested ternaries
Multi-level ternaries are clever but hard to debug. The first thing you do when troubleshooting is flatten them. Use switch statements instead - they're roughly as terse but explain each case explicitly:
```typescript
// Bad - requires mental stack to parse
const x = a ? b : c ? d : e ? f : g

// Good - each case is explicit
switch (true) {
  case a: return b
  case c: return d
  case e: return f
  default: return g
}
```

### Magic strings should be constants or enums
Checking `companionMode === "on"` scatters knowledge about valid modes throughout the codebase. Define constants or enums at the source of truth and import them. This catches typos at compile time and makes valid values discoverable.

### Workers and handlers should be thin
Workers (job handlers) and HTTP handlers are infrastructure code. They should receive input, delegate to domain logic, and return results. Business logic belongs in dedicated modules (agents, services) that are reusable across invocation contexts, independently testable, and focused on domain concerns. Think: "Would I want to duplicate this logic if I needed to call it from an API endpoint AND a job worker AND an eval harness?"

### Be consistent in initialization patterns
When a class has multiple similar resources (clients, connections), initialize them the same way. Mixed patterns (some eager, some lazy) create confusion about expected behavior and make the code harder to reason about.

### Use existing helpers consistently
If a helper exists (`withClient`, `withTransaction`), use it everywhere. Bypassing it with raw operations suggests either the helper is inadequate or the code is inconsistent. Both are problems worth fixing.

### Don't add speculative features
Don't add comments about features that weren't requested, and don't design for imagined requirements. YAGNI applies to comments too - a comment about a hypothetical mode creates confusion about what's actually supported.
