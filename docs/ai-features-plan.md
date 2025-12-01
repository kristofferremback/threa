# AI Features Implementation Plan

**Version:** 1.0
**Created:** November 2025
**Status:** Planning

## Executive Summary

This document outlines the implementation plan for AI-powered features in Threa, focusing on three core capabilities:

1. **Semantic + Full-text Search** - Hybrid search combining vector embeddings with PostgreSQL full-text
2. **Ariadne AI Companion** - An agentic AI assistant invoked via `@ariadne`
3. **Knowledge Base** - AI-assisted extraction and organization of institutional knowledge

### Philosophy

- **SLMs First**: Use small local models (Ollama with granite4:350m) where possible to minimize costs
- **API Fallback**: Escalate to Claude/OpenAI for quality-critical tasks or edge cases
- **Async Everything**: All AI work happens in background jobs via pg-boss
- **Track Everything**: Per-workspace, per-user token and cost tracking
- **Free Tier Excluded**: AI features require a paid plan

---

## Why These Features?

### The Problem

Knowledge workers face recurring challenges with chat-based communication:

1. **Lost Knowledge**: Valuable information gets buried in chat history
2. **Repeat Questions**: Experts answer the same questions repeatedly
3. **Slow Onboarding**: New team members can't find institutional knowledge
4. **Search Limitations**: Keyword search misses semantically similar content

### Our Solution

Rather than treating AI as a bolt-on feature (like Slack's basic thread summarization), we're making it core to the platform:

- **Semantic search** finds content by meaning, not just keywords
- **Ariadne** deflects routine questions, freeing experts for complex work
- **Knowledge emergence** captures institutional wisdom from natural conversations

---

## AI Persona: Ariadne

### Why "Ariadne"?

From Greek mythology, Ariadne gave Theseus the thread that guided him through the labyrinth. This perfectly aligns with Threa's mission:

- **The thread that guides through complexity** - helping users navigate organizational knowledge
- **Memorable and pleasant** - easy to type, pronounce, and remember
- **Historically resonant** - adds character without being obscure

### Persona Design

Ariadne is:

- Helpful and concise
- Honest about uncertainty ("I'm not sure, but here's what I found...")
- Source-citing (always references where information came from)
- Respectful of human expertise (backs off when humans are actively helping)

Future: A persona manager will allow workspaces to customize AI personalities and create specialized bots.

---

## Model Strategy

### Cost Optimization Through Model Selection

| Task                    | Model                  | Cost                 | Why                                    |
| ----------------------- | ---------------------- | -------------------- | -------------------------------------- |
| Classification          | granite4:350m (Ollama) | Free                 | Fast, local, good for binary decisions |
| Classification fallback | Claude Haiku           | ~$0.00025/call       | When SLM is uncertain                  |
| Embeddings              | text-embedding-3-small | ~$0.00002/msg        | Cheap, high quality                    |
| AI Responses            | Claude Sonnet 4        | ~$0.01-0.05/response | Quality matters for user-facing        |
| Knowledge Extraction    | Claude Sonnet 4        | ~$0.02/extraction    | Quality matters for persistence        |

### Why granite4:350m for Classification?

IBM's Granite 4.0 Nano (350M parameters) uses a hybrid Mamba-2/Transformer architecture optimized for edge deployment:

- **Zero marginal cost** after infrastructure setup
- **Fast inference** (<100ms on modern hardware)
- **Good at binary classification** which is our primary use case
- **Can run on same server** as the application (or separate host in production)

For the "is this knowledge?" classification task, a small model is sufficient because:

- It's a binary decision (yes/no)
- We have structural pre-filters that reduce noise
- Uncertain cases escalate to Haiku API
- False negatives are acceptable (user can always manually extract)

### Hybrid Classification Flow

````
Message Created
     │
     ▼
┌─────────────────────────────────────────┐
│ Structural Pre-filter (free, instant)   │
│                                         │
│ Language-agnostic signals:              │
│ - Length > 200 chars?                   │
│ - Has code blocks (```)?                │
│ - Has bullet/numbered lists?            │
│ - Has links?                            │
│ - 3+ reactions?                         │
│                                         │
│ Score >= 3? ─────────────────────────────▶ Queue for AI classification
│             │                           │
│             ▼                           │
│       Skip (not worth classifying)      │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ SLM Classification (granite4:350m)      │
│                                         │
│ Confident YES/NO? ───────────────────────▶ Use result
│             │                           │
│             ▼                           │
│       Escalate to Haiku API             │
└─────────────────────────────────────────┘
````

---

## Architecture

### Job Queue: pg-boss

We use pg-boss (PostgreSQL-based job queue) for all AI work:

**Why pg-boss over BullMQ/Redis:**

- Uses PostgreSQL (already have it, better durability)
- Built-in job batching (perfect for embeddings)
- Priority queues out of the box
- Retry with exponential backoff
- Dead letter queue for failed jobs
- Jobs survive server restarts

**Job Priorities:**
| Priority | Job Type | Reason |
|----------|----------|--------|
| 1 | ai.respond | User waiting for @ariadne response |
| 3 | ai.extract | User triggered knowledge extraction |
| 5 | ai.embed | Background, but needed for search |
| 7 | ai.classify | Background, can wait |

### Embedding Pipeline

```
Event Created (message)
     │
     ▼
Hook in stream-service.ts
     │
     ▼
Queue ai.embed job (priority 5)
     │
     ▼
Embedding Worker (batches up to 50)
     │
     ├─▶ Call OpenAI embeddings API
     ├─▶ Store in text_messages.embedding
     └─▶ Track usage in ai_usage table
```

**On message edit:**

1. Clear existing embedding (`embedding = NULL`)
2. Re-queue ai.embed job

### Search Architecture

Hybrid search combining vector similarity with full-text:

```sql
-- Semantic score (60% weight)
SELECT id, 1 - (embedding <=> query_embedding) as semantic_score
FROM text_messages
ORDER BY embedding <=> query_embedding
LIMIT 100

-- Full-text score (40% weight)
SELECT id, ts_rank(search_vector, query) as text_score
FROM text_messages
WHERE search_vector @@ plainto_tsquery(query)
LIMIT 100

-- Combine with weighted scoring
final_score = (semantic_score * 0.6) + (text_score * 0.4)
```

**Search syntax** (Slack-like):

```
from:@pierre in:#engineering kubernetes deployment
before:2025-01-01 has:code is:thread
```

### Ariadne Agent Loop

```
@ariadne mention detected
     │
     ▼
Queue ai.respond job (priority 1)
     │
     ▼
Build context:
├─ Thread: entire history
└─ Channel: surrounding 50 events
     │
     ▼
Agent loop (max 5 iterations):
├─ Tools: search_knowledge, search_messages, get_stream_context
├─ Claude Sonnet processes with tools
├─ Execute tool calls if needed
└─ Generate final response
     │
     ▼
Post response as Ariadne in stream
```

### Knowledge Extraction Flow

**Manual trigger:**

1. User clicks "Save as knowledge" on any message
2. System reads anchor message + ±20 surrounding messages
3. Claude Sonnet generates structured extraction
4. User reviews/edits in modal
5. Knowledge saved with embedding
6. System event emitted in stream: "📚 Knowledge extracted"

**AI-suggested:**

1. Classification detects knowledge candidate
2. UI shows subtle indicator: "💡 This looks valuable"
3. User clicks → same flow as manual

**Debouncing for threads:**

- Don't classify if classified within 24 hours
- Don't classify if activity within last hour (thread still "hot")
- Don't re-classify after knowledge extracted
- Schedule delayed classification for active threads

---

## Database Schema

### New Tables

```sql
-- AI usage tracking
CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,  -- NULL for system jobs

  job_type TEXT NOT NULL,  -- 'embed', 'classify', 'respond', 'extract'
  model TEXT NOT NULL,

  input_tokens INT NOT NULL,
  output_tokens INT,
  cost_cents NUMERIC(10,6) NOT NULL DEFAULT 0,

  stream_id TEXT,
  event_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Knowledge base
CREATE TABLE knowledge (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,

  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,  -- Markdown

  source_stream_id TEXT,  -- Thread context
  source_event_id TEXT,   -- Anchor message

  embedding vector(1536),
  search_vector tsvector,  -- Generated from title/summary/content

  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  view_count INT DEFAULT 0,
  helpful_count INT DEFAULT 0,
  not_helpful_count INT DEFAULT 0
);

-- AI personas
CREATE TABLE ai_personas (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,  -- NULL = global default

  name TEXT NOT NULL DEFAULT 'Ariadne',
  handle TEXT NOT NULL DEFAULT '@ariadne',
  system_prompt TEXT NOT NULL,
  model_preference TEXT DEFAULT 'claude-sonnet-4',

  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Schema Modifications

```sql
-- Add embedding to text_messages
ALTER TABLE text_messages ADD COLUMN embedding vector(1536);
ALTER TABLE text_messages ADD COLUMN embedded_at TIMESTAMPTZ;

-- Add classification tracking to streams
ALTER TABLE streams ADD COLUMN last_classified_at TIMESTAMPTZ;
ALTER TABLE streams ADD COLUMN classification_result TEXT;
ALTER TABLE streams ADD COLUMN knowledge_extracted_at TIMESTAMPTZ;

-- Add AI settings to workspaces
ALTER TABLE workspaces ADD COLUMN ai_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN ai_budget_cents_monthly INT DEFAULT 10000;
```

---

## API Routes

### Search

```
GET /api/workspace/:workspaceId/search?q=<query>
```

Query supports filters: `from:@user`, `in:#channel`, `before:date`, `has:code`, `is:knowledge`

### Knowledge

```
GET  /api/workspace/:workspaceId/knowledge
GET  /api/workspace/:workspaceId/knowledge/:id
POST /api/workspace/:workspaceId/knowledge/extract
POST /api/workspace/:workspaceId/knowledge/:id/feedback
```

### AI Usage

```
GET /api/workspace/:workspaceId/ai/usage
GET /api/workspace/:workspaceId/ai/usage/summary
```

---

## Frontend Components

### Enhanced Command Palette

- **Cmd+P**: Open command palette (existing)
- **Cmd+F**: Open in search mode (new)
- Search mode shows results with highlighting
- Supports full query syntax with autocomplete

### Knowledge Explorer

New tab type accessible from sidebar:

- Search bar with query syntax
- Sections: Recent, Most Referenced, By Channel
- Detail view with source link, feedback buttons
- Edit/archive capabilities

### Knowledge Extraction Modal

- Shows AI-generated draft
- Editable title, summary, content
- Preview rendered markdown
- Source link to original conversation

### Knowledge Event in Stream

When knowledge is extracted, a system event appears:

```
📚 Knowledge extracted by Pierre
"Fixing staging database timeouts"
How to resolve connection pool exhaustion on staging deploys
[View in Knowledge Base →]
```

---

## Implementation Phases

### Phase 1: Infrastructure (Week 1)

- [ ] Database migration (012_ai_features.sql)
- [ ] pg-boss setup and initialization
- [ ] Ollama client for granite4:350m
- [ ] AI provider abstraction (Claude, OpenAI)
- [ ] Usage tracking service

### Phase 2: Embeddings (Week 2)

- [ ] Embedding worker with batching
- [ ] Hook into event creation
- [ ] Re-embed on message edit
- [ ] Backfill script for existing messages

### Phase 3: Search (Weeks 3-4)

- [ ] Hybrid search service
- [ ] Search query parser
- [ ] Search API routes
- [ ] Command palette search mode
- [ ] Search results UI

### Phase 4: Ariadne (Weeks 5-6)

- [ ] Ariadne service and worker
- [ ] Tool implementations (search_knowledge, search_messages)
- [ ] @ariadne mention detection
- [ ] Response posting
- [ ] Default persona setup

### Phase 5: Knowledge (Weeks 7-8)

- [ ] Knowledge service (CRUD)
- [ ] Extraction API with Claude
- [ ] Extraction modal UI
- [ ] Classification worker (SLM + fallback)
- [ ] Knowledge explorer
- [ ] Suggestion indicators

---

## Cost Estimates

### Per 1,000 Active Users/Month

| Feature                         | Volume          | Cost               |
| ------------------------------- | --------------- | ------------------ |
| Embeddings                      | 50k messages    | ~$1                |
| Classification (SLM)            | 5k candidates   | $0                 |
| Classification (Haiku fallback) | 500 escalations | ~$0.13             |
| Ariadne responses               | 2k invocations  | ~$50-100           |
| Knowledge extraction            | 100 extractions | ~$2                |
| **Total**                       |                 | **~$55-105/month** |

At $10/user pricing: **0.5-1% of revenue** for AI features.

### Budget Controls

- Per-workspace monthly budget (default $100)
- Alerts at 50%, 80%, 90% usage
- Graceful degradation at 100% (disable auto-features, keep @ariadne)
- Admin dashboard for usage visibility

---

## Files to Create

| File                               | Purpose                |
| ---------------------------------- | ---------------------- |
| `migrations/012_ai_features.sql`   | Database schema        |
| `lib/job-queue.ts`                 | pg-boss initialization |
| `lib/ollama.ts`                    | SLM client             |
| `lib/ai-providers.ts`              | Claude/OpenAI clients  |
| `lib/search-parser.ts`             | Query syntax parsing   |
| `services/search-service.ts`       | Hybrid search          |
| `services/ariadne-service.ts`      | AI companion           |
| `services/knowledge-service.ts`    | Knowledge CRUD         |
| `workers/embedding-worker.ts`      | Embedding jobs         |
| `workers/classification-worker.ts` | Classification jobs    |
| `workers/ariadne-worker.ts`        | AI response jobs       |
| `routes/search-routes.ts`          | Search API             |
| `routes/knowledge-routes.ts`       | Knowledge API          |

### Files to Modify

| File                 | Changes                            |
| -------------------- | ---------------------------------- |
| `stream-service.ts`  | Hook AI triggers on event creation |
| `CommandPalette.tsx` | Add search mode                    |
| `Sidebar.tsx`        | Add Knowledge link                 |
| `url-state.ts`       | Support knowledge tab type         |

---

## Open Questions

1. **Embedding backfill**: How to handle existing messages? Background job over days?
2. **Knowledge versioning**: Track edits to knowledge entries?
3. **Multi-language**: How well does granite4:350m handle non-English?
4. **Ariadne in DMs**: Should Ariadne be available in direct messages?

---

## Success Metrics

### Validation (PoC)

- % of searches that use semantic vs keyword-only
- @ariadne invocation rate
- Knowledge extraction rate
- Helpfulness ratings on AI responses

### Target (Post-Launch)

- 80% question deflection rate (AI answers without human)
- 90%+ helpful rating on Ariadne responses
- 50+ knowledge entries per 100 users
- <500ms search latency at p99

---

## References

- [Threa Product Spec](./spec.md)
- [Stream Model Refactor](./stream-model-refactor.md)
- [pg-boss Documentation](https://github.com/timgit/pg-boss)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [IBM Granite Documentation](https://www.ibm.com/granite/docs/models/granite)
