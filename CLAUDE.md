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

# Run backend tests
cd apps/backend && bun test
```
