# Workspace Communication Platform: Complete Specification

**Version:** 1.0 - PoC/MVP Scope  
**Last Updated:** November 2025  
**Target:** Startups and scale-ups (1-1000 employees)

## Executive Summary

A workspace communication platform that solves two fundamental problems with existing chat tools:

1. **Organizational Problem:** Conversations naturally belong in multiple places, but tools force you to choose one "home" or cross-post (creating divergent copies)
2. **Knowledge Problem:** Valuable information gets lost in chat history, experts answer the same questions repeatedly, onboarding is slow

**Core Differentiators:**

- **Graph-based multi-channel conversations:** One thread exists in multiple channels simultaneously
- **AI-powered knowledge emergence:** Documentation emerges naturally from helping people, not manual wiki maintenance

**Philosophy:**

- Human communication first, AI assistance second
- Progressive disclosure (simple by default, powerful when needed)
- Conservative and respectful (better to miss than interrupt)
- Build trust through quality, not quantity

---

## Table of Contents

1. [Product Vision & Scope](#product-vision--scope)
2. [Core Concepts & Terminology](#core-concepts--terminology)
3. [Feature Specifications](#feature-specifications)
4. [Technical Architecture](#technical-architecture)
5. [AI Intelligence Layer](#ai-intelligence-layer)
6. [Data Model](#data-model)
7. [Implementation Roadmap](#implementation-roadmap)
8. [Success Metrics](#success-metrics)

---

## Product Vision & Scope

### The Problem

**Current State (Slack/Discord/Teams):**

- Conversations forced into single channel (causes cross-posting, divergence, missed information)
- Same questions asked repeatedly (experts interrupted, knowledge lost)
- Information buried in chat history (onboarding slow, decisions unfindable)
- Binary notification choice (everything or nothing → overload or missed info)

**What We're Building:**
A communication platform where:

- Conversations exist in multiple channels naturally (graph model)
- AI deflects routine questions (experts focus on complex work)
- Knowledge emerges from helping people (zero documentation burden)
- Smart notifications deliver right information at right time

### MVP/PoC Scope

The goal is **validating core hypotheses** with real users:

1. **Graph model hypothesis:** Do people actually use multi-channel conversations? Does it reduce cross-posting pain?
2. **AI assistance hypothesis:** Does @assistant reduce repeat questions? Is it helpful without being annoying?
3. **Combined hypothesis:** Do these features together create value > Slack?

**What's IN the PoC:**

- ✅ Multi-channel conversations (graph model)
- ✅ Real-time messaging (WebSocket)
- ✅ Threading with unlimited depth
- ✅ Flat messages and conversations
- ✅ Channel types: official channels only (public)
- ✅ @assistant explicit invocation for Q&A
- ✅ Manual knowledge extraction (AI-assisted)
- ✅ Hybrid search (vector + full-text)
- ✅ Basic notifications (real-time only)
- ✅ Web app only

**What's DEFERRED to Phase 2:**

- ❌ Adhoc channels and DMs
- ❌ Private channels (public only for MVP)
- ❌ Labels and promotion mechanism
- ❌ Automatic question detection
- ❌ Expert routing / discovery feed
- ❌ Smart notifications and priority filtering
- ❌ Conversation display modes (collapsed/expanded)
- ❌ Resources model (conversation attachments)
- ❌ Knowledge staleness tracking
- ❌ Thread splitting suggestions
- ❌ Desktop/mobile apps

### Target Timeline

Building on parental leave - **no artificial deadlines**. Features ship when they're ready.

**Rough estimate:** 4-6 months to PoC that validates hypotheses with 20-50 users.

---

## Core Concepts & Terminology

### Workspace

Top-level organizational container.

- Contains all channels, conversations, members
- Billing and quota boundary
- Examples: "Acme Corp", "Marketing Team"

### Channel

Named container for conversations and messages.

- Named with `#` prefix (e.g., `#engineering`, `#api`)
- **MVP: Public only** (all workspace members can access)
- Appears in channel navigation
- Default: New workspaces start with `#general`

**Types (Phase 2):**

- Official channels (admin-created, stable)
- Adhoc channels (user-created, collaborative)
- DMs (two-person conversations)

### Conversation

Thread of related messages about a coherent topic.

- Can exist in **multiple channels simultaneously** (graph model)
- Has unlimited threading depth
- Can be flat messages or threaded
- Explicit threading (user chooses when to thread)

### Message

Individual communication unit.

- Exists in a channel
- Can be flat (no conversation) or part of conversation
- Can reply to other messages (threading)
- Can reference channels and tag channels

### Knowledge

Extracted, structured documentation from conversations.

- Title, summary, markdown content
- Searchable via hybrid search (vector + full-text)
- Links back to source conversation
- Created manually with AI assistance

---

## Feature Specifications

### 1. Graph-Based Multi-Channel Conversations

**Problem:** Conversations naturally belong in multiple contexts, but hierarchical channel systems force single "home" choice.

**Solution:** One conversation exists in multiple channels simultaneously.

**Example:**

```
Conversation: "Auth endpoint timeout bug"
Channels: #engineering + #api + #security

One discussion, visible in all three channels.
No cross-posting, no divergence, no duplication.
```

#### How It Works

**Creating multi-channel conversations:**

When composing a message, user can tag multiple channels:

**Method 1: Type channels inline**

```
Message: "Auth endpoint timing out. This affects #+api and #+security teams"

Result:
- Message posted in current channel (#engineering)
- Also appears in #api and #security
- Inline #+channel syntax renders as badge
```

**Method 2: Click to add channels**

```
[Message compose box]
📍 #engineering  [+ Add channel]

Click → Select #api, #security → Same result
```

**Behavior:**

- Regular `#channel` mention = clickable link (reference only)
- `#+channel` tag = makes conversation appear there (action)
- Visual difference: mentions are underlined links, tags are badges
- Autocomplete on `#+` for discoverability
- Any message in thread can add channels (not just root)

**Viewing multi-channel conversations:**

```
Conversation displays in channel:

Auth endpoint timeout bug
#engineering  #api  #security

[Thread messages...]
```

**Privacy (Phase 2):**

- When private channels exist, show: `#engineering  #api  +1 private🔒`
- Don't leak private channel names to non-members

**Key Benefits:**

- Information reaches all stakeholders without cross-posting
- Single source of truth (one discussion, not divergent copies)
- Supports hierarchical thinking (single channel) and graph thinking (multiple channels)
- Natural: "This affects the API team too" → just tag it

---

### 2. Explicit Threading with Unlimited Depth

**Problem:** Single-level threading forces complex discussions into new channels. Unlimited nesting buries conversations. Long threads cover multiple unrelated topics.

**Solution:** Multi-level threading within focused conversations. Each conversation = one coherent topic.

**Threading Model:**

**Flat messages** - No threading, appears in channel feed:

```
#engineering (flat view):
├─ Alice: "We need to fix the API issue"
├─ Bob: "Great deploy today"
├─ Charlie: "Anyone free for lunch?"
```

**Creating conversation** - "Reply in thread" on any message:

```
#engineering:
├─ Alice: "We need to fix the API issue"
│  ├─ Bob: "What's the error message?"
│  │  └─ Alice: "Connection timeout after 30s"
│  │     └─ Bob: "That's the database pool"
│  └─ Charlie: "I can look at connection pooling"
│     └─ Alice: "Thanks, here's the logs"
├─ David: "Anyone free for lunch?"
```

**Behavior:**

- Original message stays in flat feed (becomes conversation root)
- Replies nest underneath with unlimited depth
- Visual threading shows conversation structure
- Each conversation focused on single topic

**Data Model Behavior:**

When "reply in thread" is clicked:

1. Original message gets `conversation_id` set (becomes part of conversation)
2. New conversation record created with `root_message_id` pointing to original
3. Reply message created with `conversation_id` and `reply_to_message_id`
4. Original message visible in both flat feed AND as conversation root

**Future (Phase 2):** Thread splitting for topic divergence

- AI detects: "This seems like different topic - split?"
- Manual: Select messages and "Start new thread"
- Backlinks preserve context between related conversations

---

### 3. AI-Powered Question Answering (@assistant)

**Problem:** Knowledge workers waste time answering same questions. Experts interrupted for routine queries. Askers wait for human responses.

**Philosophy:** Reduce repeat answers, not repeat questions. Make answering effortless. Questions reveal knowledge gaps, not failures.

**MVP Scope: Explicit Invocation Only**

User must explicitly invoke AI assistant:

```
Alice: "@assistant how do I reset staging environment?"

🤖 Assistant:
You can reset staging with `./scripts/reset-staging.sh`

This drops all tables and reseeds with test data. Takes ~2 minutes.

📚 Source: DevOps Runbook (updated 2 weeks ago)

[👍 Helpful] [👎 Not helpful]
```

**Key Behaviors:**

**Explicit invocation:**

- User types `@assistant` followed by question
- AI responds immediately in thread
- Clear visual distinction (robot emoji, styled differently)
- Shows confidence level and sources
- Feedback buttons (thumbs up/down)

**Participant model:**
Once invoked, AI watches thread for 30 minutes:

- Responds to follow-up questions
- Backs off if humans actively helping
- Maximum 3 responses per thread (unless re-invoked)
- Small indicator: "🤖 Assistant is in this conversation"

**Response strategy:**

- High confidence (>90%) + low risk = answer directly
- Medium confidence (60-90%) = provide context with links
- Low confidence (<60%) or high-stakes = stay quiet

**Learning loop:**

- Track thumbs up/down feedback
- Monitor corrections from humans
- Improve confidence calibration over time
- Flag confidently wrong answers for review

**Deferred to Phase 2:**

- Automatic question detection
- Proactive suggestions
- Multi-turn conversations beyond participant model
- Smart triggering based on context

---

### 4. Knowledge Emergence from Conversations

**Problem:** Traditional wikis require manual documentation nobody does. Knowledge decays in chat. Decisions vanish. Onboarding slow.

**Philosophy:** Knowledge emerges from natural Q&A flow. Answering questions creates institutional knowledge automatically.

**The Learning Loop:**

1. **Question asked** - User asks in conversation
2. **AI attempts answer** - Searches existing knowledge
3. **Human answers if needed** - Expert provides response
4. **Extraction** - AI identifies reusable knowledge
5. **Verification** - Human reviews and approves
6. **Storage** - Answer becomes searchable knowledge
7. **Next time** - AI answers similar questions directly

**MVP Implementation:**

**Manual extraction with AI assistance:**

User clicks "Save as knowledge" on any message in a conversation.

**Flow:**

```
1. User hovers over key message (e.g., solution to problem)
   Message actions: [...] → "Save as knowledge"

2. User clicks → AI processes:
   - Reads anchor message
   - Reads ±20 surrounding messages for context
   - Extracts knowledge structure

3. Modal shows AI-generated draft:
   ┌─────────────────────────────────────────┐
   │ Extract Knowledge                       │
   ├─────────────────────────────────────────┤
   │ Title: [Fixing staging database timeout]│
   │                                         │
   │ Summary: [AI-generated 2-3 sentences]  │
   │                                         │
   │ Content: [AI-structured markdown]      │
   │ Problem: Staging deploys fail...       │
   │ Solution: Restart database pod         │
   │ Steps:                                 │
   │ 1. kubectl get pods...                 │
   │ 2. kubectl restart...                  │
   │                                         │
   │ Source: [Link to conversation]         │
   │                                         │
   │ [Edit] [Publish] [Cancel]              │
   └─────────────────────────────────────────┘

4. User reviews/edits
5. User clicks "Publish"
6. Knowledge saved and indexed
```

**Knowledge Structure:**

Simple, flexible schema:

```
Title: "Fixing staging database timeouts"
Summary: 2-3 sentence overview
Content: Freeform markdown (AI structures naturally)
Source conversation: Link to original discussion
Source message: Anchor message that triggered extraction
Created by: User who extracted it
Created at: Timestamp
Embedding: Vector for semantic search
```

AI structures content naturally in markdown:

- Problem statement
- Solution explanation
- Step-by-step instructions
- Gotchas and edge cases
- When applicable

**Search & Retrieval:**

Hybrid search (vector + full-text):

1. User query → generate embedding
2. Semantic search via cosine similarity
3. Keyword search via PostgreSQL full-text
4. Merge and rank results
5. Present top results with sources

**Deferred to Phase 2:**

- Automatic extraction suggestions
- Multiple knowledge templates
- Knowledge evolution and versioning
- Staleness detection
- Conflict resolution

---

### 5. Real-Time Messaging & Notifications

**MVP: Basic Real-Time via WebSocket**

**Core Features:**

- WebSocket connection for real-time updates
- Messages appear instantly across clients
- Typing indicators
- Online/offline presence

**Architecture:**

- Client establishes WebSocket connection
- Authenticates via JWT
- Subscribes to relevant rooms:
  - Personal: `user:{userId}`
  - Channels: `channel:{channelId}` (active channels only)
  - Conversations: `conversation:{conversationId}` (currently viewing)

**Notification Strategy (MVP):**

- All activity pushes to WebSocket in real-time
- No filtering, no prioritization
- User sees everything as it happens
- Browser notifications for @mentions

**Deferred to Phase 2:**

- Smart notification filtering
- Priority classification (critical/high/medium/low)
- Do-not-disturb intelligence
- Notification batching and digests
- Context-aware relevance scoring

---

## Technical Architecture

### Technology Stack

**Runtime & Language:**

- **Bun** - JavaScript/TypeScript runtime (built-in TS, faster than Node)
  - Fallback: Node.js if Bun issues arise
  - Standard packages, no Bun-specific APIs

**Backend:**

- TypeScript full-stack
- Express or Fastify (HTTP server)
- ws (WebSocket library)
- Zod (validation)
- Pino (structured logging)

**Frontend:**

- React
- TypeScript
- Vite (build tool)
- Shared types with backend
- Component library: shadcn/ui or Radix + Tailwind

**Database:**

- PostgreSQL 16+ (primary data store)
- pgvector extension (vector embeddings)
- Managed PostgreSQL (AWS RDS)

**Caching & Pub/Sub:**

- Redis 7+ (WebSocket pub/sub, presence, typing indicators)
- Managed Redis (AWS ElastiCache)

**Authentication:**

- WorkOS (hosted auth solution)
- Email/password initially
- SSO ready for enterprise

**AI Providers:**

- Anthropic Claude Sonnet 4.5 (Q&A, knowledge extraction)
- Anthropic Claude Haiku 4.5 (classification, quick tasks)
- OpenAI text-embedding-3-small (vector embeddings)
- OpenAI GPT-4o (fallback provider)

**Infrastructure:**

- AWS (hosting in Stockholm, Sweden)
- EC2 or ECS (compute)
- RDS (PostgreSQL)
- ElastiCache (Redis)
- CloudFront (CDN)

**Observability:**

- Sentry (error tracking and monitoring)
- Structured JSON logs (Pino)
- Basic metrics via CloudWatch

**Development:**

- Monorepo (backend + frontend together)
- Vitest (testing)
- GitHub Actions (CI/CD)
- ESLint, Prettier, TypeScript strict mode

### Core Architecture Patterns

#### 1. ID Generation

**Client-generated ULIDs with readable prefixes**

Format: `{prefix}_{ulid}`

Examples:

- `msg_01ARZ3NDEKTSV4RRFFQ69G5FAV` (message)
- `conv_01ARZ3NDEKTSV4RRFFQ69G5FAV` (conversation)
- `chan_01ARZ3NDEKTSV4RRFFQ69G5FAV` (channel)
- `usr_01ARZ3NDEKTSV4RRFFQ69G5FAV` (user)

**Benefits:**

- Time-sortable (48-bit timestamp)
- Globally unique (80 bits randomness)
- True optimistic UI (no temp ID swaps)
- Free idempotency (retry = same ID)
- Instant identification by prefix
- Better debugging

**Server validation:**

- Regex format check
- Clock drift validation (reject >10min future, warn >2min)
- Database uniqueness constraint

#### 2. Transactional Outbox Pattern

**Guaranteed message delivery with eventual consistency**

**Write Path (Synchronous):**

```
1. Begin database transaction
2. INSERT message into messages table
3. INSERT event into outbox table
4. COMMIT transaction (atomic)
5. Return 201 to client
```

**Delivery Path (Asynchronous):**

```
1. Background processor polls outbox every 100ms
   SELECT * FROM outbox
   WHERE processed_at IS NULL
   ORDER BY created_at
   FOR UPDATE SKIP LOCKED
   LIMIT 100

2. Publish events to Redis pub/sub
3. Mark as processed
4. Retry on failure (max 10 attempts)
5. Dead letter queue for permanent failures
```

**Guarantees:**

- ✅ Exactly-once write (transaction)
- ✅ At-least-once delivery (retries)
- ✅ Ordering preserved (created_at order)
- ✅ No message loss (outbox persistence)
- ✅ Idempotent consumption (client dedupes by ID)

**Trade-offs:**

- ~100ms delivery latency (acceptable for chat)
- Requires background worker
- More complex than direct publish
- But: Strong guarantees worth it

#### 3. WebSocket Architecture

**Horizontal scaling with Redis pub/sub**

**Connection Model:**

```
Client
  ↓ (WebSocket)
Load Balancer (sticky sessions)
  ↓
Multiple WebSocket Servers
  ↓ (pub/sub)
Redis
  ↑
Outbox Processor (publishes events)
```

**Room Subscriptions:**

- `user:{userId}` - Personal channel (DMs, mentions, notifications)
- `channel:{channelId}` - Active channels user is viewing
- `conversation:{conversationId}` - Currently open conversation

**Presence & Typing:**

- Presence: Redis keys with 60s TTL, heartbeat every 30s
- Typing: Redis sets with 3s TTL, broadcast on start/stop
- Both use pub/sub for real-time broadcast

**Reconnection:**

- Exponential backoff (1s → 30s max)
- Re-authenticate on reconnect
- Request catch-up for missed events (query by timestamp)
- Client dedupes by message ID

**Scaling:**

- 10-20k connections per WebSocket server
- Multiple servers behind load balancer
- Sticky sessions for connection affinity
- Multiple outbox processors (SKIP LOCKED prevents conflicts)

#### 4. Hybrid Search Architecture

**Vector embeddings + full-text search in PostgreSQL**

**Components:**

1. **Vector search** (semantic similarity via pgvector)
2. **Full-text search** (keyword matching via PostgreSQL)
3. **Graph relationships** (related conversations)
4. **Weighted scoring** (combine results)

**Search Pipeline:**

```
1. User query: "how to deploy staging"
2. Generate embedding (OpenAI API)
3. Vector search: SELECT * FROM knowledge
   ORDER BY embedding <=> query_embedding LIMIT 20
4. Full-text search: SELECT * FROM knowledge
   WHERE search_vector @@ to_tsquery('deploy & staging') LIMIT 20
5. Merge results with weighted scoring:
   final_score = (vector_score × 0.7) + (text_score × 0.3)
6. Rank and return top results
```

**Indexing:**

- IVFFlat index for vector search (good for <10M vectors)
- GIN index for full-text search
- Update embeddings on knowledge creation/update

**Performance:**

- Target: <500ms search latency at p99
- Cache embeddings for 7 days (by content hash)
- Acceptable for MVP: 10k-100k knowledge entries

**Migration Path:**

- If performance degrades >10M vectors
- Consider Pinecone, Weaviate, or Qdrant
- But pgvector sufficient for MVP and beyond

---

## AI Intelligence Layer

### Provider Strategy

**Multi-provider with task-specific models:**

| Task                      | Provider  | Model                  | Why                                      |
| ------------------------- | --------- | ---------------------- | ---------------------------------------- |
| Q&A, Knowledge Extraction | Anthropic | Claude Sonnet 4.5      | Quality, 200k context, low hallucination |
| Classification, Routing   | Anthropic | Claude Haiku 4.5       | Fast, cheap (12x cheaper)                |
| Vector Embeddings         | OpenAI    | text-embedding-3-small | Industry standard, cheap                 |
| Fallback Provider         | OpenAI    | GPT-4o                 | Redundancy when Claude unavailable       |

**API-based vs Self-hosted:**

- MVP: API-based (no ML team needed, faster to market)
- Consider self-hosted at 10k+ users (cost inflection point)
- Structure code for easy provider switching

**Cost Estimates (1000 users, 50k questions/month):**

- Q&A: ~$675/month
- Classification: ~$9/month
- Embeddings: ~$0.50/month
- Knowledge extraction: ~$105/month
- **Total: ~$790/month = $0.79/user/month**
- At $10/user pricing: **8% of revenue**

**Optimization strategies:**

- Cache answers (7-day TTL)
- Cache embeddings (by content hash)
- Batch processing where possible
- Right-size models to tasks
- Quality over cost (don't compromise accuracy)

### Question Answering System

**MVP: Explicit Invocation Only**

**Trigger:** User types `@assistant [question]`

**Response Flow:**

```
1. User: "@assistant how to reset staging?"
2. System:
   a. Parse question
   b. Generate embedding
   c. Hybrid search knowledge base
   d. Retrieve top 3-5 relevant knowledge entries
   e. Construct prompt with context
   f. Call Claude Sonnet API
   g. Generate response with sources
3. Assistant: [Response with citations and confidence]
4. User: [Thumbs up/down feedback]
```

**Confidence Calibration:**

Factors that increase confidence:

- Exact match to verified knowledge (+30%)
- Recent sources (<1 week) (+10%)
- Multiple agreeing sources (+15%)
- Positive feedback on sources (+20%)

Factors that decrease confidence:

- Multiple interpretations (-20%)
- Sources >6 months old (-10%)
- Conflicting information (-40%)
- Ambiguous question (-15%)

**Response thresholds:**

- > 90% confidence = answer directly
- 60-90% confidence = provide context + links
- <60% confidence = "I'm not sure, but here's what I found..."

**Response Styling:**

Must be unmistakably AI:

```
┌─────────────────────────────────────────┐
│ 🤖 Assistant · 90% confident            │
│                                         │
│ You can reset staging with:             │
│ `./scripts/reset-staging.sh`            │
│                                         │
│ 📚 Sources:                             │
│ • DevOps Runbook (updated 2 weeks ago)  │
│ • Previous discussion in #engineering   │
│                                         │
│ [👍 Helpful] [👎 Not helpful]           │
└─────────────────────────────────────────┘
```

**Learning Loop:**

- Track feedback (thumbs up/down)
- Monitor corrections from humans
- Adjust confidence thresholds
- Improve knowledge quality

**Deferred to Phase 2:**

- Automatic question detection
- Proactive suggestions
- Multi-turn conversations
- Expert routing when AI doesn't know

### Knowledge Extraction System

**MVP: Manual Trigger with AI Assistance**

**Trigger:** User clicks "Save as knowledge" on any message

**Extraction Flow:**

```
1. User clicks "Save as knowledge" on message (anchor)
2. System:
   a. Read anchor message
   b. Read ±20 surrounding messages (context window)
   c. Send to Claude Sonnet with extraction prompt
   d. AI generates structured knowledge draft
3. Modal shows draft for review
4. User edits/approves
5. System:
   a. Generate embedding
   b. Save to knowledge table
   c. Index for search
6. Confirmation: "Knowledge published!"
```

**Extraction Prompt Structure:**

```
You are extracting reusable knowledge from a conversation.

Conversation excerpt (21 messages):
[Context messages...]

Anchor message (the key insight):
[Anchor message...]

Extract knowledge in this format:

Title: [Clear, searchable title]

Summary: [2-3 sentences covering what, why, when]

Content: [Structure naturally in markdown]

Focus on:
- What problem this solves
- How to do it (step-by-step if procedural)
- When it applies
- Common gotchas
- Related information

Be concise, actionable, and clear.
```

**Knowledge Quality:**

- AI generates draft (90% complete)
- Human reviews for accuracy (10% effort)
- Feedback loop improves extraction quality
- Track: extraction → usage → feedback

**Deferred to Phase 2:**

- Automatic extraction suggestions
- Multiple knowledge templates
- Knowledge evolution and versioning
- Staleness detection
- Conflict resolution

### Cost Management

**Per-workspace budgets with graceful degradation:**

**Budget calculation:**

```
Workspace: 100 users
Plan: $10/user/month = $1000/month revenue
AI budget: ~$79/month (8% of revenue)

Monthly tracking:
- Questions answered: 2,450 ($33)
- Knowledge extracted: 45 ($1)
- Embeddings: 12,000 ($0.24)
Total: $34.27 / $79 (43% used)
```

**Alerts & Degradation:**

- 50% used: Notification to admin
- 80% used: Warning to admin
- 90% used: Graceful degradation (increase confidence thresholds)
- 100% used: Hard limit (stop auto-answers, @assistant still works)

**Optimization:**

- Cache frequently accessed knowledge
- Batch embeddings (100 at a time)
- Right-size models to tasks
- Monitor and optimize costs continuously

**Philosophy:** Quality over quantity. 8% of revenue is acceptable for core differentiator.

---

## Data Model

### Core Schema

```sql
-- Workspaces
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,           -- ws_01ARZ3...
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- usr_01ARZ3...
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

-- Channels (MVP: public channels only)
CREATE TABLE channels (
  id TEXT PRIMARY KEY,           -- chan_01ARZ3...
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,            -- '#engineering'
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

-- Channel membership (for future private channels)
CREATE TABLE channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

-- Conversations (can exist in multiple channels)
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,           -- conv_01ARZ3...
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  root_message_id TEXT NOT NULL, -- First message in thread
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-many: conversations ↔ channels
CREATE TABLE conversation_channels (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false, -- Which channel it was posted in
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, channel_id)
);

-- Messages (flat or in conversations)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,           -- msg_01ARZ3...
  channel_id TEXT NOT NULL REFERENCES channels(id),
  conversation_id TEXT REFERENCES conversations(id), -- NULL = flat message
  reply_to_message_id TEXT REFERENCES messages(id),  -- NULL = top-level in conversation
  author_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- Knowledge base
CREATE TABLE knowledge (
  id TEXT PRIMARY KEY,           -- know_01ARZ3...
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,         -- Markdown
  source_conversation_id TEXT REFERENCES conversations(id),
  source_message_id TEXT REFERENCES messages(id), -- Anchor message
  embedding vector(1536),        -- OpenAI text-embedding-3-small
  search_vector tsvector,        -- Full-text search
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Transactional outbox for reliable delivery
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,      -- 'message.created', 'conversation.updated', etc.
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

-- Indexes
CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_reply_to ON messages(reply_to_message_id);
CREATE INDEX idx_conversation_channels_channel ON conversation_channels(channel_id);
CREATE INDEX idx_conversation_channels_conv ON conversation_channels(conversation_id);
CREATE INDEX idx_knowledge_workspace ON knowledge(workspace_id);
CREATE INDEX idx_knowledge_embedding ON knowledge USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_knowledge_search ON knowledge USING gin(search_vector);
CREATE INDEX idx_outbox_unprocessed ON outbox(created_at) WHERE processed_at IS NULL;
```

### Key Relationships

**Workspaces → Channels → Conversations → Messages:**

```
workspace
  └─ channels (many)
       └─ messages (many, flat or in conversations)
       └─ conversations (many, via conversation_channels)
            └─ messages (many, threaded)
```

**Multi-channel conversations:**

```
conversation_channels (junction table)
  ├─ conversation_id
  └─ channel_id

One conversation → many channels (appears in all)
One channel → many conversations (contains many)
```

**Message threading:**

```
messages.conversation_id = NULL → flat message in channel
messages.conversation_id = conv_1 → part of conversation

messages.reply_to_message_id = NULL → top-level in conversation
messages.reply_to_message_id = msg_1 → reply to specific message
```

**Knowledge extraction:**

```
knowledge.source_conversation_id → original conversation
knowledge.source_message_id → anchor message (key insight)
knowledge.embedding → vector for semantic search
knowledge.search_vector → full-text search index
```

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)

**Week 1: Project Setup & Auth**

- Bun monorepo (backend + frontend)
- PostgreSQL local (or Docker Compose)
- WorkOS authentication integration
- Basic tables: users, workspaces, workspace_members
- Simple React app: login → workspace view

**Week 2: Core Messaging**

- Channels table and CRUD
- Messages table
- POST /messages endpoint (create flat message)
- WebSocket server setup (ws library)
- Redis connection (pub/sub infrastructure)
- Display messages in channel (real-time)

**Week 3: Threading**

- Conversations table
- "Reply in thread" creates conversation
- Display threaded messages (nested UI)
- Message threading logic (reply_to_message_id)

**Week 4: Multi-Channel**

- conversation_channels junction table
- Tag conversation with multiple channels on creation
- #+channel syntax detection and rendering
- Display conversations in all tagged channels
- Channel badge UI

**Deliverable:** Working chat app with multi-channel conversations

### Phase 2: AI Integration (Weeks 5-8)

**Week 5: Knowledge Base**

- Knowledge table with pgvector
- Embedding generation (OpenAI API)
- Hybrid search implementation (vector + full-text)
- Basic knowledge CRUD

**Week 6: @assistant Q&A**

- @assistant mention detection
- Claude API integration (Sonnet + Haiku)
- Q&A prompt engineering
- Response rendering with sources
- Feedback buttons (thumbs up/down)

**Week 7: Knowledge Extraction**

- "Save as knowledge" action on messages
- Context window extraction (±20 messages)
- AI extraction prompt
- Draft review modal
- Publish knowledge flow

**Week 8: Polish & Testing**

- Error handling and retries
- Loading states and optimistic UI
- Cost tracking and monitoring
- User testing with 5-10 people

**Deliverable:** Working PoC with AI assistance

### Phase 3: Polish & Validation (Weeks 9-12)

**Week 9: Performance Optimization**

- Database query optimization
- Index tuning
- WebSocket connection pooling
- Caching strategies

**Week 10: Observability**

- Sentry integration
- Structured logging
- Basic metrics dashboard
- Error alerting

**Week 11: User Testing**

- Recruit 20-50 early users
- Onboarding flow polish
- Documentation and help content
- Feedback collection mechanisms

**Week 12: Iteration**

- Fix critical bugs
- Address user feedback
- Prepare for broader rollout
- Decide on Phase 2 features based on learnings

**Deliverable:** Validated PoC ready for alpha users

### Future Phases (Post-PoC)

Based on validation results, prioritize:

- Private channels and access control
- Adhoc channels and DMs
- Labels and promotion mechanism
- Automatic question detection
- Expert routing / discovery feed
- Smart notifications
- Mobile apps
- Enterprise features (SSO, audit logs)

---

## Success Metrics

### Validation Metrics (PoC)

**Primary goal:** Validate core hypotheses

**Multi-channel usage:**

- % conversations tagged with 2+ channels
- % users who use multi-channel tagging
- User feedback: "Does this solve cross-posting pain?"

**AI assistance usage:**

- % questions that invoke @assistant
- Helpfulness rating (thumbs up/down ratio)
- % questions answered without human intervention
- User feedback: "Is AI helpful without being annoying?"

**Knowledge creation:**

- Number of knowledge entries created
- % knowledge entries that get reused
- Time from knowledge creation to first reuse
- User feedback: "Does manual extraction feel worth it?"

**Qualitative:**

- User interviews (what works, what doesn't)
- Feature requests (what's missing)
- Comparison to Slack (better/worse/different)

### Target Metrics (Post-PoC)

**Engagement:**

- Daily Active Users (DAU)
- Messages per user per day
- Conversations created per day
- Knowledge entries created per week

**AI Performance:**

- 80% question deflection rate (AI answers or routes)
- 90%+ helpfulness rating on AI responses
- <5 minute average time from question to answer
- Zero tolerance for confidently wrong answers

**Knowledge Quality:**

- % knowledge entries with positive feedback
- Average reuse per knowledge entry (>3 = valuable)
- % stale knowledge (<10%)
- Coverage of common questions

**Business:**

- Week 1 retention (% users who return)
- Month 1 retention
- Net Promoter Score (NPS)
- Viral coefficient (invitations sent per user)

---

## Design Principles

### Product Principles

1. **Human communication first** - AI assists, doesn't replace
2. **Progressive disclosure** - Simple by default, powerful when needed
3. **Conservative over aggressive** - Better to miss than interrupt
4. **Quality over quantity** - Accurate expensive > fast cheap
5. **Single-player to multi-player** - Individual value before team requirements
6. **Transparent and controllable** - Users understand and control AI

### Technical Principles

1. **Simplicity first** - Monolith initially, extract services when needed
2. **Strong guarantees** - Transactional consistency, reliable delivery
3. **Pragmatic choices** - Proven tech over cutting-edge
4. **Progressive complexity** - Build what's needed now, not imagined future
5. **Fail gracefully** - Degrade service, don't break
6. **Optimize for change** - Easy to evolve as we learn

### AI Principles

1. **Learn from behavior** - Implicit signals over explicit declarations
2. **Respectful of attention** - Pull not push, opt-in not opt-out
3. **Community verification** - Trust emerges from usage, not authority
4. **Knowledge evolves** - Version and update, don't accumulate
5. **Gradual rollout** - Prove value before scaling
6. **Quality non-negotiable** - Never compromise accuracy for cost

---

## Anti-Patterns to Avoid

❌ **Over-eager AI** - Responding to everything, interrupting conversations

❌ **Confidently wrong** - High confidence on incorrect information

❌ **Forced adoption** - Requiring AI use, no opt-out

❌ **Hidden complexity** - Users don't understand what's happening

❌ **Premature optimization** - Building for scale before validating value

❌ **Feature creep** - Adding "nice-to-haves" before validating "must-haves"

❌ **Stale knowledge** - Outdated information presented as current

❌ **Noisy notifications** - Too many interruptions

❌ **Quality compromise** - Cutting costs at expense of accuracy

❌ **Black box decisions** - Users don't know why AI did something

---

## Open Questions & Future Decisions

### To Be Determined

**Authentication flow:**

- Workspace invitation mechanism
- User onboarding experience
- Multi-workspace support (later)

**Billing & Pricing:**

- Pricing model ($10/user/month baseline)
- Stripe integration
- Trial period length
- Usage limits and quotas

**Enterprise features:**

- SAML/SSO integration timeline
- Advanced permissions model
- Audit logs and compliance
- Data export and portability

**Deployment:**

- CI/CD pipeline details
- Staging environment strategy
- Database backup and recovery
- Monitoring and alerting thresholds

**Regional expansion:**

- US market launch strategy
- Additional data center regions
- GDPR compliance verification
- Localization (languages)

### Research & Prototyping Needed

**Vector search performance:**

- Validate pgvector performance at 100k-1M vectors
- Benchmark query latency
- Compare with specialized vector DBs
- Determine migration threshold

**Knowledge extraction quality:**

- Test extraction accuracy across conversation types
- Tune context window size (±20 optimal?)
- Validate structured output quality
- Measure human editing required

**UI/UX:**

- Multi-channel tag display (inline badges)
- Thread nesting visualization
- AI response styling (clearly not human)
- Mobile-responsive design

---

## Appendix: Key Technical Decisions

### Decision Log

1. **Client-generated ULIDs** - True optimistic UI, free idempotency
2. **PostgreSQL primary database** - Single source of truth, proven at scale
3. **TypeScript full-stack** - Shared types, fast development, good ecosystem
4. **Transactional outbox** - Guaranteed delivery, strong consistency
5. **WebSocket + Redis pub/sub** - Real-time with horizontal scaling
6. **Multi-channel via junction table** - Graph model, many-to-many relationships
7. **Bun over Node** - Better DX, faster, built-in TypeScript (fallback to Node if issues)
8. **API-based AI** - Faster to market, access to best models, pay-per-use
9. **Hybrid search in PostgreSQL** - Vector + full-text, operational simplicity
10. **Manual knowledge extraction** - Validate value before automating
11. **Explicit @assistant invocation** - Conservative, user-controlled, no surprises
12. **Anchor + context window extraction** - Works for long threads and flat messages

### UX Decision Log

1. **Multi-channel tagging** - Both `#+channel` inline syntax and `[+ Add channel]` button
2. **Flat → Conversation** - Original message stays visible, gets `conversation_id` set
3. **Knowledge extraction** - Click on anchor message, AI reads ±20 context
4. **Default channels** - New workspace gets `#general` only
5. **Conversation root** - Original message is part of conversation in data model
6. **Knowledge structure** - Flexible markdown content, not rigid schema

---

## Version History

- **v1.0** (November 2025) - Initial specification for PoC/MVP
  - Consolidated product vision, technical architecture, AI layer
  - Locked in 6 key UX/behavior decisions
  - Simplified scope for validation
  - Updated terminology (contexts → channels)

---

**Document Status:** Living document - updates as we learn and iterate

**Owner:** Kristoffer (Product & Engineering)

**Last Review:** November 14, 2025
