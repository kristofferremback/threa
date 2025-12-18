# 002: Agentic Companion

## Problem

The closed PR #5 implemented companion responses as simple chat:

- Fire-and-forget with no durability
- Plain request/response, not agentic
- Doesn't follow GAM pattern
- Wrong abstraction for AI (raw OpenRouter instead of proper SDK)
- No recovery from failures

## Dependencies

- Task 001 (Multi-Listener Outbox) must be complete

## Target State

Durable, retriable agentic pipeline:

1. Message arrives in stream with `companion_mode = 'on'`
2. OutboxListener dispatches durable job to pg-boss
3. Job worker picks up, runs agentic loop with LangGraph
4. Agent follows GAM pattern (search memos, build context, respond)
5. Step-level checkpointing for recovery
6. Response posted as persona message

## Design

### Component Overview

```
OutboxListener (from Task 001)
      │
      │ dispatch job
      ▼
   pg-boss
      │
      │ job picked up
      ▼
CompanionJobWorker
      │
      │ creates session
      ▼
AgentSession (persisted)
      │
      │ runs agent
      ▼
LangGraph Agent
      │
      ├── Tool: search_memos
      ├── Tool: search_messages
      └── Tool: (future tools)
      │
      │ generates response
      ▼
EventService.createMessage()
```

### 1. Vercel AI SDK Integration

Replace `OpenRouterClient` with Vercel AI SDK for:

- Provider abstraction (one API for multiple providers)
- Built-in streaming support
- Tool calling standardization
- Better TypeScript types

```typescript
import { generateText, streamText } from "ai"
import { createOpenRouter } from "@ai-sdk/openrouter"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOllama } from "ollama-ai-provider"
```

### 2. Provider Registry

Parse `provider:model_id` format, route to correct client:

```typescript
// provider:model_id format
// "openrouter:anthropic/claude-sonnet-4.5" -> openrouter client, model "anthropic/claude-sonnet-4.5"
// "anthropic:claude-sonnet-4-20250514" -> anthropic client, model "claude-sonnet-4-20250514"
// "ollama:granite4:350m" -> ollama client, model "granite4:350m"

interface ProviderRegistry {
  getProvider(providerModelString: string): {
    provider: LanguageModelV1
    modelId: string
  }
}
```

For now, only register `openrouter` provider and fail on others.

### 3. pg-boss Job Queue

Durable job queue backed by PostgreSQL:

```typescript
import PgBoss from "pg-boss"

// Job types
interface CompanionJobData {
  streamId: string
  messageId: string
  triggeredBy: string // user ID who sent the message
}

// In server.ts
const boss = new PgBoss(pool)
await boss.start()

// Register worker
boss.work("companion:respond", async (job) => {
  await companionWorker.handleJob(job.data)
})
```

### 4. Agent Sessions (from legacy-exploration.md)

Persistent session tracking for recovery:

```sql
CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,                    -- session_<ulid>
    stream_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    trigger_message_id TEXT NOT NULL,       -- Message that triggered this session
    status TEXT NOT NULL,                   -- 'pending' | 'running' | 'completed' | 'failed'
    current_step INTEGER NOT NULL DEFAULT 0,

    -- For recovery
    server_id TEXT,                         -- Which server instance is handling this
    heartbeat_at TIMESTAMPTZ,

    -- Results
    response_message_id TEXT,               -- Message ID of the response (if completed)
    error TEXT,                             -- Error message (if failed)

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE agent_session_steps (
    id TEXT PRIMARY KEY,                    -- step_<ulid>
    session_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    step_type TEXT NOT NULL,                -- 'thinking' | 'tool_call' | 'tool_result' | 'response'
    content JSONB,                          -- Step-specific data
    tokens_used INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (session_id, step_number)
);

CREATE INDEX idx_agent_sessions_orphan
    ON agent_sessions (status, heartbeat_at)
    WHERE status = 'running';
```

### 5. LangGraph Integration

Agentic loop with tool calling:

```typescript
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph"

const agentGraph = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", executeTools)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent")
  .compile()
```

Tools for GAM pattern:

- `search_memos` - Search knowledge base (memos table, Phase 2)
- `search_messages` - Search conversation history
- `get_context` - Get current stream/workspace context

### 6. CompanionListener

Outbox listener that dispatches jobs:

```typescript
class CompanionListener extends BaseOutboxListener {
  readonly listenerId = "companion"

  async handleEvent(event: OutboxEvent): Promise<void> {
    if (event.eventType !== "message:created") return

    const payload = event.payload as MessageCreatedPayload
    if (payload.message.authorType !== "user") return

    // Check if stream has companion mode enabled
    const stream = await this.streamService.getById(payload.streamId)
    if (stream?.companionMode !== "on") return

    // Dispatch durable job
    await this.boss.send("companion:respond", {
      streamId: payload.streamId,
      messageId: payload.message.id,
      triggeredBy: payload.message.authorId,
    })
  }
}
```

### 7. CompanionJobWorker

Handles the actual agent work:

```typescript
class CompanionJobWorker {
  async handleJob(data: CompanionJobData): Promise<void> {
    // 1. Create or resume session
    const session = await this.getOrCreateSession(data)

    // 2. Load persona and context
    const persona = await this.getPersona(session.streamId)
    const messages = await this.getMessageContext(session.streamId)

    // 3. Run agent with checkpointing
    const response = await this.runAgent(session, persona, messages)

    // 4. Post response as message
    await this.eventService.createMessage({
      streamId: data.streamId,
      authorId: persona.id,
      authorType: "persona",
      content: response,
    })

    // 5. Mark session complete
    await this.completeSession(session.id, responseMessageId)
  }
}
```

### 8. Stub for E2E Tests

Like `StubAuthService`, create stub that doesn't call real AI:

```typescript
class StubCompanionService implements ICompanionService {
  // Records calls for assertions
  public calls: CompanionJobData[] = []

  async handleJob(data: CompanionJobData): Promise<void> {
    this.calls.push(data)
    // Don't actually call AI
  }
}
```

## Implementation Steps

### Phase 1: AI SDK + Provider Registry

1. Install Vercel AI SDK: `bun add ai @ai-sdk/openrouter`
2. Create `apps/backend/src/lib/ai/provider-registry.ts`
3. Create `apps/backend/src/lib/ai/index.ts` (exports)
4. Delete `apps/backend/src/lib/openrouter.ts`
5. Update config to use new provider format

### Phase 2: pg-boss Setup

1. Install pg-boss: `bun add pg-boss`
2. Add to `server.ts` startup
3. Create `apps/backend/src/lib/job-queue.ts` wrapper

### Phase 3: Agent Sessions

1. Create migration `004_agent_sessions.sql`
2. Create `apps/backend/src/repositories/agent-session-repository.ts`
3. Heartbeat and orphan recovery logic

### Phase 4: CompanionListener

1. Create `apps/backend/src/lib/companion-listener.ts`
2. Register in `server.ts`
3. Seed `outbox_listeners` with 'companion' entry

### Phase 5: LangGraph Agent

1. Install LangGraph: `bun add @langchain/langgraph @langchain/core`
2. Create `apps/backend/src/agents/companion-agent.ts`
3. Implement basic tools (search_messages for now, memos later)
4. Step checkpointing

### Phase 6: CompanionJobWorker

1. Create `apps/backend/src/workers/companion-worker.ts`
2. Wire up to pg-boss
3. Integrate agent, session management, response posting

### Phase 7: Stub + Tests

1. Create `apps/backend/src/workers/companion-worker.stub.ts`
2. Update server to use stub when `USE_STUB_COMPANION=true`
3. Unit tests for pure functions (e.g., `parseProviderModel()`)
4. Integration tests for job flow: dispatch → worker picks up → session created → response posted (with stubbed AI)

Note: Behavioral evals for agent quality are out of scope for this task.

## Files to Create

- `apps/backend/src/lib/ai/provider-registry.ts`
- `apps/backend/src/lib/ai/index.ts`
- `apps/backend/src/lib/job-queue.ts`
- `apps/backend/src/lib/companion-listener.ts`
- `apps/backend/src/repositories/agent-session-repository.ts`
- `apps/backend/src/agents/companion-agent.ts`
- `apps/backend/src/workers/companion-worker.ts`
- `apps/backend/src/workers/companion-worker.stub.ts`
- `apps/backend/src/db/migrations/004_agent_sessions.sql`

## Files to Modify

- `apps/backend/src/server.ts` - pg-boss, new listener, worker
- `apps/backend/src/lib/env.ts` - New config options
- `apps/backend/src/services/stream-naming-service.ts` - Use new AI abstraction
- `apps/backend/package.json` - New dependencies

## Files to Delete

- `apps/backend/src/lib/openrouter.ts` - Replaced by AI SDK
- `apps/backend/src/services/ai-service.ts` - From closed PR #5
- `apps/backend/src/services/companion-service.ts` - From closed PR #5

## Decisions

1. **LangGraph**: Yes, use it. Not stupidly complex and gives us a lot for free (checkpointing, visualization, etc.). Moving away from frameworks is a scale problem we don't have yet.
2. **Streaming**: We want token streaming for UX, but implementation can be postponed. Design should not paint us into a corner - see "Streaming & Recovery" in legacy-exploration.md.
3. **Memos**: Deferred. Start with message history + search for context. Memos are a big incremental improvement but not a prerequisite.
4. **Multi-persona**: Use stream's `companion_persona_id` or fall back to system default (Ariadne). Roster-based "most relevant responds" logic is deferred.

## Out of Scope

- Memos/knowledge base (separate task)
- `mentions` mode (@mention detection)
- Rate limiting
- Typing indicators
- Custom workspace personas (only system Ariadne for now)
