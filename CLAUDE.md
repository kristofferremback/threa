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
