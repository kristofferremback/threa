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
- UI Components: Shadcn UI (Golden Thread theme)
- Styling: Tailwind CSS

## Shadcn UI Reference

Shadcn UI is a collection of accessible components built on Radix UI primitives and Tailwind CSS. Components are copied into the codebase (not imported from npm), allowing full customization.

**Installation:**

```bash
cd apps/frontend
bunx shadcn@latest add <component-name>
```

**Installed components** (`apps/frontend/src/components/ui/`):
accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, switch, table, tabs, textarea, toggle, toggle-group, tooltip

All core Shadcn components are installed. If a new component is added to shadcn/ui, install via `bunx shadcn@latest add <component>`.

**Usage pattern:**

```tsx
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
;<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>
    <Button>Click me</Button>
  </CardContent>
</Card>
```

**Golden Thread theme**: The custom theme uses warm neutrals with gold accents. Primary color is gold (`--primary: 38 65% 50%`). Use sparingly for key UI moments. Custom utilities available: `thread-gradient`, `text-thread`, `border-thread`, `thread-glow`.

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

| ID         | Name                                 | Rule                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **INV-1**  | No Foreign Keys                      | Application manages relationships, not database                                                                                                                                                                                                                                                                                                                      |
| **INV-2**  | Prefixed ULIDs                       | All entity IDs use format `prefix_ulid` (e.g., `stream_xxx`, `user_xxx`)                                                                                                                                                                                                                                                                                             |
| **INV-3**  | No DB Enums                          | Use TEXT columns, validate in application code                                                                                                                                                                                                                                                                                                                       |
| **INV-4**  | Outbox for Real-time                 | All real-time events go through the outbox table                                                                                                                                                                                                                                                                                                                     |
| **INV-5**  | Repository Pattern                   | Data access through repositories with `PoolClient` first parameter                                                                                                                                                                                                                                                                                                   |
| **INV-6**  | Transactions in Services             | Services manage transaction boundaries, not handlers                                                                                                                                                                                                                                                                                                                 |
| **INV-7**  | Events + Projections                 | Events are source of truth; projections for queries; both updated in same transaction                                                                                                                                                                                                                                                                                |
| **INV-8**  | Workspace Scoping                    | Resources belong to workspaces; workspace is the sharding boundary                                                                                                                                                                                                                                                                                                   |
| **INV-9**  | No Singletons                        | Pass dependencies explicitly; no module-level state or `getInstance()` patterns. Exceptions: (1) Logger (Pino) - stateless and side-effect-free. (2) Langfuse/OTEL SDK - must initialize before any LangChain imports to instrument them; this constraint forces module-level state.                                                                                 |
| **INV-10** | Self-Describing Dependencies         | Dependencies must be clear about what they are (e.g., `modelRegistry` not `apiKey`)                                                                                                                                                                                                                                                                                  |
| **INV-11** | No Silent Fallbacks                  | Fail loudly on misconfiguration; don't paper over missing data with defaults                                                                                                                                                                                                                                                                                         |
| **INV-12** | Pass Dependencies, Not Configuration | Pass constructed objects (`pool`, `registry`), not raw config (`connectionString`, `apiKey`). Config only goes to factories/constructors that create dependencies.                                                                                                                                                                                                   |
| **INV-13** | Construct, Don't Assemble            | Never `doThing(deps, params)` where caller assembles deps. Instead, construct objects with their deps at startup (`new Thing(deps)`), then callers just call `thing.doThing(params)`. Callers should know interfaces, not implementation dependencies.                                                                                                               |
| **INV-14** | Shadcn UI Components                 | Always use Shadcn UI for frontend components. Never build custom buttons, inputs, dialogs, etc. from scratch. Install missing components via `bunx shadcn@latest add <component>`. Components live in `apps/frontend/src/components/ui/`. See "Shadcn UI Reference" section below for available components.                                                          |
| **INV-15** | Dumb Components                      | React components handle UI rendering and local state only. No direct database access (`@/db`), no persistence logic, no business rules. Components receive capabilities via props/context (e.g., `sendMessage`) and call them without knowing implementation. Enforced by ESLint `no-restricted-imports`.                                                            |
| **INV-16** | No Claude 3 Models                   | Never use Claude 3 models (claude-3-haiku, claude-3-sonnet, claude-3-opus). Always use Claude 4+ models. For OpenRouter: `openrouter:anthropic/claude-haiku-4.5`, `openrouter:anthropic/claude-sonnet-4`. The model ID format is `provider:modelPath`.                                                                                                               |
| **INV-17** | Immutable Migrations                 | Never modify existing migration files. Migrations that have been committed are immutable - they may have already run on databases. To change schema, add a new migration file with the next sequence number. Modifying existing migrations causes schema drift between environments.                                                                                 |
| **INV-18** | No Inline Components                 | Never define React components inside other components. Extract them to separate files. This isn't about reusability—it's about codebase maneuverability. Files should be what they say they are. A `sidebar.tsx` should contain sidebar logic, not theme picker logic. Colocation of unrelated concerns makes code harder to find and maintain.                      |
| **INV-19** | Vercel AI SDK Telemetry              | All `generateText` and `generateObject` calls must include `experimental_telemetry: { isEnabled: true, functionId: "<descriptive-id>", metadata: { ...contextual-data } }`. This enables Langfuse observability. The `functionId` should describe the operation (e.g., "stream-naming", "memo-classify-message"). Include relevant IDs in metadata for traceability. |

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

### Langfuse (AI Observability)

Langfuse provides visibility into LLM calls, costs, and performance. Optional but recommended for development.

```bash
# Start Langfuse stack (postgres, redis, clickhouse, minio)
docker compose -f docker-compose.langfuse.yml up -d

# UI at http://localhost:3100
# Create account, then create a project and copy keys to .env:
#   LANGFUSE_SECRET_KEY=sk-lf-...
#   LANGFUSE_PUBLIC_KEY=pk-lf-...
#   LANGFUSE_BASE_URL=http://localhost:3100

# Restart backend to enable tracing
bun run dev
```

Langfuse uses OpenTelemetry to automatically trace LangChain and Vercel AI SDK calls. No code changes needed in AI call sites.

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

### Task Tracking with Linear

All tasks, features, and improvements are tracked in Linear (team: Threa). Use the Linear MCP tools to:

- **View issues**: `list_issues` with filters (assignee, state, label, etc.)
- **Create issues**: `create_issue` with title, description, team, labels, state
- **Update issues**: `update_issue` to change state, add comments, etc.
- **Add comments**: `create_comment` for session logs and progress updates

**Labels**:

- `Feature` - New functionality
- `Improvement` - Enhancements to existing features
- `Bug` - Defects to fix

**States**: Backlog → Todo → In Progress → In Review → Done

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
3. Update the Linear issue if the divergence should be preserved
4. Get confirmation before proceeding

**Key prompt**: "Did you follow the plan so far, or did you diverge? If you diverged, how and why?"

### Work Notes for Multi-Session Tasks

For features spanning multiple sessions, add session logs as **comments on the Linear issue**. This keeps all context in one place and visible to anyone viewing the issue.

**Session log format** (add as Linear comment):

```markdown
## Session: <date> - <Focus Area>

**Context reviewed**:

- Read <file> - understood <what>

**Applicable invariants**: INV-X, INV-Y

**Completed**:

- [x] <task>

**Discovered**:

- <insight or issue found>

**Next steps**:

1. <next task>
```

**Key decisions** should be added to the issue description or as a dedicated comment.

### Request Protocol for Blockers

When blocked by tech debt or a bug that's outside current scope:

1. Create a new Linear issue with label `Improvement` or `Bug`
2. Include: problem statement, proposed solution, affected files, acceptance criteria
3. Link it to the parent issue if relevant
4. Continue with workaround if possible, or stop and surface to Kris
5. When the fix lands, update the original issue and continue

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

### Abstractions should fully own their domain

A helper that extracts part of a workflow but leaves the caller managing the rest adds indirection without reducing complexity. If you're creating an abstraction for session lifecycle, it should handle find/create, run work, AND track status - not just find/create while the caller still manages status with separate calls. Partial abstractions can be worse than no abstraction because they add a layer of indirection while still requiring the caller to understand the full workflow.

### Always use current-generation Claude models

When specifying Claude models, always use the latest generation:

- **Haiku**: `anthropic/claude-haiku-4.5` (not `claude-3-haiku`)
- **Sonnet**: `anthropic/claude-sonnet-4.5` or `anthropic/claude-sonnet-4-20250514` (not `claude-3-sonnet` or `claude-3.5-sonnet`)
- **Opus**: `anthropic/claude-opus-4.5` (not `claude-3-opus`)

The "3" and "3.5" series are deprecated. Always default to 4.5 generation models. Check model defaults in `env.ts`, database seeds, and any hardcoded model strings when touching AI-related code.
