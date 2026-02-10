# Legacy Codebase Exploration (threa-bak)

**IMPORTANT: Read this document after every compaction to maintain context.**

---

## Solo-First Philosophy

**Critical insight from planning:** Threa isn't a chat app that happens to have AI. For solo founders, it's an **AI-powered knowledge management system** that grows into team chat.

### The Value Proposition Hierarchy

| Stage              | Primary Value                              | Secondary Value                  |
| ------------------ | ------------------------------------------ | -------------------------------- |
| Solo founder (1)   | Thinking partner + personal knowledge base | Future-proofing for team         |
| Small team (2-5)   | Shared knowledge + AI assistant            | Less "where was that discussed?" |
| Growing (6-50)     | Institutional memory                       | Onboarding new hires faster      |
| Scale-up (50-1000) | Knowledge graph + smart search             | Reduced information overload     |

### Core Reframe

**Old framing (team-first):** "Slack, but with AI and knowledge graphs"
**New framing (solo-first):** "Your AI co-founder that never forgets. When you hire, your team inherits your brain."

For solo use:

- **Scratchpad** is the entry point (not channels)
- **AI companion** is optional, toggleable (not always-on @mentions)
- **Knowledge capture** happens automatically from day one
- **Files** are first-class citizens (upload, search, reference)

When team arrives:

- Channels and DMs activate
- The knowledge base is already populated
- New hires can search the founder's thinking

### Scratchpads: The Primary Stream Type

Scratchpads merge the concepts of "notes to self" and "thinking space with AI". Users can create multiple scratchpads, each focused on a topic.

**Examples:**

- "Redis Research" - exploring caching options
- "Q4 Planning" - business strategy thinking
- "Random Thoughts" - catch-all for quick notes

**No magic defaults.** Users pin the scratchpads they use most. This supports multiple "defaults" based on individual workflow.

**AI Companion Toggle:**

Each scratchpad has a companion mode toggle:

- **Off** - You're writing notes. AI is passive (watching, learning, indexing for GAM, but not responding).
- **On** - AI persona responds to your messages.
- **Next message only** - Toggle companion for just the next message, then auto-off.

```
┌─────────────────────────────────────────────────────┐
│ Redis Research                      [Ariadne ▼] 🔘 │
├─────────────────────────────────────────────────────┤
│ You: Here's that article on CRDT sync              │
│      https://example.com/crdts                     │
│                                                    │
│ You: Actually, let me think through offline-first  │
│      [Companion ON]                                │
│                                                    │
│ You: What are the tradeoffs between CRDTs and      │
│      operational transforms for a chat app?        │
│                                                    │
│ Ariadne: For a chat application, the key tradeoffs │
│          are...                                    │
│                                                    │
│ You: Good point. Going with CRDTs.                 │
│      [Companion OFF]                               │
│                                                    │
│ You: TODO: research Yjs vs Automerge               │
└─────────────────────────────────────────────────────┘
```

**Sharing & Promotion:**

- Scratchpads start as private (single member: the creator)
- Can be shared with specific people (becomes collaborative scratchpad)
- Can be promoted to a channel (if the topic warrants team visibility)
- Pinning lets users organize their sidebar however they want

### Files: First-Class Citizens

Files are critical for solo founders who:

- Upload research documents
- Attach screenshots and designs
- Reference code snippets
- Store meeting notes

Files should be:

- Searchable (text extraction + embeddings)
- Referenceable by AI across conversations
- Part of GAM (important file content becomes memos)

### Feature Priority (Solo-First)

#### Phase 1: Solo Foundation

1. Workspaces + Streams schema
2. **Scratchpad stream type** (the home base)
3. Basic messaging (events + projection)
4. **AI companion toggle** (Ariadne on/off)
5. **File uploads** (attach, store, display)

#### Phase 2: Knowledge Layer

6. File text extraction (PDFs, docs → searchable)
7. Basic GAM (memos from scratchpad content)
8. Search (find your own stuff)

#### Phase 3: Team Ready

9. Channels (public/private)
10. DMs (one-on-one)
11. Invitations (add team members)
12. Threads (branching conversations)

#### Phase 4: Intelligence

13. Knowledge explorer (graph view of memos)
14. Cross-conversation context (AI knows what you discussed elsewhere)
15. Integrations (GitHub, Notion, etc.)

---

## Exploration Plan

### Phase 1: High-Level Overview

- [x] Examine root configuration files (package.json, tsconfig, vite.config)
- [x] Map the directory structure
- [x] Identify major components and their relationships
- [x] Understand the build/dev setup
- [x] Document the tech stack

### Phase 2: Detailed Analysis

- [x] Server architecture (entry points, middleware, routing)
- [x] Database layer (repositories, migrations, queries)
- [x] Services layer (business logic, patterns used)
- [x] Authentication system (WorkOS integration)
- [x] Real-time features (Socket.io, subscriptions)
- [x] Frontend architecture (React patterns, state management)
- [x] Shared code between frontend/backend
- [x] Testing approach

### Phase 3: Assessment

- [x] Identify good patterns worth preserving
- [x] Document anti-patterns and problems
- [x] List fundamental issues the rewrite should fix
- [x] Identify what doesn't need fixing

---

## Phase 1: High-Level Overview

### Directory Structure

```
threa-bak/
├── package.json              # Single monolithic package (NOT a workspace)
├── tsconfig.json             # Frontend-only TypeScript config
├── tsconfig.server.json      # Server-specific config
├── vite.config.ts            # Vite with PWA, proxies to backend
├── docker-compose.yml        # PostgreSQL + Redis
├── src/
│   ├── frontend/             # React frontend
│   │   ├── App.tsx           # Entry with simple URL routing
│   │   ├── types.ts          # Frontend type definitions (10KB!)
│   │   ├── auth/             # Auth context + hooks
│   │   ├── components/       # UI components
│   │   ├── contexts/         # React contexts (Theme, Offline, Query)
│   │   ├── hooks/            # Feature hooks (useStream, useBootstrap, etc.)
│   │   ├── lib/              # Utilities, offline storage
│   │   ├── mutations/        # TanStack mutations
│   │   ├── queries/          # TanStack queries
│   │   ├── stores/           # Zustand stores
│   │   └── workers/          # Web workers (outbox)
│   ├── server/               # Express backend
│   │   ├── index.ts          # Entry point with app factory
│   │   ├── config.ts         # Environment configuration
│   │   ├── lib/              # Core utilities
│   │   ├── middleware/       # Express middleware
│   │   ├── repositories/     # Data access layer
│   │   ├── routes/           # HTTP route handlers
│   │   ├── services/         # Business logic
│   │   ├── websockets/       # Socket.io setup
│   │   ├── workers/          # Background jobs (AI, embedding)
│   │   ├── ai/               # AI agent code (Ariadne)
│   │   └── evals/            # AI evaluation scripts
│   └── shared/               # Code shared between frontend/backend
│       ├── types/            # Shared type definitions
│       ├── api/              # API contracts
│       ├── slug.ts           # Slug validation
│       └── storage/          # Storage utilities
```

### Tech Stack

**Backend:**

- Runtime: Bun (with `--watch` for dev)
- Framework: Express.js
- Database: PostgreSQL via `pg` + `squid/pg` (template tags)
- Cache/Pub-Sub: Redis (ioredis)
- WebSocket: Socket.io with Redis adapter
- Auth: WorkOS AuthKit
- Jobs: pg-boss
- Migrations: Custom Umzug-like runner
- AI: Anthropic SDK, Langchain, Langfuse

**Frontend:**

- Framework: React 19
- Build: Vite with PWA plugin
- State: TanStack Query + Zustand
- Real-time: Socket.io-client
- Styling: Tailwind CSS
- Editor: TipTap (rich text)
- Offline: IndexedDB (custom)

**Infrastructure:**

- Docker Compose for local dev
- PWA support with service workers
- Workbox for offline caching

### Major Components

1. **Streams** - The core abstraction. Everything is a stream:
   - `channel` - Public/private channels
   - `thread` - Replies to messages
   - `dm` - Direct messages
   - `incident` - Special incident channels
   - `thinking_space` - AI conversation spaces

2. **Events** - Messages and activities within streams:
   - `message` - Text messages
   - `shared` - Cross-posted messages
   - `member_joined`/`member_left`
   - `thread_started`
   - `stream_created`

3. **Workspaces** - Multi-tenant organization containers

4. **Personas** - AI agent personalities (Ariadne)

5. **Memos** - Knowledge base articles with AI features

---

## Phase 2: Detailed Analysis

### Server Architecture

**Entry Point (`index.ts`)**

- Large file (~475 lines) combining:
  - ShutdownCoordinator class (graceful shutdown)
  - AppContext interface with all dependencies
  - `createApp()` factory function
  - `startServer()` initialization
  - All route registration inline
- Uses DI pattern: services instantiated in factory, passed to handlers
- Graceful shutdown with LB drain time calculation

**Route Registration (Problem Area)**

- ALL routes registered directly in `index.ts` (~130 route definitions)
- Makes it hard to see the full API surface
- No clear separation between concerns
- Each route file exports factory functions that return handlers

**Middleware**

- `pino-http` for logging (sensible defaults)
- `cookie-parser` for auth cookies
- Custom `createAuthMiddleware` for session validation
- Error handler middleware

### Database Layer

**Connection Management (`lib/db.ts`)**

- Clean utilities: `withTransaction`, `withClient`
- Factory function `createDatabasePool`
- Exports `sql` from squid/pg

**Repository Pattern** - EXCELLENT

- Each repository is a namespace object with static-like methods
- All methods take `PoolClient` as first parameter (enables transaction control)
- Internal row types (snake_case) mapped to domain types (camelCase)
- Pure data access - no side effects, no outbox publishing
- Example: `StreamRepository`, `UserRepository`, etc.

**Migrations**

- 21+ migrations in SQL files
- Custom runner in `lib/migrations.ts`
- Sequential naming: `001_schema_v2.sql`, etc.

### Services Layer

**Service Pattern** - Classes with constructor DI

- Take `Pool` in constructor
- Use repositories for data access
- Manage transactions, publish outbox events
- Example:
  ```typescript
  class StreamService {
    constructor(private pool: Pool) {}
    async createStream(params: CreateStreamParams): Promise<Stream> {
      return withTransaction(this.pool, async (client) => {
        const stream = await StreamRepository.insertStream(client, {...})
        await publishOutboxEvent(client, ...)
        return stream
      })
    }
  }
  ```

**Problem: StreamService is 76KB!**

- 2000+ lines of code
- Handles everything: streams, events, threads, DMs, notifications, read state
- Should be split into multiple services

**Outbox Pattern** - EXCELLENT

- All real-time events go through outbox table
- `publishOutboxEvent()` called within transactions
- `OutboxListener` polls outbox, publishes to Redis
- Ensures exactly-once delivery with `FOR UPDATE SKIP LOCKED`
- Type-safe payloads with `OutboxPayloadMap`

### Authentication System

**WorkOS Integration** - Clean and complete

- `WorkosAuthService` class implementing `AuthService` interface
- `StubAuthService` for testing (uses simple token format)
- Session stored in sealed cookie (`wos_session`)
- Auto-refresh handled transparently

**Auth Flow:**

1. Login redirects to WorkOS
2. Callback receives code, exchanges for session
3. Session stored in cookie
4. Middleware validates on each request

### Real-time Features

**Socket.io Setup (`websockets/stream-socket.ts`)** - 874 lines

- Redis adapter for horizontal scaling
- Cookie-based auth (parses `wos_session`)
- Room naming convention: `ws:{workspaceId}:stream:{streamId}`
- Three room types:
  - `stream` - Per-stream events
  - `workspace` - Sidebar updates
  - `user` - Personal notifications

**Event Subscription Pattern:**

- Subscribes to Redis channels for each event type
- Giant switch statement handles each event type
- Re-emits to appropriate rooms

**Problem:**

- Single file handles ALL event types
- Lots of inline database queries
- Hard to test in isolation

### Frontend Architecture

**State Management:**

1. TanStack Query - API data caching
2. Zustand stores - Local UI state
3. IndexedDB - Offline persistence

**Key Hooks:**

- `useStream` (DEPRECATED, 35KB!) - Legacy IndexedDB approach
- `useStreamWithQuery` (18KB) - TanStack Query approach
- `useWorkspaceSocket` - Workspace-level real-time updates
- `useBootstrap` - Initial data loading
- `usePaneManager` - Multi-pane layout management

**Offline Support (`lib/offline/`):**

- Custom IndexedDB abstraction
- Stores: streams, events, drafts, outbox
- `outbox-worker.ts` processes pending messages
- Handles optimistic updates with client-generated IDs

**Problem: Type Duplication**

- `frontend/types.ts` has 300+ lines of type definitions
- Many overlap with `shared/types/`
- No single source of truth

**Routing:**

- Simple `window.location.pathname` matching in App.tsx
- No proper router library
- Works but not scalable

### Testing Approach

**Server Tests:**

- Located in `__tests__` directories
- E2E tests hit real DB
- Uses separate test database
- Test utilities for setup/teardown

**No Frontend Tests Visible**

- No test files in frontend/
- Manual testing only?

---

## Phase 3: Assessment

### Good Patterns (Keep)

1. **Repository Pattern** ✅
   - Clean separation of data access
   - PoolClient as first param enables transaction control
   - Row types internal, domain types exported
   - No side effects in repositories

2. **Outbox Pattern** ✅
   - Reliable event delivery
   - Type-safe with payload maps
   - Exactly-once with `FOR UPDATE SKIP LOCKED`
   - Atomic: publishes in same transaction as mutations

3. **Service Pattern** ✅
   - Classes with constructor DI
   - Pool injection allows testing
   - Transaction management in services
   - Clear business logic location

4. **Handler Factory Pattern** ✅
   - `createStreamHandlers({...deps})`
   - Returns object of handlers
   - Dependencies explicit

5. **Auth Service Abstraction** ✅
   - Interface allows stub for testing
   - Clean WorkOS integration
   - Session refresh transparent

6. **Logging Configuration** ✅
   - pino-http with sensible defaults
   - Only logs errors/warnings (not every request)
   - Ignores /health
   - Redacts sensitive headers

7. **Graceful Shutdown** ✅
   - LB drain time calculation
   - Connection tracking
   - Proper cleanup order

8. **Room Naming Convention** ✅
   - Clear pattern: `ws:{workspace}:stream:{id}`
   - Separate rooms for stream/workspace/user

9. **Prefixed IDs** ✅
   - `stream_xxx`, `event_xxx`, `user_xxx`
   - Makes debugging easier

### Anti-Patterns (Avoid)

1. **God Service (StreamService 76KB)** ❌
   - Should be split: StreamService, EventService, ThreadService, etc.
   - Currently handles 15+ different concerns

2. **Giant Socket Handler (874 lines)** ❌
   - Single switch statement for all events
   - Inline DB queries
   - Hard to test

3. **Route Registration in index.ts** ❌
   - 130+ routes mixed with setup code
   - Hard to see API surface
   - Should use centralized routes.ts

4. **Type Duplication** ❌
   - Frontend types.ts vs shared/types/
   - No single source of truth
   - Drift between definitions

5. **Deprecated Code Living Alongside New** ❌
   - `useStream` marked deprecated but still there
   - `LegacyApp.tsx` exists
   - Increases confusion

6. **No Frontend Tests** ❌
   - Critical logic untested
   - Offline system is complex

7. **Monolithic Package** ❌
   - Single package.json for everything
   - Can't deploy frontend/backend separately
   - All deps in one place

8. **dotenv Usage** ❌
   - Bun loads .env automatically
   - Double loading is unnecessary

9. **Config Module Pattern** ❌
   - Exports individual constants AND config object
   - Inconsistent usage throughout

10. **Inline SQL in Socket Handler** ❌
    - Should use services/repositories
    - Breaks encapsulation

### Fundamental Problems to Fix

1. **Split StreamService**
   - Extract: EventService, ThreadService, MembershipService
   - Keep StreamService focused on stream CRUD
   - Each service <500 lines

2. **Centralize Routes**
   - All HTTP routes in `routes.ts`
   - All Socket events in `socket.ts`
   - Clear section comments

3. **Monorepo Structure**
   - Separate packages: `apps/backend`, `apps/frontend`
   - Shared types in `packages/shared`
   - Independent deployment

4. **Remove Redis for Socket.io**
   - Use `@socket.io/postgres-adapter` instead
   - One less infrastructure dependency
   - Already using PostgreSQL for outbox

5. **Clean Type System**
   - Single source of truth for types
   - Share between frontend/backend
   - Generated API types would be ideal

6. **Modern IDs (ULID)**
   - Current: UUID-based prefixed IDs
   - Better: ULID-based (sortable by time)

### What Doesn't Need Fixing

1. **Repository Pattern** - Keep as-is
2. **Outbox Pattern** - Keep as-is, just change Redis → Postgres adapter
3. **Auth Service Pattern** - Keep as-is
4. **Handler Factory Pattern** - Keep as-is
5. **Database Utilities** - `withTransaction`, `withClient` are good
6. **Logging Configuration** - Keep pino-http setup
7. **Graceful Shutdown Logic** - Keep the coordinator pattern
8. **Room Naming Convention** - Keep `ws:...` pattern

---

## Running Notes

### Key Observations

1. The codebase shows clear evolution - started simple, got complex
2. AI features (Ariadne, memos, embeddings) add significant complexity
3. Offline-first was attempted but adds substantial complexity
4. The stream model is powerful but overloaded

### Size Metrics (Warning Signs)

| File              | Lines | Problem?                                    |
| ----------------- | ----- | ------------------------------------------- |
| stream-service.ts | 2000+ | YES - God service                           |
| stream-socket.ts  | 874   | YES - Too much in one place                 |
| useStream.ts      | 1000+ | YES - Should use TanStack Query             |
| stream-routes.ts  | 1000+ | Borderline - many routes is expected        |
| index.ts (server) | 475   | YES - Route registration should be separate |

### What the PoC Proves

1. Stream-based model works for threaded discussions
2. Outbox pattern is reliable for real-time
3. WorkOS auth integration is straightforward
4. Repository pattern scales well
5. TanStack Query + Socket.io is a good combo

### What the PoC Failed At

1. Keeping services focused (god objects)
2. Type consistency across boundaries
3. Test coverage (especially frontend)
4. Separating concerns in real-time code
5. Managing offline complexity

---

## Files Worth Copying

| Source                              | Purpose             | Notes             |
| ----------------------------------- | ------------------- | ----------------- |
| `lib/db.ts`                         | Transaction helpers | Already copied    |
| `services/auth-service.ts`          | WorkOS integration  | Already copied    |
| `services/stub-auth-service.ts`     | Test auth           | Already copied    |
| `lib/logger.ts`                     | Pino config         | Already copied    |
| `lib/cookies.ts`                    | Cookie parsing      | Already copied    |
| `lib/outbox-events.ts`              | Event definitions   | Pattern to follow |
| `lib/outbox-listener.ts`            | Event processing    | Pattern to follow |
| `repositories/stream-repository.ts` | Data access pattern | Pattern to follow |

---

## Recommendations for Rewrite

### Immediate (Do Now)

1. Keep current monorepo structure (apps/backend, apps/frontend)
2. Use @socket.io/postgres-adapter (no Redis)
3. Keep repository pattern exactly as-is
4. Keep outbox pattern exactly as-is
5. Centralize routes in routes.ts (already done)

### Short-term (When Adding Features)

1. Create separate services from the start:
   - StreamService (CRUD only)
   - EventService (messages, edits)
   - MembershipService (join/leave/roles)
   - SystemMessageService
   - ThreadService
2. Each service <500 lines rule

### Long-term (Consider Later)

1. Generated API types from OpenAPI or similar
2. Frontend testing with Playwright/Vitest
3. Event sourcing for audit trail
4. Proper offline sync (CRDTs?)

---

## AI Features Deep Dive

**IMPORTANT: This section was added after a focused exploration of AI-specific code.**

### AI Directory Structure

```
src/server/
├── ai/
│   └── ariadne/
│       ├── agent.ts         # 535 lines - LangChain ReAct agent, multi-provider
│       ├── prompts.ts       # 121 lines - System prompts for modes
│       ├── tools.ts         # 641 lines - Tool definitions + CitationAccumulator
│       └── researcher.ts    # 588 lines - Iterative research with plan/search/reflect
├── workers/
│   ├── index.ts             # Worker registry + pg-boss setup
│   ├── ariadne-trigger.ts   # Listens to outbox, creates jobs for @mentions
│   ├── ariadne-worker.ts    # Executes agent runs, streams thinking events
│   ├── classification-worker.ts  # Classifies messages as knowledge-worthy
│   ├── embedding-worker.ts  # Generates embeddings for messages
│   ├── enrichment-worker.ts # Enriches memos with AI-generated summaries
│   └── memo-worker.ts       # Auto-creates memos from high-signal messages
├── evals/
│   ├── cli.ts               # CLI for running evals with presets
│   ├── runner.ts            # Eval execution + Langfuse tracking
│   ├── llm-verifier.ts      # LLM-as-judge for topic similarity
│   ├── dataset.ts           # Fixture-based eval datasets
│   ├── config.ts            # Model presets + env config
│   └── ariadne/             # Agent-specific evals
│       ├── runner.ts        # ~800 lines, agent eval runner
│       ├── dataset.ts       # Test cases
│       └── seed-data.ts     # Synthetic workspace data
├── services/
│   └── persona-service.ts   # 437 lines - Agent persona CRUD
└── lib/
    ├── ai-providers.ts      # 637 lines - Multi-provider chat/embeddings
    └── ollama.ts            # Local SLM integration
```

### Component Analysis

#### 1. Ariadne Agent Core (`ai/ariadne/`)

**agent.ts (535 lines)** - Main agent implementation

- Uses LangChain's `createReactAgent` with tool calling
- **Multi-provider support**: Anthropic, OpenAI, OpenRouter, Ollama
- **Two modes**:
  1. `retrieval` - Search memos/messages, answer questions with citations
  2. `thinking_partner` - Full reasoning partner for "thinking spaces"
- **Streaming**: Real-time thinking events via Socket.io
- **Session tracking**: Creates `AgentSession` records in DB for replay

**Good patterns:**

- Clean separation of modes via prompts
- CitationAccumulator tracks sources across tool calls
- Configurable model per persona
- Graceful error handling with summarization

**Problems:**

- 535 lines is borderline too large
- Mode switching logic is implicit in prompts
- No easy way to add new modes

**prompts.ts (121 lines)** - Clean and focused

- `RETRIEVAL_PROMPT` - For knowledge retrieval
- `THINKING_PARTNER_PROMPT` - For extended reasoning
- Well-crafted with XML-style sections
- Includes citation formatting instructions

**tools.ts (641 lines)** - Tool definitions

- `search_memos` - Vector search over memos
- `search_messages` - Vector search over messages
- `get_stream_context` - Fetch recent messages in a stream
- `get_thread_history` - Fetch full thread context
- `web_search` - Brave Search integration
- `fetch_url` - Web page fetching

**Good patterns:**

- `CitationAccumulator` class tracks sources elegantly
- Tools return structured results with metadata
- Clear separation between search and retrieval

**Problems:**

- Some tools do inline SQL (should use repositories)
- Web tools are tightly coupled to implementation

**researcher.ts (588 lines)** - Iterative research agent

- Plan → Search → Reflect loop
- Multiple search iterations with refinement
- Quality scoring of results
- **Problem**: Complex state machine, hard to debug

#### 2. AI Workers (`workers/`)

**ariadne-trigger.ts** - Job creation

- Listens to outbox for messages mentioning @ariadne or personas
- Creates pg-boss jobs for agent execution
- Extracts persona from mention text

**ariadne-worker.ts (~500 lines)** - Agent execution

- Processes pg-boss jobs
- Creates AgentSession in DB
- Streams thinking events via outbox → Socket.io
- Posts final response as message
- Updates session with summary on completion

**Good patterns:**

- Separation of trigger vs worker
- Session persistence enables replay
- Thinking events are ephemeral but informative

**Problems:**

- Worker is stateful and hard to test
- Error recovery is basic
- No rate limiting per user/workspace

**classification-worker.ts** - Content classification

- Uses AI to determine if messages contain "knowledge"
- Flags high-signal content for memo creation
- Configurable model (defaults to Haiku)

**embedding-worker.ts** - Vector embeddings

- Generates embeddings for messages/memos
- **Hybrid approach**: Tries Ollama first (free), falls back to OpenAI
- Batching support for efficiency

**enrichment-worker.ts** - Memo enrichment

- Generates summaries for memos
- Creates embeddings for memos
- Updates memo metadata

**memo-worker.ts** - Auto memo creation

- Creates memos from highly-rated messages
- Uses classification results to decide

#### 3. Multi-Provider System (`lib/ai-providers.ts`)

**637 lines** - Comprehensive but getting large

**Model string format**: `provider:model`

- `anthropic:claude-haiku-4-5-20251001`
- `openai:gpt-4o-mini`
- `openrouter:google/gemma-3-12b-it`
- `ollama:granite4:1b`

**Functions:**

- `chatWithModel()` - Unified chat across providers
- `generateEmbedding()` - Single text embedding
- `generateEmbeddingsBatch()` - Batch embeddings
- `classifyWithModel()` - Content classification
- `calculateCost()` - Cost estimation

**Good patterns:**

- Lazy client initialization
- Unified interface across providers
- Cost tracking built-in
- Ollama-first for embeddings (free)

**Problems:**

- File is getting large (637 lines)
- Should split into separate provider modules
- Duplicate `parseModelString` in llm-verifier.ts

#### 4. Persona Service (`services/persona-service.ts`)

**437 lines** - Agent persona management

**AgentPersona fields:**

- `name`, `slug`, `description`, `avatarEmoji`
- `systemPrompt` - Custom instructions
- `enabledTools` - Array of tool names
- `model` - Provider:model string
- `temperature`, `maxTokens`
- `allowedStreamIds` - Access control
- `isDefault`, `isActive`

**Good patterns:**

- Progressive disclosure (Level 1 metadata vs full config)
- Workspace-scoped personas

**Improvement needed:**

- `isActive` boolean → `status` enum (pending/active/disabled/archived)
- `is_system` boolean → `managed_by` enum (system/workspace)

**Problems:**

- Uses inline SQL instead of repository pattern
- Should follow same pattern as other services

#### 5. Evaluation Framework (`evals/`)

**runner.ts (~433 lines)** - Eval execution

- Runs evals against real models
- Calculates accuracy, precision, recall
- Per-scenario breakdown
- Langfuse integration for tracking

**llm-verifier.ts (437 lines)** - LLM-as-judge

- Multi-provider support
- Topic similarity verification
- JSON response parsing with fallbacks
- Error classification (rate limit, auth, timeout)

**cli.ts (193 lines)** - Clean CLI

- Model presets (fast, local, cheap, quality, best)
- `--compare` mode runs all configured models
- `--verbose` for detailed output

**ariadne/runner.ts (~800 lines)** - Agent evals

- Seeds test workspace with synthetic data
- Runs agent against test queries
- Verifies response quality

**Good patterns:**

- Fixture-based datasets
- Langfuse tracking for debugging
- Model comparison mode
- Detailed metrics per scenario

**Problems:**

- Ariadne evals are complex and slow
- No CI integration visible
- Dataset management is manual

#### 6. Frontend AI Integration

**useAgentSessions.ts (421 lines)**

- Tracks agent sessions for a stream
- Persists across page reloads
- Real-time updates via Socket.io events:
  - `session:started`
  - `session:step`
  - `session:completed`
- Merges API data with live updates

**useAriadneThinking.ts (183 lines)**

- Ephemeral thinking indicator
- Auto-clears after completion
- Simpler than full sessions

**AgentThinkingEvent.tsx (486 lines)**

- Rich UI for agent sessions
- Collapsible step timeline
- Tool result expansion
- Duration tracking
- Persona avatar support

**ToolResultViewer.tsx (348 lines)**

- Slide-out panel for full results
- Search result parsing and navigation
- Copy functionality
- Peek preview on hover

**AriadneThinkingIndicator.tsx (191 lines)**

- Inline thinking indicator
- Step type icons (Brain, Search, Wrench)
- Animated status badges

**usePersonasQuery.ts (44 lines)**

- TanStack Query for personas
- 5-minute stale time

**Good patterns:**

- Session persistence enables history
- Thinking indicator is non-blocking
- Tool results are navigable

**Problems:**

- Two overlapping systems (sessions vs thinking)
- Frontend components are large (should split)
- No error boundary for AI failures

---

### AI Features Assessment

#### Good Patterns (Keep)

1. **Multi-Provider Architecture** ✅
   - `provider:model` string format is clean
   - Lazy client initialization
   - Cost tracking built-in
   - Easy to add new providers

2. **Session Persistence** ✅
   - Agent sessions stored in DB
   - Enables replay and history
   - Separate from ephemeral events

3. **Outbox-Based Triggering** ✅
   - @mentions trigger via outbox
   - Decoupled from request handling
   - Reliable delivery

4. **Persona System** ✅
   - Customizable agent personalities
   - Tool access control
   - Model selection per persona

5. **Eval Framework** ✅
   - Langfuse integration
   - Model comparison
   - Fixture-based testing

6. **Ollama-First Embeddings** ✅
   - Free local embeddings when available
   - Transparent fallback to OpenAI

7. **Thinking Event Streaming** ✅
   - Real-time visibility into agent work
   - Non-blocking UI updates

#### Anti-Patterns (Avoid)

1. **Duplicate Model Parsing** ❌
   - `parseModelString` exists in both ai-providers.ts and llm-verifier.ts
   - Should be centralized

2. **Inline SQL in AI Code** ❌
   - Tools and persona service have inline queries
   - Should use repository pattern

3. **Two Thinking Systems** ❌
   - `useAgentSessions` for persistent
   - `useAriadneThinking` for ephemeral
   - Should consolidate

4. **Large Monolithic Files** ❌
   - ai-providers.ts at 637 lines
   - agent.ts at 535 lines
   - Consider splitting

5. **No Rate Limiting** ❌
   - Agent runs aren't rate-limited
   - Could be expensive if abused

6. **Complex Researcher State Machine** ❌
   - researcher.ts is hard to follow
   - Iterative loop is implicit

7. **Hardcoded Ariadne** ❌
   - Ariadne treated as special entity separate from personas
   - `ariadne-trigger.ts`, `ariadne-worker.ts`, `useAriadneThinking.ts`
   - Creates parallel code paths instead of unified persona system
   - See "Architectural Revision" section for fix

#### What to Steal

1. **Multi-provider system** - The `provider:model` format and `chatWithModel` abstraction
2. **Session persistence** - AgentSession schema and step tracking
3. **Outbox-based triggers** - Pattern for decoupling AI execution
4. **Persona configuration** - AgentPersona schema with tool access control
5. **Eval infrastructure** - Langfuse integration, model comparison CLI
6. **Thinking event types** - Socket.io event schema for real-time updates
7. **Tool result viewer** - UI patterns for displaying tool outputs
8. **Cost calculation** - `calculateCost` function with model pricing

#### What to Improve

1. **Split ai-providers.ts**
   - `lib/ai/anthropic.ts`
   - `lib/ai/openai.ts`
   - `lib/ai/ollama.ts`
   - `lib/ai/embeddings.ts`
   - Shared types in `lib/ai/types.ts`

2. **Consolidate thinking systems**
   - Keep only `useAgentSessions`
   - Remove ephemeral-only thinking

3. **Add rate limiting**
   - Per-user token budgets
   - Per-workspace limits
   - Graceful degradation

4. **Simplify researcher**
   - Make state machine explicit
   - Consider removing or replacing with simpler approach

5. **Repository for personas**
   - `PersonaRepository` with PoolClient param
   - `PersonaService` uses repository

6. **CI eval integration**
   - Run evals on PR
   - Track accuracy over time

---

### AI Files Worth Copying

| Source                            | Purpose              | Notes                                                      |
| --------------------------------- | -------------------- | ---------------------------------------------------------- |
| `lib/ai-providers.ts`             | Multi-provider chat  | Split into modules first                                   |
| `ai/ariadne/prompts.ts`           | Agent prompts        | Rename to `ai/agent/prompts.ts`, make persona-configurable |
| `ai/ariadne/tools.ts`             | Tool definitions     | Rename to `ai/agent/tools.ts`, extract CitationAccumulator |
| `services/persona-service.ts`     | Persona CRUD         | Convert to repository pattern, add `is_system` support     |
| `workers/ariadne-trigger.ts`      | Outbox → job pattern | Rename to `agent-trigger.ts`, make persona-generic         |
| `evals/cli.ts`                    | Eval CLI             | Clean and useful                                           |
| `evals/config.ts`                 | Model presets        | Good configuration pattern                                 |
| Frontend `AgentThinkingEvent.tsx` | Session UI           | Rename, make persona-aware (show persona avatar/name)      |

### AI Size Metrics

| File                    | Lines | Problem?                 |
| ----------------------- | ----- | ------------------------ |
| ai-providers.ts         | 637   | Borderline - split       |
| ariadne/agent.ts        | 535   | Borderline - monitor     |
| ariadne/tools.ts        | 641   | YES - should split       |
| ariadne/researcher.ts   | 588   | YES - too complex        |
| evals/ariadne/runner.ts | ~800  | YES - simplify           |
| AgentThinkingEvent.tsx  | 486   | Borderline - could split |
| useAgentSessions.ts     | 421   | OK for hook              |
| persona-service.ts      | 437   | OK                       |

---

### Architectural Revision: No Hardcoded Ariadne

**Problem:** The legacy code has Ariadne hardcoded as a special entity separate from the persona system:

| File                           | Issue                               |
| ------------------------------ | ----------------------------------- |
| `ariadne-trigger.ts`           | Special listener just for @ariadne  |
| `ariadne-worker.ts`            | Dedicated worker for Ariadne        |
| `useAriadneThinking.ts`        | Frontend hook specific to Ariadne   |
| `AriadneThinkingIndicator.tsx` | UI component with her name baked in |
| `ai/ariadne/*`                 | Directory named after one persona   |

This creates two parallel systems: "Ariadne" and "Personas" - a classic anti-pattern.

**Solution:** Ariadne should be a **seed persona** - the default one that ships with Threa, managed by the system (not user-editable). All code paths treat personas uniformly.

**Schema:**

```sql
CREATE TABLE personas (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,            -- NULL for system personas (no FK, application manages)
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    managed_by TEXT NOT NULL,     -- 'system' | 'workspace' (validated in code)
    status TEXT NOT NULL DEFAULT 'active',  -- 'pending' | 'active' | 'disabled' | 'archived'
    -- ... other fields (system_prompt, model, enabled_tools, etc.)
    UNIQUE (workspace_id, slug)   -- Slugs unique within workspace (NULL = system)
);
```

**Why TEXT over database enums / Why no foreign keys:**

- Business logic in code, not DB - keeps validation in one place
- Simpler migrations - no `ALTER TYPE ... ADD VALUE` hassle
- Portable - can move to any store without losing constraints that lived in DB
- Decoupled - no strict ordering requirements for inserts/deletes

**Why enums (in code) over booleans:**

- `status` vs `is_active`: Distinguishes `disabled` (temporary) from `archived` (permanent), extensible
- `managed_by` vs `is_system`: Clearer intent, extensible (could add `'user'` for personal personas later)

**Code mapping:**

| Legacy                         | New                          | Rationale                                |
| ------------------------------ | ---------------------------- | ---------------------------------------- |
| `ai/ariadne/`                  | `ai/agent/`                  | Generic agent code, not persona-specific |
| `ariadne-trigger.ts`           | `agent-trigger.ts`           | Triggers on @mention of ANY persona      |
| `ariadne-worker.ts`            | `agent-worker.ts`            | Executes ANY persona                     |
| `useAriadneThinking.ts`        | DELETE                       | Use `useAgentSessions` for all personas  |
| `AriadneThinkingIndicator.tsx` | `AgentThinkingIndicator.tsx` | Shows persona avatar/name dynamically    |

**@mention resolution flow:**

1. Parse mention text for persona slug (e.g., `@ariadne`, `@customer-support`)
2. Look up persona in DB: first workspace-scoped, then system
3. If not found, fall back to default system persona (Ariadne)
4. Execute agent with that persona's config (model, tools, prompt)

**Benefits:**

- Single code path for all agents
- Personas are fully data-driven
- Easy to add new system personas (e.g., `@helper` for onboarding)
- Users can create personas that behave identically to system ones
- No special-casing in trigger/worker/frontend code

**Seed data:**

```sql
INSERT INTO personas (id, workspace_id, slug, name, managed_by, status, system_prompt, model)
VALUES (
    'persona_system_ariadne',
    NULL,  -- Not workspace-scoped
    'ariadne',
    'Ariadne',
    'system',   -- Threa-managed, users can't edit
    'active',
    'You are Ariadne, a helpful assistant...',
    'anthropic:claude-sonnet-4-20250514'
);
```

---

### Architectural Decision: Agent Eagerness & Relevance Scoring

**Context**: Power users want multiple agents with distinct expertise areas that naturally "pitch in" based on relevance—like colleagues where Martin responds because he knows databases, Adolfo knows frontend, Kate knows compliance.

**Decision**: Agents have an **eagerness level** that controls how proactively they respond, combined with **relevance scoring** to determine which agent (if any) should respond to a message.

#### Eagerness Spectrum

| Level      | Behavior                                       |
| ---------- | ---------------------------------------------- |
| `silent`   | Only responds when explicitly @mentioned       |
| `reserved` | Responds to direct questions in their domain   |
| `engaged`  | Proactively offers input when highly relevant  |
| `eager`    | Jumps in frequently, lower relevance threshold |

#### Persona Expertise Profile (Pre-computed, Stored)

Each persona has embeddings that define their domain:

```sql
-- On personas: expertise profile (identity)
ALTER TABLE personas ADD COLUMN expertise_triggers TEXT;  -- "database optimization, SQL, PostgreSQL..."
ALTER TABLE personas ADD COLUMN expertise_embedding vector(1536);  -- Pre-computed from expertise_triggers

-- On stream_persona_roster: eagerness per stream (behavior)
-- Eagerness is per-stream, not global. Ariadne might be 'engaged' in #engineering but 'silent' in #random.
```

The `expertise_triggers` field is user-tunable without touching the system prompt. "Make Ariadne respond more to architecture questions" → add "system design, architecture, trade-offs" to her triggers.

Over time, GAM can contribute topic embeddings based on what the agent has discussed.

#### Per-Stream Agent Rosters

Not all personas monitor all streams. Users control who's "in the room":

```sql
CREATE TABLE stream_persona_roster (
    stream_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    added_by TEXT NOT NULL,  -- User who added this persona
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stream_id, persona_id)
);
```

This is critical for cost control—only rostered personas evaluate messages in that stream.

#### Relevance Scoring (Per-Message)

When a message arrives in a stream with rostered personas:

| Factor                            | Weight             | Notes                                      |
| --------------------------------- | ------------------ | ------------------------------------------ |
| Direct @mention                   | ∞                  | Instant win, skip other scoring            |
| Reply to agent's last message     | Heavy (~0.4)       | Conversation continuity                    |
| Embedding similarity to expertise | Medium (~0.3)      | Cosine sim against `expertise_embedding`   |
| GAM topic match                   | Medium (~0.2)      | "Has this agent discussed similar before?" |
| Time since agent last spoke       | Negative           | Cooldown, prevents domination              |
| Question detected                 | Small boost (~0.1) | Agents more likely to respond to questions |

#### Response Selection Flow

```
Message arrives
    ↓
Compute message embedding (once, ~$0.0001)
    ↓
Check: explicit @mention? → that persona responds
    ↓
Get stream roster (which personas monitor this stream?)
    ↓
For each rostered persona:
    score = weighted_sum(factors)
    if score > persona.eagerness_threshold → candidate
    ↓
Highest scoring candidate responds (or none if all below threshold)
    ↓
Winner generates response via LLM (only cost if someone responds)
```

#### Cost Profile

- **1 embedding per message** (~$0.0001) - always computed
- **N cosine similarity comparisons** (nearly free) - CPU only
- **1 LLM call** only for the winning agent - no response = no cost

The lightweight classifier (embedding + cosine sim + heuristics) runs on every message. Expensive LLM calls only happen when an agent actually responds.

#### Eagerness Thresholds

| Eagerness  | Threshold | Meaning                      |
| ---------- | --------- | ---------------------------- |
| `silent`   | ∞         | Only @mention triggers       |
| `reserved` | 0.7       | High confidence required     |
| `engaged`  | 0.5       | Moderate relevance triggers  |
| `eager`    | 0.3       | Low bar, responds frequently |

#### Multi-Agent Conflict Resolution

When multiple agents exceed their threshold:

1. **Highest relevance score wins** - avoids multiple agents info-dumping
2. Ties broken by: persona priority (if set) → most recent activity → random

Future consideration: allow "panel discussion" mode where multiple agents can respond, but default to single-winner.

#### Heuristics Layer

Beyond embeddings, structural signals help:

- **Conversation continuity**: "Is this a reply to the agent's previous message?" → heavy weight
- **Question detection**: Message contains `?` → slight boost for engaged/eager agents
- **Cooldown**: Agent spoke in last N messages → negative weight (prevents domination)
- **Explicit topic keywords**: Message contains words from `expertise_triggers` → boost

#### Integration with GAM

Over time, agents build "memory" of topics they've engaged with:

1. Agent responds to message about "Redis caching"
2. GAM notes: this persona engaged with "caching", "Redis", "performance"
3. Future messages about caching get boosted relevance for this persona

This creates organic expertise development—agents become known for topics they've discussed.

#### Schema Summary

```sql
-- Persona: identity + expertise (WHO they are)
ALTER TABLE personas ADD COLUMN expertise_triggers TEXT;
ALTER TABLE personas ADD COLUMN expertise_embedding vector(1536);

-- Stream roster: behavior per stream (HOW they behave here)
CREATE TABLE stream_persona_roster (
    stream_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    eagerness TEXT NOT NULL DEFAULT 'silent',  -- 'silent' | 'reserved' | 'engaged' | 'eager'
    added_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stream_id, persona_id)
);

-- GAM topic tracking (future)
CREATE TABLE persona_topic_engagements (
    id TEXT PRIMARY KEY,
    persona_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    engagement_count INTEGER NOT NULL DEFAULT 1,
    last_engaged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (persona_id, topic)
);
```

#### Phase Recommendation

This is a **power user feature**, not MVP:

- **Phase 1**: @mention only (eagerness = `silent` for all)
- **Phase 2**: Basic relevance scoring (conversation continuity heuristic)
- **Phase 3**: Full eagerness spectrum + embedding-based relevance
- **Phase 4**: GAM integration for organic expertise development

---

### Architectural Decision: Graph-Based Threading

**Context**: Slack's threading model limits threads to 1 level deep. But ideas are graphs, not trees. We want discussions to branch arbitrarily—a thread can spawn from a message in another thread.

**Decision**: Threads are streams. Streams form a graph via `parent_stream_id`. Visibility is inherited from the root (non-thread) stream.

#### Why Not Slack-Style?

Slack's model:

- Thread ID = parent message timestamp
- Thread replies are messages with `thread_ts` set
- No separate entity for threads
- **Limited to 1 level of nesting**

Our model:

- Threads are streams with `type = 'thread'`
- `parent_stream_id` points to parent (can be channel OR another thread)
- `parent_message_id` points to the message being discussed
- **Unlimited nesting depth**

#### The Graph Structure

```
#engineering (channel)
├── Message M1: "Let's discuss caching"
│   └── Thread T1 (parent_stream_id: #engineering, parent_message_id: M1)
│       ├── Message M2: "Redis vs Memcached?"
│       │   └── Thread T2 (parent_stream_id: T1, parent_message_id: M2)
│       │       ├── Message M3: "Redis has better persistence"
│       │       └── Message M4: "Agree, but Memcached simpler for pure cache"
│       └── Message M5: "What about Valkey?"
└── Message M6: "Different topic entirely"
```

T2 branches from T1—this is impossible in Slack. Each thread is a full stream with its own event sequence.

#### Visibility vs Membership

| Concept       | Who                                       | Determined By                             |
| ------------- | ----------------------------------------- | ----------------------------------------- |
| **Can view**  | All members of root stream                | `root_stream_id` → check membership there |
| **Is member** | Participated (replied, reacted, followed) | Explicit in `stream_members`              |

**Why this distinction matters:**

1. **Notifications**: Only thread members get notified
2. **`with:@user` search**: Finds threads where user participated
3. **Unread counts**: Only for threads you're a member of
4. **Agent scoping**: "What has Jane discussed?" → only her threads

#### The `root_stream_id` Denormalization

To avoid recursive queries for visibility:

```sql
CREATE TABLE streams (
    parent_stream_id TEXT,    -- Immediate parent (graph edge)
    parent_message_id TEXT,   -- Message this branches from
    root_stream_id TEXT,      -- Non-thread ancestor (visibility source)
);
```

When creating a thread:

- If parent is channel/scratchpad: `root_stream_id = parent_stream_id`
- If parent is thread: `root_stream_id = parent.root_stream_id`

#### Efficient Queries

```sql
-- Can user view this thread?
SELECT 1 FROM stream_members
WHERE stream_id = (SELECT root_stream_id FROM streams WHERE id = ?)
  AND user_id = ?;

-- Get all threads user participated in
SELECT s.* FROM streams s
JOIN stream_members sm ON sm.stream_id = s.id
WHERE sm.user_id = ? AND s.type = 'thread';

-- Find threads branching from a message (for inline preview)
SELECT * FROM streams
WHERE parent_message_id = ?;
```

#### Thread Membership Triggers

Users become thread members when they:

- Reply to the thread
- React to a message in the thread
- Explicitly follow the thread
- Are @mentioned in the thread

This is tracked in `stream_members` with `joined_at` indicating when they became a participant.

#### Inline Thread Summaries

With `root_stream_id`, we can show inline summaries in the parent stream:

```
┌─────────────────────────────────────────────────────┐
│ Jane: Let's discuss caching options                 │
│                                                     │
│ ┌─ Thread (3 replies, 2 participants) ────────────┐ │
│ │ Latest: "Going with Redis for persistence"      │ │
│ │ [Expand]                                        │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

Query: `SELECT * FROM streams WHERE parent_message_id = ? LIMIT 1` + aggregate stats.

---

### Architectural Decision: Streaming & Recovery

**Context**: Agent responses should stream to multiple clients simultaneously. Clients may disconnect and reconnect. Servers may crash mid-stream.

**Key constraint**: No LLM provider (Anthropic, OpenAI, etc.) supports reconnecting to an in-flight stream. If the connection drops, that stream is lost.

**Solution**: Step-level durability, not token-level. Token streaming is ephemeral; step completion is persisted.

#### Multi-Client Streaming

```
Clients A, B, C watching thread
         │
    Socket.io room: stream:{streamId}
         │
    Server receives tokens from LLM
         │
    1. Broadcast to room (live clients)
    2. Buffer tokens (for reconnection)
         │
    LLM Provider Stream
```

**Client reconnection flow**:

1. Client disconnects (network blip, tab switch, etc.)
2. Client reconnects, sends: `{ sessionId, lastTokenPosition: 847 }`
3. Server sends buffered tokens 848+ from storage
4. Client seamlessly continues receiving

#### Server Recovery

Agent runs are multi-step. Checkpoint at step boundaries:

```
Agent Session
├── Step 1: Think about query      ✓ persisted
├── Step 2: search_memos()         ✓ persisted
├── Step 3: search_messages()      ✓ persisted
├── Step 4: Generate response      ← server dies here, tokens lost
```

**Recovery**:

1. New server picks up orphaned session (status = 'running', stale heartbeat)
2. Loads completed steps 1-3 as context
3. Restarts step 4 from scratch
4. Clients reconnect, see: "Resuming..." → new tokens

#### Schema

```sql
CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    status TEXT NOT NULL,  -- 'pending' | 'running' | 'streaming' | 'completed' | 'failed'
    current_step INTEGER,
    server_id TEXT,        -- Which server instance is handling this
    heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE agent_session_steps (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    step_type TEXT NOT NULL,  -- 'thinking' | 'tool_call' | 'tool_result' | 'response'
    content JSONB,
    tokens_used INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (session_id, step_number)
);

-- Token buffer for client reconnection (could also use Redis for ephemeral data)
CREATE TABLE agent_token_buffer (
    session_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, position)
);

-- Index for orphan detection
CREATE INDEX idx_agent_sessions_orphan
    ON agent_sessions (status, heartbeat_at)
    WHERE status = 'running';
```

#### Server Heartbeat

```typescript
// Every 5s while processing an agent session
await db.query(sql`
  UPDATE agent_sessions
  SET heartbeat_at = NOW()
  WHERE id = ${sessionId}
`)
```

#### Orphan Recovery

```typescript
// On server startup or periodic job
const orphaned = await db.query(sql`
  SELECT * FROM agent_sessions
  WHERE status = 'running'
  AND heartbeat_at < NOW() - INTERVAL '30 seconds'
`)

for (const session of orphaned) {
  // Claim this session
  await db.query(sql`
    UPDATE agent_sessions
    SET server_id = ${thisServerId}, heartbeat_at = NOW()
    WHERE id = ${session.id}
  `)

  // Load completed steps, restart from last checkpoint
  await resumeSession(session)
}
```

#### Recovery Matrix

| Scenario                  | Solution                             | Data Loss                     |
| ------------------------- | ------------------------------------ | ----------------------------- |
| Client disconnects        | Token buffer + position-based replay | None                          |
| Client joins mid-stream   | Same buffer, start from position 0   | None                          |
| Server dies between steps | Resume from last checkpoint          | None                          |
| Server dies mid-step      | Restart current step                 | Partial tokens from that step |
| LLM provider dies         | Retry with exponential backoff       | Current step tokens           |

**Key insight**: Design for step-level durability. The granularity of checkpointing matches the natural granularity of agent work (think → tool → tool → respond).

---

### Architectural Decision: Event Sourcing + Projections

**Context**: Chat is naturally event-based. Messages, edits, reactions, membership changes are all events. The legacy outbox pattern is already 70% event sourcing.

**Decision**: Use events as source of truth, with projections for query performance.

#### Why Both?

**Events give us**:

- **Audit trail**: Who said what, when, what got edited/deleted
- **Temporal queries**: "Show me #engineering last Tuesday at 3pm"
- **Sync foundation**: Replay events to catch up (offline-first later)
- **Undo/redo**: Natural fit
- **Edit history**: Show previous versions of a message

**Projections give us**:

- **Query performance**: "Last 50 messages" without replaying events
- **Current state access**: Show message content without computing edits
- **Aggregations**: Reaction counts, reply counts
- **Full-text search**: Search current message content

**Messages NEED a projection from day one**. Computing current state by replaying `message_created` → `message_edited` → `message_edited` on every read doesn't scale.

#### The Model

```
stream_events (source of truth)     messages (projection)
┌─────────────────────────────┐     ┌─────────────────────────┐
│ message_created {content}   │ ──▶ │ INSERT                  │
│ message_edited {content}    │ ──▶ │ UPDATE content          │
│ message_deleted             │ ──▶ │ UPDATE deleted_at       │
│ reaction_added              │ ──▶ │ UPDATE reactions JSONB  │
└─────────────────────────────┘     └─────────────────────────┘
```

Both tables exist from day one. Events are source of truth (for sync, audit, undo), projections are what you query.

**What we're NOT doing (yet)**:

- Complex derived projections (e.g., per-user unread counts)
- Event versioning/upcasting
- Separate read replicas

**Database philosophy** (applies to all schemas):

- No foreign keys - application manages relationships
- No database enums - use TEXT, validate in code
- Business logic in one place (code), not spread across DB + code

#### Event Schema

```sql
CREATE TABLE stream_events (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    sequence BIGINT NOT NULL,  -- Monotonic per stream, for sync
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    actor_id TEXT,  -- User or persona who caused this event
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (stream_id, sequence)
);

CREATE INDEX idx_stream_events_sync
    ON stream_events (stream_id, sequence);
```

#### Message Projection Schema

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    author_id TEXT NOT NULL,  -- User or persona
    author_type TEXT NOT NULL,  -- 'user' | 'persona'
    content TEXT NOT NULL,
    content_format TEXT NOT NULL DEFAULT 'markdown',  -- 'markdown' | 'plaintext'
    thread_id TEXT,           -- If this is a thread reply
    reactions JSONB NOT NULL DEFAULT '{}',  -- { "👍": ["user_1", "user_2"], "❤️": ["user_3"] }
    reply_count INTEGER NOT NULL DEFAULT 0,
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Denormalized for efficient "latest messages" query
    sequence BIGINT NOT NULL  -- Copied from the message_created event
);

CREATE INDEX idx_messages_stream_sequence
    ON messages (stream_id, sequence DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_messages_thread
    ON messages (thread_id, sequence)
    WHERE thread_id IS NOT NULL AND deleted_at IS NULL;
```

#### Event Types

```typescript
type StreamEvent =
  | {
      type: "message_created"
      payload: {
        messageId: string
        content: string
        authorId: string
        authorType: "user" | "persona"
        threadId?: string
      }
    }
  | { type: "message_edited"; payload: { messageId: string; content: string; editedAt: string } }
  | { type: "message_deleted"; payload: { messageId: string; deletedAt: string } }
  | { type: "reaction_added"; payload: { messageId: string; emoji: string; userId: string } }
  | { type: "reaction_removed"; payload: { messageId: string; emoji: string; userId: string } }
  | { type: "member_joined"; payload: { userId: string } }
  | { type: "member_left"; payload: { userId: string } }
  | { type: "thread_created"; payload: { threadId: string; parentMessageId: string } }
  | { type: "agent_session_started"; payload: { sessionId: string; personaId: string } }
  | { type: "agent_session_step"; payload: { sessionId: string; step: AgentStep } }
  | { type: "agent_session_completed"; payload: { sessionId: string } }
```

#### Event → Projection Flow

```typescript
// In a transaction: append event + update projection atomically
async function createMessage(params: CreateMessageParams): Promise<Message> {
  return withTransaction(pool, async (client) => {
    // 1. Get next sequence number
    const sequence = await getNextSequence(client, params.streamId)

    // 2. Append event (source of truth)
    await EventRepository.insert(client, {
      id: eventId(),
      streamId: params.streamId,
      sequence,
      eventType: 'message_created',
      payload: { messageId: params.id, content: params.content, ... },
      actorId: params.authorId,
    })

    // 3. Update projection (query target)
    const message = await MessageRepository.insert(client, {
      id: params.id,
      streamId: params.streamId,
      sequence,
      content: params.content,
      authorId: params.authorId,
      ...
    })

    return message
  })
}
```

#### Sync API (Foundation for Offline)

```typescript
// Client requests events after a known sequence
GET /api/streams/:streamId/events?after=1234&limit=100

// Response
{
  events: StreamEvent[],
  hasMore: boolean,
  latestSequence: number
}
```

This API shape supports future offline: client stores last sequence, requests delta on reconnect. The client applies events to its local projection (IndexedDB) the same way the server does.

---

### Architectural Decision: Memos (GAM Knowledge System)

**Context**: The core differentiator of Threa is tackling "Slack, where critical information comes to die." Memos are the foundation of GAM (General Agentic Memory) - extracting and preserving knowledge from conversations.

**Decision**: Memos are first-class entities from day one, not an afterthought.

#### What Are Memos?

Memos are **summaries of important information** extracted from conversations, linked to their source messages. They form the knowledge layer that agents use for retrieval.

```
Conversation                          Memo
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ A: We decided to use Redis  │      │ Title: Caching Decision     │
│    for caching because...   │ ───▶ │ Summary: Team chose Redis   │
│ B: Makes sense, let's do it │      │   for caching due to...     │
│ A: I'll set it up tomorrow  │      │ Sources: [msg_1, msg_2]     │
└─────────────────────────────┘      │ Tags: [architecture, redis] │
                                     └─────────────────────────────┘
```

#### Memo Creation Flow

1. **Message arrives** → `message_created` event
2. **Classification worker** (cheap model) → determines if knowledge-worthy
3. **Memorizer worker** → if worthy, extracts key information into memo
4. **Enrichment worker** → generates summary, tags, embedding
5. **Memo available** → for search, agents, knowledge explorer

#### Schema

```sql
CREATE TABLE memos (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    content TEXT,                -- Optional longer-form content
    source_message_ids TEXT[],   -- Links to original messages
    source_stream_id TEXT,       -- Stream where conversation happened
    tags TEXT[],                 -- Auto-generated or manual tags

    -- Search
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', title || ' ' || summary || ' ' || COALESCE(content, ''))
    ) STORED,
    embedding vector(1536),

    -- Metadata
    created_by TEXT,             -- User or 'system' for auto-generated
    status TEXT NOT NULL DEFAULT 'active',  -- 'draft' | 'active' | 'archived'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memos_workspace ON memos (workspace_id);
CREATE INDEX idx_memos_search ON memos USING GIN (search_vector);
CREATE INDEX idx_memos_embedding ON memos USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_memos_tags ON memos USING GIN (tags);
```

#### Classification: What Makes Something Memo-Worthy?

Not every message is knowledge. The classifier looks for:

| Memo-worthy                 | Not memo-worthy                |
| --------------------------- | ------------------------------ |
| Decisions made              | Casual chat                    |
| Problems solved             | Greetings                      |
| Architecture discussions    | Status updates without context |
| Process explanations        | "Thanks!" / "Got it"           |
| External links with context | Links without explanation      |
| Action items with outcomes  | Questions without answers      |

The classifier runs on cheap/fast models (Haiku, local Ollama) since it processes every message.

#### How Agents Use Memos

When an agent is invoked:

1. **Query parsing** → extract key terms from user's question
2. **Memo search** → hybrid search over memos (keyword + semantic)
3. **Source retrieval** → fetch linked messages for full context
4. **Response generation** → answer with citations to memos/messages

```typescript
// Agent tool: search_memos
const results = await searchMemos({
  workspaceId,
  query: "redis caching decision",
  limit: 10,
})

// Returns memos with source links
// Agent can cite: "According to the caching decision memo [1], the team chose Redis because..."
```

#### Knowledge Graph (Future)

Memos can link to each other, forming a knowledge graph:

```
[Caching Decision] ──relates-to──▶ [Performance Requirements]
        │                                    │
        ▼                                    ▼
[Redis Setup Guide] ◀──implements── [Infrastructure Plan]
```

This enables:

- "Show me everything related to caching"
- Graph-based exploration in UI
- Agent traversal for deeper context

**For MVP**: Memos link to source messages only. Graph links come later.

#### Manual vs Auto Memos

| Type   | Created by                         | Use case                                   |
| ------ | ---------------------------------- | ------------------------------------------ |
| Auto   | Classification + Memorizer workers | Capture knowledge passively                |
| Manual | Users                              | Intentionally document something important |

Both have the same schema. Manual memos might skip classification but still get enrichment (embedding, tags).

---

### Architectural Decision: Hybrid Search

**Context**: Search is critical for knowledge retrieval. The PoC proved that hybrid search (keyword + semantic) is valuable - searching "scones" finds "biscuits" because same domain.

**Decision**: Implement hybrid search from day one with filter operators.

#### Search Components

1. **Full-text search** (Postgres) - exact/keyword matching
2. **Vector search** (pgvector) - semantic similarity
3. **Weighted combination** - 60% keyword, 40% semantic (tunable)

#### Filter Operators

| Operator      | Meaning                                  | Example                |
| ------------- | ---------------------------------------- | ---------------------- |
| `from:@user`  | Messages authored by user                | `from:@jane`           |
| `with:@user`  | Messages in streams where user is member | `with:@jane with:@joe` |
| `in:#channel` | Messages in specific channel             | `in:#engineering`      |
| `is:thread`   | Only thread messages                     | `is:thread`            |
| `is:dm`       | Only direct messages                     | `is:dm`                |
| `before:date` | Messages before date                     | `before:2025-01-01`    |
| `after:date`  | Messages after date                      | `after:2024-06-01`     |

**Example**: `scones with:@jane with:@joe is:thread`

- Finds thread messages
- Where Jane and Joe both participated
- Semantically related to "scones" (matches "biscuits", "baking", etc.)

#### Schema Additions

```sql
-- Full-text search
ALTER TABLE messages ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX idx_messages_search ON messages USING GIN (search_vector);

-- Vector search (pgvector extension)
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE messages ADD COLUMN embedding vector(1536);

CREATE INDEX idx_messages_embedding ON messages
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

#### Search Flow

```typescript
async function search(query: SearchQuery): Promise<SearchResult[]> {
  // 1. Parse query into terms and filters
  const { terms, filters } = parseSearchQuery(query.text)
  // "scones with:@jane is:thread" → { terms: "scones", filters: { with: ["jane"], is: ["thread"] } }

  // 2. Build filter conditions
  const filterConditions = buildFilterConditions(filters)

  // 3. Run both searches in parallel
  const [keywordResults, semanticResults] = await Promise.all([
    keywordSearch(terms, filterConditions),
    semanticSearch(terms, filterConditions), // terms → embedding via API
  ])

  // 4. Combine with Reciprocal Rank Fusion (RRF)
  return combineWithRRF(keywordResults, semanticResults, {
    keywordWeight: 0.6,
    semanticWeight: 0.4,
  })
}
```

#### Embedding Generation

Messages get embeddings async via worker (same pattern as legacy):

1. `message_created` event triggers embedding job
2. Worker generates embedding (Ollama-first, fallback to OpenAI)
3. Updates `messages.embedding` column

New messages may not have embeddings yet - search falls back to keyword-only until embedding is ready.

---

## Memo System Deep Dive

**IMPORTANT: This section documents the legacy memo implementation for reference during rewrite.**

### Directory Structure

```
src/server/
├── services/
│   ├── memo-service.ts              # 635 lines - Core CRUD, retrieval logging
│   ├── memo-scoring-service.ts      # 426 lines - Content evaluation
│   ├── memo-revision-service.ts     # 260 lines - Overlap detection
│   ├── enrichment-service.ts        # ~150 lines - Contextual headers
│   └── memo-evolution/
│       ├── evolution-service.ts     # ~80 lines - Main orchestrator
│       ├── similarity-checker.ts    # ~180 lines - Event-based similarity
│       └── reinforcement-tracker.ts # ~150 lines - Recency decay
├── workers/
│   ├── memo-worker.ts               # 319 lines - Memo creation pipeline
│   ├── classification-worker.ts     # 490 lines - SLM + Haiku classification
│   ├── enrichment-worker.ts         # 274 lines - Message enrichment
│   └── embedding-worker.ts          # 207 lines - Batch embeddings
├── routes/
│   └── memo-routes.ts               # 203 lines - HTTP handlers
└── lib/migrations/
    ├── 018_memory_system.sql        # 242 lines - Core schema
    ├── 021_memo_category.sql        # 34 lines - Category enum
    └── 023_memo_reinforcements.sql  # 56 lines - Reinforcement tracking
```

### Core Concepts

#### 1. What Are Memos?

Memos are **semantic pointers to valuable conversations**, not extracted content. They store:

- `summary` - Auto-generated or user-provided description
- `topics` - Array of tags for categorization
- `anchor_event_ids` - Links to the actual messages (source of truth)
- `context_*` - Window of surrounding context for retrieval

Key insight: Memos point TO content, they don't duplicate it. This means:

- Source messages can evolve (edits preserved)
- No sync issues between memo and source
- Retrieval fetches current content from anchors

#### 2. Lazy Enrichment Strategy

Messages aren't enriched immediately. Three tiers:

| Tier | What              | Trigger                                              |
| ---- | ----------------- | ---------------------------------------------------- |
| 0    | Unprocessed       | Default state                                        |
| 1    | Basic embedding   | Structural score ≥ 3 + classification                |
| 2    | Contextual header | Social signals (2+ reactions, 2+ replies, retrieved) |

**Contextual header**: AI-generated summary like "In the context of discussing Redis caching options, Jane explained..." - embeds better than raw message.

#### 3. Memo Evolution

Memos aren't static. They evolve via:

**Reinforcement**: When similar content appears, existing memo gets reinforced:

- `anchor_event_ids` grows (adds new source)
- `confidence` increases (5% per reinforce, capped at 1.0)
- Recency bonus: 10% for last 7 days, 5% for last 30 days

**Supersession**: When better content replaces old memo:

- Old memo archived
- New memo created with reference to old

**Decay**: Unused memos lose confidence over time (10% per month)

#### 4. Dual-tier Classification

Two-stage classification optimizes cost vs accuracy:

```
Message arrives
    ↓
Structural pre-filter (score < 2 → skip)
    ↓
SLM (Ollama granite4:350m - free, fast)
    ↓ if uncertain
Haiku (paid, accurate)
    ↓ if confident + knowledge
Queue for embedding
```

Structural signals checked:

- Code blocks, lists, links
- Announcement/explanation/decision patterns
- Length, line count
- Trivial patterns ("thanks", "ok", "lol")

### Database Schema

**Core tables:**

```sql
-- Memos: semantic pointers to conversations
CREATE TABLE memos (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    topics TEXT[],
    category TEXT,  -- announcement|decision|how-to|insight|reference|event|feedback
    anchor_event_ids TEXT[] NOT NULL,  -- Links to source messages
    context_stream_id TEXT,
    context_start_event_id TEXT,
    context_end_event_id TEXT,
    participant_ids TEXT[],
    primary_answerer_id TEXT,
    confidence NUMERIC NOT NULL DEFAULT 0.5,
    retrieval_count INTEGER NOT NULL DEFAULT 0,
    last_retrieved_at TIMESTAMPTZ,
    helpfulness_score NUMERIC NOT NULL DEFAULT 0,
    source TEXT NOT NULL,  -- 'user' | 'system' | 'ariadne'
    created_by TEXT,
    visibility TEXT NOT NULL DEFAULT 'workspace',
    visible_to_stream_ids TEXT[],
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dimension-flexible embeddings (provider-aware)
CREATE TABLE memo_embeddings_768 (
    memo_id TEXT PRIMARY KEY,
    embedding vector(768),
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memo_embeddings_1536 (
    memo_id TEXT PRIMARY KEY,
    embedding vector(1536),
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Message enrichment tracking
ALTER TABLE text_messages ADD COLUMN contextual_header TEXT;
ALTER TABLE text_messages ADD COLUMN enrichment_tier INTEGER NOT NULL DEFAULT 0;
ALTER TABLE text_messages ADD COLUMN enrichment_signals JSONB NOT NULL DEFAULT '{}';

-- Reinforcement audit trail
CREATE TABLE memo_reinforcements (
    id TEXT PRIMARY KEY,
    memo_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    reinforcement_type TEXT NOT NULL,  -- 'original' | 'merge' | 'thread_update'
    similarity_score NUMERIC,
    llm_verified BOOLEAN NOT NULL DEFAULT false,
    weight NUMERIC NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Retrieval logging (for evolution)
CREATE TABLE retrieval_log (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    query TEXT NOT NULL,
    query_embedding vector(1536),
    requester_type TEXT NOT NULL,  -- 'ariadne' | 'user' | 'system'
    retrieved_memo_ids TEXT[],
    retrieved_event_ids TEXT[],
    retrieval_scores JSONB,
    user_feedback TEXT,  -- 'positive' | 'negative' | 'neutral'
    feedback_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expert routing
CREATE TABLE expertise_signals (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    questions_answered INTEGER NOT NULL DEFAULT 0,
    answers_cited_by_ariadne INTEGER NOT NULL DEFAULT 0,
    positive_reactions_received INTEGER NOT NULL DEFAULT 0,
    answers_marked_helpful INTEGER NOT NULL DEFAULT 0,
    expertise_score NUMERIC NOT NULL DEFAULT 0,
    last_activity_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, user_id, topic)
);
```

### Worker Pipeline

**Data flow:**

```
Message Posted
    ↓
Structural pre-filter (score ≥ 3?)
    ↓ yes
ClassificationWorker (SLM → Haiku if uncertain)
    ↓ knowledge_candidate
EmbeddingWorker (batch, Ollama-first)
    ↓
EnrichmentWorker (if signals met: reactions/replies/retrieved)
    ↓ generates contextual_header
MemoWorker
    ↓
SimilarityChecker (find similar via event embeddings)
    ↓
Evolution decision: create_new | reinforce | supersede | skip
    ↓
Memo created/updated + embedding stored + reinforcement tracked
```

**Worker configurations:**

| Worker               | Job type             | Batch | Poll | Singleton |
| -------------------- | -------------------- | ----- | ---- | --------- |
| ClassificationWorker | `ai.classify`        | 1     | 5s   | -         |
| EmbeddingWorker      | `ai.embed`           | 50    | 2s   | -         |
| EnrichmentWorker     | `memory.enrich`      | 1     | 5s   | 5 min     |
| MemoWorker           | `memory.create-memo` | 1     | 5s   | 24 hours  |

### Key Services

**MemoService** (635 lines):

- `createMemo()` - Full creation with auto-summary, topics, context detection
- `getMemos()` - List with pagination, topic filtering, content enrichment
- `logRetrieval()` - Track what gets retrieved
- `recordExpertiseSignal()` - Track who knows what
- `createFromAriadneSuccess()` - Auto-memo from good agent responses

**MemoScoringService** (426 lines):

- `getContentSignals()` - Extract structural signals
- `score()` - Calculate memo-worthiness (0-100)
- `classifyCategory()` - LLM-based categorization

**MemoEvolutionService** (modular):

- `evaluateForEvolution()` - Decide action based on similarity
- `reinforceMemo()` - Add anchor, boost confidence
- Similarity thresholds: 0.65 (consider), 0.85 (trust embeddings)

### Good Patterns (Keep)

1. **Semantic pointers, not content duplication** ✅
   - Memos link to anchors, don't copy content
   - Source of truth remains in messages
   - Edits automatically reflected

2. **Lazy enrichment** ✅
   - Don't process everything immediately
   - Social signals indicate value
   - Saves compute on trivial messages

3. **Event-based similarity checking** ✅
   - Compare event embeddings, not memo embeddings
   - Same embedding space for consistency
   - Enables intelligent deduplication

4. **Reinforcement with decay** ✅
   - Confidence grows with reinforcement
   - Decays without activity
   - Recency bonuses for fresh content

5. **Dual-tier classification** ✅
   - Fast/free SLM for most messages
   - Expensive model only when uncertain
   - Structural pre-filter saves even more

6. **Provider-flexible embeddings** ✅
   - Separate tables for 768/1536 dimensions
   - Can switch providers without migration
   - Ollama-first for cost savings

7. **Retrieval logging** ✅
   - Track what gets retrieved and when
   - User feedback loop
   - Data for future improvements

8. **Expert routing** ✅
   - Track who knows what
   - Based on questions answered, citations, reactions
   - Useful for "@who knows about X?"

### Anti-Patterns (Avoid)

1. **MemoService at 635 lines** ❌
   - Should split: MemoService (CRUD), RetrievalService, ExpertiseService
   - Too many responsibilities in one place

2. **Inline SQL in services** ❌
   - Services should use repositories
   - No `MemoRepository` exists

3. **Complex similarity thresholds** ❌
   - 0.65, 0.85 magic numbers
   - Should be configurable
   - Hard to tune without explanation

4. **Classification worker at 490 lines** ❌
   - Mix of classification logic and job processing
   - Should separate concerns

5. **Multiple embedding tables** ❌
   - Two tables for different dimensions is awkward
   - Consider: single table with dimension column + CHECK constraint

6. **Enrichment signals in message table** ❌
   - `enrichment_tier`, `enrichment_signals` on `text_messages`
   - Mixes concerns - should be separate table

7. **No clear memo categories** ❌
   - Categories defined in ollama.ts, not centralized
   - Enum scattered across codebase

### What to Keep vs Change

| Legacy Pattern           | Keep?       | Notes                          |
| ------------------------ | ----------- | ------------------------------ |
| Semantic pointers        | ✅ Keep     | Core concept is sound          |
| Lazy enrichment tiers    | ✅ Keep     | Optimize with signals          |
| Event-based similarity   | ✅ Keep     | Consistency in embedding space |
| Reinforcement + decay    | ✅ Keep     | But simplify confidence math   |
| Dual-tier classification | ✅ Keep     | Cost-effective                 |
| Retrieval logging        | ✅ Keep     | Essential for evolution        |
| Expert routing           | ⚠️ Defer    | Nice-to-have, not MVP          |
| Provider-flexible tables | ⚠️ Simplify | Single table, dimension column |
| Enrichment on messages   | ❌ Change   | Separate table                 |
| 635-line MemoService     | ❌ Split    | MemoService + RetrievalService |

### Simplified Schema for Rewrite

```sql
CREATE TABLE memos (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    topics TEXT[],
    category TEXT,
    anchor_event_ids TEXT[] NOT NULL,
    context_stream_id TEXT,
    confidence NUMERIC NOT NULL DEFAULT 0.5,
    retrieval_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'system',
    created_by TEXT,
    visibility TEXT NOT NULL DEFAULT 'workspace',
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memo_embeddings (
    memo_id TEXT PRIMARY KEY,
    embedding vector,  -- Dimension determined by provider
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE message_enrichments (
    message_id TEXT PRIMARY KEY,
    tier INTEGER NOT NULL DEFAULT 0,
    contextual_header TEXT,
    signals JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memo_reinforcements (
    id TEXT PRIMARY KEY,
    memo_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    reinforcement_type TEXT NOT NULL,
    similarity_score NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE retrieval_log (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    query TEXT NOT NULL,
    requester_type TEXT NOT NULL,
    retrieved_memo_ids TEXT[],
    user_feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Size Metrics

| File                     | Lines | Problem?                   |
| ------------------------ | ----- | -------------------------- |
| memo-service.ts          | 635   | YES - split it             |
| classification-worker.ts | 490   | Borderline - extract logic |
| memo-scoring-service.ts  | 426   | OK                         |
| memo-worker.ts           | 319   | OK                         |
| enrichment-worker.ts     | 274   | OK                         |
| memo-revision-service.ts | 260   | OK                         |
| embedding-worker.ts      | 207   | OK                         |
| memo-routes.ts           | 203   | OK                         |

### Files Worth Copying

| Source                    | Purpose                   | Notes                     |
| ------------------------- | ------------------------- | ------------------------- |
| `memo-scoring-service.ts` | Content signals + scoring | Clean patterns            |
| `memo-evolution/`         | Evolution logic           | Modular structure is good |
| `embedding-worker.ts`     | Batch embeddings          | Ollama-first pattern      |
| `enrichment-worker.ts`    | Lazy enrichment           | Queue helpers             |
| `018_memory_system.sql`   | Schema reference          | Simplify for rewrite      |

### Memo Recommendations

#### Immediate (Do Now)

1. Use semantic pointer model (anchors, not content)
2. Implement lazy enrichment with social signals
3. Event-based similarity for deduplication
4. Dual-tier classification (SLM → LLM)
5. Single embedding table with dimension flexibility
6. Separate `message_enrichments` table

#### Short-term (When Building Memos)

1. Split MemoService: MemoService + RetrievalService
2. Create MemoRepository (repository pattern)
3. Retrieval logging from day one
4. Reinforcement tracking

#### Long-term (Consider Later)

1. Expert routing based on retrieval data
2. Knowledge graph connections between memos
3. User feedback loops for training
4. Category taxonomy management

### Vision vs Reality: Comparing to Problem Statement

The problem statement outlines a GAM-based knowledge system. Here's how the legacy implementation compares:

| Problem Statement Vision                                                      | Legacy Implementation                                                  | Status        |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------- |
| **GAM memorizer** - inspects high-value info, stores memos linking to sources | Classification + memo workers create memos with `anchor_event_ids`     | ✅ Aligned    |
| **GAM deep researcher** - iterative plan/search/reflect loop                  | `researcher.ts` exists but marked "too complex"                        | ⚠️ Partial    |
| **Pages** (conversational chunks)                                             | Links to individual messages, not chunks                               | ❌ Missing    |
| **Conversational boundaries** - cheap model extracts conversation scope       | Structural signals (code blocks, patterns), not conversation detection | ❌ Missing    |
| **Knowledge graph** - memos connected for related info discovery              | Flat `topics[]` tags, no graph relationships                           | ❌ Missing    |
| **Knowledge explorer** - graph-based UI                                       | `KnowledgeBrowserModal` is a list with topic filters                   | ⚠️ Simplified |
| **Auto-answer** - answer without explicit reply                               | Not implemented                                                        | ❌ Missing    |
| **Smart notifications** - urgency-based                                       | TODO in problem statement, not built                                   | ❌ Missing    |

#### What Legacy Got Right

1. **Semantic pointers** - Memos link to sources, don't duplicate (aligned with GAM)
2. **Cheap model pre-filtering** - Dual-tier classification matches "run cheap models on all messages"
3. **Lazy enrichment** - Social signals as proxy for "high-value" (smart heuristic)
4. **Retrieval logging** - Foundation for learning what's valuable

#### Critical Gaps

**1. Conversational Boundaries**

Problem statement:

> "the system will run cheap models on all messages in their context, attempting to extract conversational boundaries"

The example shows messages spanning main channel + thread that are "all the same conversation":

```
[10:00] - A: Hey, I'm looking into this ticket: LIN-41231
[10:02] - A: Thanks, do you know the cause of it?
[10:03]    - B (Thread): It's been like this forever...
[10:05] - C (not in thread): Oops, I was also looking into this...
[10:06]    - A (Thread): C mentioned this [link to C]
[16:30]    - A (Thread): I fixed it here: <github link>
```

Legacy uses structural signals (code blocks, announcement patterns) but **doesn't detect this as one conversation**. This is the key missing piece.

**2. Pages vs Individual Messages**

GAM uses "pages" as conversational chunks. Legacy links to individual `anchor_event_ids`. A memo about a decision might link to "let's do X" but miss the 10 messages of discussion.

The schema has `context_start_event_id` and `context_end_event_id` but they're underutilized.

**3. Knowledge Graph**

No memo-to-memo connections. Can't answer "show me everything related to caching" by traversing relationships.

**4. Deep Researcher**

`researcher.ts` (588 lines) attempts GAM's iterative loop but:

- Marked "too complex" in exploration
- Missing the "pages" foundation it needs
- Unclear if actually used

#### Recommendations to Close Gaps

**Immediate (MVP)**

1. **Context windows, not just anchors** - Memos should capture meaningful `context_start` → `context_end` ranges. When creating a memo, expand to include surrounding relevant messages.

2. **Conversation-aware enrichment** - Before creating a memo, identify the conversation boundary. Use cheap model to determine: "Is message X part of the same conversation as message Y?"

**Short-term**

3. **Memo relationships** - Add connections between memos:

   ```sql
   CREATE TABLE memo_links (
       id TEXT PRIMARY KEY,
       source_memo_id TEXT NOT NULL,
       target_memo_id TEXT NOT NULL,
       link_type TEXT NOT NULL,  -- 'relates_to' | 'supersedes' | 'elaborates' | 'contradicts'
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```

4. **Cross-thread conversation detection** - When someone references another message (quote, link, or "as X mentioned"), link those into the same conversation context.

**Long-term**

5. **Knowledge explorer with graph view** - Visual exploration of memo relationships
6. **Auto-answer** - Surface relevant memos inline without explicit @mention
7. **Smart notifications** - Use conversation context + urgency signals

#### Updated Schema for Context Windows

```sql
CREATE TABLE memos (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    topics TEXT[],

    -- Anchor: the key message(s) this memo is about
    anchor_event_ids TEXT[] NOT NULL,

    -- Context window: the full conversation range
    context_stream_id TEXT NOT NULL,
    context_start_sequence BIGINT NOT NULL,
    context_end_sequence BIGINT NOT NULL,

    -- For cross-stream conversations (thread + main channel)
    related_stream_ids TEXT[],

    confidence NUMERIC NOT NULL DEFAULT 0.5,
    retrieval_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'system',
    created_by TEXT,
    visibility TEXT NOT NULL DEFAULT 'workspace',
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The key addition is `related_stream_ids` - when a conversation spans main channel + thread (like the problem statement example), the memo tracks both streams.

---

### Rewrite Recommendations (Solo-First)

**See "Solo-First Philosophy" section at the top for the strategic framing.**

#### Phase 1: Solo Foundation (Do Now)

**Core Infrastructure:**

1. Workspaces schema (multi-tenant from day one, even for solo)
2. Streams schema with `type` enum: `scratchpad`, `channel`, `dm`, `thread`
3. Stream members schema (user ↔ stream relationship)
4. **Events as source of truth** (event sourcing foundation)
5. **Messages projection** (events + projection in same transaction)
6. **Attachments schema** (files are first-class)

**Scratchpad-Specific:** 7. Multiple scratchpads per user (no auto-created default) 8. **Pinning** for user-controlled sidebar organization 9. **AI companion toggle** stored on streams (stream-level, not per-user) 10. Companion state: `off` | `on` | `next_message_only` 11. Sharing: scratchpads can be shared or promoted to channels

**Personas (Minimal):** 12. Personas table with `managed_by` enum (`system` | `workspace`) 13. Seed Ariadne as default system persona 14. Keep `provider:model` format for model selection

**Patterns to Apply:**

- Repository pattern with `PoolClient` as first param
- Outbox pattern for real-time events
- Handler factory pattern for routes
- Prefixed ULIDs for all entity IDs

#### Phase 2: Knowledge Layer (When Scratchpad Works)

**Files:**

1. S3 upload/download integration
2. Text extraction pipeline (PDFs, docs)
3. File embeddings for semantic search

**Basic GAM:** 4. Memos as semantic pointers (anchor to source messages) 5. Lazy enrichment (social signals trigger deeper processing) 6. Basic memo creation from high-signal content 7. Simple search (full-text first, vector later)

**AI Integration:** 8. `lib/ai/` module structure (NOT `ai/ariadne/`) 9. `AgentService` class (<500 lines) - generic, persona-aware 10. Session persistence with step-level checkpointing 11. Outbox-based triggering for companion responses

#### Phase 3: Team Ready (When Solo is Solid)

**Stream Types:**

1. Channels (public/private with slugs)
2. DMs (two or more members, supports group DMs)
3. Threads (nested under messages)

**Team Features:** 4. Invitations and workspace membership 5. @mentions in messages 6. Presence indicators 7. Unread counts and notifications

**Search Upgrades:** 8. Hybrid search (keyword + semantic) 9. Filter operators (`from:@user`, `in:#channel`, etc.)

#### Phase 4: Intelligence (Long-term)

**Knowledge System:**

1. Memo links table (knowledge graph foundation)
2. Knowledge explorer with graph view
3. Cross-conversation context for AI
4. Conversation boundary detection

**Advanced AI:** 5. Dual-tier classification (SLM → LLM escalation) 6. Context windows in memos (sequence ranges) 7. Cross-stream conversation tracking 8. Auto-answer (surface memos without @mention)

**Platform:** 9. Integrations (GitHub, Notion, Figma, etc.) 10. Smart notifications (urgency detection) 11. Expert routing based on retrieval data 12. Cost dashboards per workspace

#### Deferred (Not Priority)

These were in the original recommendations but are premature for solo-first:

- Multi-client token streaming (solo = one client)
- Orphan session recovery (complexity for later)
- Full offline-first with CRDTs (nice-to-have)
- Custom agent framework (LangChain is fine for now)
- Tool marketplace for personas
