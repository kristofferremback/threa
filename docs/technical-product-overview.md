# Threa: Technical & Product Overview

> A comprehensive analysis for AI researchers exploring the workspace communication market

**Document Version**: 1.0
**Last Updated**: November 2025
**Audience**: AI/ML researchers, product analysts, technical evaluators

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Space Analysis](#2-problem-space-analysis)
3. [Market Positioning](#3-market-positioning)
4. [Core Innovation: Graph-Based Conversations](#4-core-innovation-graph-based-conversations)
5. [AI/ML Architecture](#5-aiml-architecture)
6. [Technical Architecture](#6-technical-architecture)
7. [Data Model](#7-data-model)
8. [Real-Time Infrastructure](#8-real-time-infrastructure)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Cost Economics & Unit Economics](#10-cost-economics--unit-economics)
11. [Competitive Landscape](#11-competitive-landscape)
12. [Research Implications](#12-research-implications)
13. [Appendix: Technical Specifications](#appendix-technical-specifications)

---

## 1. Executive Summary

**Threa** is a workspace communication platform that addresses two fundamental failures in existing tools (Slack, Discord, Microsoft Teams):

1. **The Multi-Channel Problem**: Conversations naturally belong in multiple contexts, but tools force single-channel homes or create divergent cross-posts
2. **The Knowledge Decay Problem**: Valuable information drowns in chat history; experts repeatedly answer identical questions

### Core Thesis

> "Conversations naturally belong in multiple places, but tools force you to choose one home. We're building a platform where threads belong everywhere they're needed, and knowledge emerges naturally from helping people."

### Key Differentiators

| Aspect | Traditional Tools | Threa |
|--------|------------------|-------|
| Multi-channel | Cross-post (divergent copies) | Graph model (single thread, multiple channels) |
| Knowledge capture | Manual wikis (always outdated) | Emerges from conversations |
| AI assistance | Bolt-on features | Core to platform architecture |
| Question answering | Experts answer all | AI deflection for routine questions |
| Search | Keyword-only | Hybrid semantic + full-text |

### Target Market

**Startups and scale-ups (1-1,000 employees)** where:
- Institutional knowledge is critical for scaling
- Teams work async across timezones
- Information silos create friction
- Experts are bottlenecked answering repeat questions

### Implementation Priority (PoC Phase)

The solo-founder use case is the strategic wedge. If @ariadne is a compelling thinking partner, founders adopt Threa before they'd pick Slack — and their teams inherit the decision. This inverts the typical "convince a team to switch" challenge.

**Critical Path:**

| Priority | Feature | Rationale |
|----------|---------|-----------|
| 1 | **Thinking Spaces + Thinking Partner @ariadne** | Core solo-founder value. Without this, Threa competes on collaboration features where Slack has a decade head start. |
| 2 | **Knowledge extraction UI** | "Save as knowledge" button + AI-assisted structuring. Closes the loop from conversation → reusable knowledge. |
| 3 | **Search polish** | Hybrid search foundation exists. Polish for surfacing context well — essential for both retrieval and solo thinking. |
| 4 | **Multi-channel UX refinement** | The architectural moat. Not the marketing headline, but the hard-to-copy differentiator. Keep improving. |

**Deferred to post-validation:**

- AI Persona System (section 5.7) — validates after @ariadne proves valuable
- Integration add-ons (GitHub, Linear, Notion) — expands knowledge surface after core works
- Pricing/monetization specifics — observe usage patterns first
- Migration tools — less critical if winning founders before they adopt Slack

---

## 2. Problem Space Analysis

### 2.1 The Cross-Posting Dilemma

In existing tools, every message must select a single "home" channel. When a conversation affects multiple teams (e.g., an API bug affecting engineering, security, and operations), users face a choice:

**Option A: Pick One Channel**
- Other stakeholders miss the conversation
- Context is lost for future reference in other channels
- Creates "information silos"

**Option B: Cross-Post to Multiple Channels**
- Creates divergent copies that evolve independently
- Replies fragment across channels
- "Which thread has the latest update?"
- Manual effort to keep threads synchronized

**Threa's Solution**: A conversation exists in multiple channels simultaneously as a single entity. No copies, no divergence, one source of truth.

### 2.2 The Knowledge Decay Problem

**Current State in Traditional Tools**:
1. Expert answers question in chat
2. Answer scrolls away within hours
3. 6 months later, new hire asks same question
4. Expert answers again (or is unavailable)
5. Wikis exist but are perpetually outdated

**The Real Issue**: No one maintains documentation because:
- It's extra work separate from daily activities
- Documentation tools are disconnected from conversations
- There's no natural feedback loop

**Threa's Solution**: Knowledge "emerges" from natural Q&A flow. Answering questions creates institutional knowledge automatically (with AI assistance for structuring).

### 2.3 Quantified Pain Points

From the product specification, key metrics Threa aims to improve:

| Problem | Current State | Target |
|---------|---------------|--------|
| Repeat questions | Experts answer same questions multiple times | 80% deflection to AI |
| Time to answer | Hours/days waiting for expert | <5 minutes via AI |
| Knowledge utilization | Most answers never reused | 50+ knowledge entries per 100 users |
| Search effectiveness | Keyword-only, misses semantic matches | Hybrid with 60% semantic weight |

---

## 3. Market Positioning

### 3.1 Target Customer Profile

**Primary**: Engineering-led startups and scale-ups

Characteristics:
- 1-1,000 employees (initial focus: 1-50, sweet spot: solo founders through Series A)
- Distributed/remote work culture
- High knowledge worker density
- Growing fast enough that institutional knowledge matters
- Frustrated with Slack's limitations but not ready for enterprise tools

**Use Cases**:
- "How do we deploy to production?" (answered 10x/month)
- Cross-team incident coordination
- Onboarding new engineers
- Preserving decision context ("why did we choose X?")

### 3.2 Single-Founder to Team: Solving the Cold-Start Problem

Most collaboration tools are useless until you have collaborators—Slack with one person is just a weird notes app. Threa inverts this dynamic by providing **single-player value that compounds into multi-player advantage**.

**The Solo Founder Use Case:**

A founder using Threa as their "second brain"—thinking through problems with @assistant, extracting knowledge from their own reasoning, building institutional memory *before* there's an institution.

**The Expansion Moment:**

When employee #1 joins:
- Context already exists—no "let me explain how we got here"
- Knowledge base is populated from founder's explorations
- New hire can ask @assistant "why did we decide on this architecture?" and get answers from conversations the founder had *with themselves*
- Onboarding becomes inheritance rather than recreation

**Strategic Implications:**

1. **Single-player value**: The AI assistant must be genuinely useful for solo thinking and exploration—good enough that a founder chooses Threa over raw ChatGPT/Claude
2. **Zero-friction team expansion**: Adding people adds them to existing context, not a new empty workspace
3. **Built-in onboarding**: New hires inherit the founder's accumulated knowledge
4. **Solved cold-start problem**: No need to convince a team to switch simultaneously—convince one founder, the team inherits the decision

This extends the target range from "1-50 employees" to literally starting at 1. The founder builds the knowledge graph; the team benefits from day one.

**Prioritization Implication:** This strengthens the case for making @assistant excellent before expanding other features. If the single-player AI experience is compelling, organic growth into teams follows. If it's mediocre, Threa competes on collaboration features where Slack has a decade head start.

### 3.3 Pricing Model

**Target**: ~$10/user/month for paid plans (preliminary)

**Tier Structure** (preliminary):
- **Free Tier**: Basic chat with multi-channel conversations, unlimited message history (no AI)
- **Pro Tier**: Chat + AI features (search, @ariadne, curated personas, knowledge extraction)

### 3.4 Monetization Principles (To Be Validated)

Pricing will be determined after validating usage patterns. Key principles to guide future decisions:

1. **Simplicity over optimization**: Complex pricing kills conversions. When in doubt, simpler.

2. **Capability-based, not count-based**: If we monetize personas, charge for *what they can do* (model tier, integration access) rather than *how many exist*. Persona creation is free — it's just configuration.

3. **Aligned with actual costs**: Sonnet costs ~10x Haiku; integrations require maintenance. Pricing should reflect this naturally.

4. **Competitive positioning**: Slack AI charges $10/user/month mandatory for all users. There's room to offer better value through flexibility.

5. **Validate first, price later**: Build the persona system, observe how teams use it, then design pricing around real patterns.

### 3.5 Strategic Positioning

Threa is **not** attempting to:
- Replace Slack at enterprise scale
- Compete on integrations ecosystem
- Win on price alone

Threa **is** attempting to:
- Solve the multi-channel problem (novel, hard to copy)
- Make AI-as-deflection work (conservative, quality-first)
- Capture knowledge passively (philosophical differentiation)

---

## 4. Core Innovation: Graph-Based Conversations

### 4.1 The Unified Stream Model

Traditional tools have separate concepts:
- Channels (persistent, named)
- Threads (nested under messages)
- DMs (private, unnamed)
- Group chats (ad-hoc)

Threa unifies these into a single abstraction: **Streams**

```
streams
├── stream_type: 'channel' | 'thread' | 'dm' | 'incident'
├── parent_stream_id: (for threads - hierarchical)
├── branched_from_event_id: (which message started the thread)
├── visibility: 'public' | 'private' | 'inherit'
└── metadata: JSONB (flexible per-type data)
```

### 4.2 Multi-Channel Conversation Mechanics

**User Experience**:
1. User writes message in #engineering
2. Tags additional channels with `#+security` `#+api`
3. Message appears in all three channels as single entity
4. Replies are visible in all channels
5. No divergence, no sync issues

**Database Implementation**:
- Original message creates `stream_event` in primary channel
- Crosspost mentions stored in `mentions` JSONB array
- `shared_refs` table links to original event
- Target channels get `stream_event` with `event_type='shared'`
- All point to same `text_message` content

### 4.3 Thread Promotion

Threads can be "promoted" to full channels:

```
#engineering
└── "Seeing errors in Sentry"
    └── Thread: "This is turning into an incident"
        └── /promote-incident → "Checkout Outage" (now a channel)
```

This enables:
- Informal discussions that escalate to formal channels
- Incident management workflows
- Preserving full history after promotion

---

## 5. AI/ML Architecture

### 5.1 Design Philosophy

> "Human communication first, AI assistance second. Reduce repeat answers, not repeat questions."

Key Principles:
1. **Conservative over aggressive**: Better to miss than interrupt
2. **Quality over quantity**: Expensive Claude Sonnet > cheap models
3. **Explicit invocation**: AI responds only when @mentioned
4. **Transparent and controllable**: Users understand and control AI

### 5.2 Three-Pillar AI Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                      AI FEATURE STACK                        │
├─────────────────────────────────────────────────────────────┤
│  LAYER 3: ARIADNE COMPANION                                 │
│  - Answers routine questions                                 │
│  - Shows sources and confidence                              │
│  - Backs off when humans helping                             │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2: KNOWLEDGE EMERGENCE                                │
│  - Manual extraction with AI assistance                      │
│  - User clicks "Save as knowledge" on key message           │
│  - AI structures surrounding context into documentation      │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1: HYBRID SEARCH                                      │
│  - Vector embeddings (semantic similarity)                   │
│  - Full-text search (keyword matching)                       │
│  - Combined: 60% semantic + 40% full-text                   │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Ariadne: The AI Companion

**Named after Greek mythology** - Ariadne gave Theseus the thread to navigate the labyrinth.

**Architecture**:
- **Framework**: LangChain + LangGraph (ReAct agent pattern)
- **Model**: Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- **Temperature**: 0.7 (balanced creativity)
- **Max tokens**: 2048

**Available Tools**:
1. `search_messages` - Searches past conversations with filters
2. `search_knowledge` - Searches curated knowledge base
3. `get_stream_context` - Gets recent messages from current stream
4. `get_thread_history` - Gets full thread including root message

**Invocation Flow**:
```
User mentions @ariadne in message
         ↓
StreamService detects mention
         ↓
Enqueues ai.respond job (URGENT priority)
         ↓
AriadneWorker processes within 2 seconds
         ↓
Agent invokes tools, generates response
         ↓
Response posted as agent_id (not actor_id)
         ↓
Real-time broadcast via WebSocket
```

### 5.4 Embedding & Vector Search

**Dual-Provider Strategy**:

| Environment | Provider | Dimensions | Model |
|-------------|----------|------------|-------|
| Development | Ollama (local) | 768 | nomic-embed-text |
| Production | OpenAI API | 1536 | text-embedding-3-small |

**Hybrid Search Implementation**:
```sql
-- Combined score calculation
score = (semantic_similarity * 0.6) + (full_text_rank * 0.4)

-- Vector search (pgvector IVFFlat index)
SELECT 1 - (embedding <=> query_embedding) AS semantic_score

-- Full-text search (tsvector with ts_rank)
SELECT ts_rank(search_vector, plainto_tsquery(query)) AS text_score
```

**Query Syntax** (Slack-compatible):
- `from:@username` - Filter by author
- `in:#channel` - Filter by stream
- `before:YYYY-MM-DD`, `after:YYYY-MM-DD` - Date range
- `has:code`, `has:link` - Content patterns

### 5.5 Classification System

**Two-Tier Strategy for Cost Optimization**:

```
Message/Thread Activity
         ↓
Structural Pre-filter (code-based)
- Length, code blocks, lists, reactions
         ↓
If score ≥ 3: Queue classification
         ↓
┌──────────────────────────────────────┐
│ TIER 1: Local SLM (granite4:350m)    │
│ Cost: FREE                           │
│ If confident → Use result            │
│ If uncertain ↓                       │
├──────────────────────────────────────┤
│ TIER 2: Claude Haiku (API fallback)  │
│ Cost: $0.25/1M input tokens          │
│ Higher quality for edge cases        │
└──────────────────────────────────────┘
```

### 5.6 Worker Architecture

**Job Queue**: pg-boss (PostgreSQL-backed)

| Job Type | Priority | Batch Size | Purpose |
|----------|----------|------------|---------|
| ai.respond | URGENT (1) | 1 | @ariadne responses |
| ai.extract | HIGH (3) | 1 | User-triggered knowledge extraction |
| ai.embed | NORMAL (5) | 50 | Vector embeddings |
| ai.classify | LOW (7) | 1 | Knowledge candidate detection |

**Reliability Features**:
- 3 retries with 30s delay
- Exponential backoff
- 1-hour expiration
- 7-day retention, 14-day deletion

### 5.7 AI Persona System (Planned)

**Philosophy**: Ariadne is the default persona, but workspaces will be able to configure additional AI personas with different capabilities, tool access, and behavioral patterns. Customers have use cases we can't anticipate—self-service persona creation unlocks that value.

**Architecture Concept**:

```
┌─────────────────────────────────────────────────────────────┐
│                    PERSONA SYSTEM                            │
├─────────────────────────────────────────────────────────────┤
│  CURATED PERSONAS (Threa-provided)                          │
│  @ariadne    - General knowledge companion (default)        │
│  @reviewer   - Code review assistance, PR context           │
│  @onboarder  - New hire questions, explains "why we do X"   │
│  @incident   - Incident coordination, runbook lookup        │
├─────────────────────────────────────────────────────────────┤
│  CUSTOM PERSONAS (Workspace-defined)                        │
│  - Custom system prompts                                    │
│  - Selective tool access (e.g., only search_knowledge)      │
│  - Channel restrictions (only responds in certain channels) │
│  - Model selection (Sonnet vs Haiku for cost control)       │
│  - Integration-specific (e.g., @github with repo context)   │
└─────────────────────────────────────────────────────────────┘
```

**Persona Configuration**:
```typescript
interface AIPersona {
  id: string;                    // persona_01ARZ3...
  workspace_id: string;
  name: string;                  // Display name (@reviewer)
  system_prompt: string;         // Custom instructions
  tools: string[];               // Allowed tool IDs
  channels: string[] | null;     // Restricted channels (null = all)
  model: 'sonnet' | 'haiku';     // Model selection
  temperature: number;           // Response creativity
  is_curated: boolean;           // Threa-provided vs custom
  created_by: string;
  created_at: Date;
}
```

**Strategic Value**:

1. **Extensibility without engineering**: Customers configure personas for their specific workflows without Threa building each use case
2. **Integration leverage**: Personas can be specialized for specific integrations (e.g., @github persona with repository-aware tools)
3. **Cost control**: Workspaces can create Haiku-based personas for high-volume, simpler tasks
4. **Channel-specific behavior**: A `#support` channel might have a customer-focused persona while `#engineering` has a technical one
5. **Competitive moat**: The accumulated personas and their configurations become workspace-specific institutional knowledge

**Scope**: Deferred to post-MVP. Ariadne as single persona validates the AI assistant value; persona system expands it.

### 5.8 Thinking Spaces (Planned)

**Philosophy**: @ariadne in channels is a retrieval assistant — invoked explicitly, answers from knowledge. But solo founders (and small teams) need a *thinking partner* — an AI that engages with problems, asks questions, and reasons alongside you. Thinking Spaces provide this mode.

**Core Concept**: A Thinking Space is a stream where @ariadne is always present and engaged. No @mention required — you talk, @ariadne responds as a thinking partner.

```
┌─────────────────────────────────────────────────────────────┐
│  REGULAR CHANNELS                                           │
│  - @ariadne invoked with explicit @mention                  │
│  - Retrieval mode: searches knowledge, answers questions    │
│  - Conservative: only speaks when asked                     │
│  - Multi-participant by default                             │
├─────────────────────────────────────────────────────────────┤
│  THINKING SPACES                                            │
│  - @ariadne sees all messages automatically                 │
│  - Thinking partner mode: reasons, questions, pushes back   │
│  - Engaged: responds to continue dialogue                   │
│  - Solo by default (can invite others)                      │
└─────────────────────────────────────────────────────────────┘
```

**UX Behavior**:

1. **Creation**: User clicks "New thinking space" — creates a stream with `stream_type: 'thinking_space'` and @ariadne as default member
2. **Naming**: Auto-generated from first message content (like iMessage/ChatGPT), user can rename anytime
3. **Interaction**: No @mention needed. User sends message → @ariadne responds
4. **Invitations**: Other users can be invited to think together (cofounder, advisor)
5. **Knowledge access**: @ariadne can still pull from workspace knowledge graph ("You discussed something similar in #engineering last week...")

**Adaptive Behavior**:

@ariadne's mode is determined by stream context:

| Context | Mode | Behavior |
|---------|------|----------|
| Channel with multiple participants | Retrieval | Answers when @mentioned, searches knowledge |
| Thinking Space (solo) | Thinking partner | Engages with every message, reasons through problems |
| Thinking Space (with guests) | Collaborative | Thinking partner but aware of multiple perspectives |
| DM with @ariadne | Thinking partner | Same as thinking space |

**What Thinking Partner Mode Enables**:

- **Reasoning without retrieval**: When there's no knowledge to retrieve, @ariadne engages with the problem directly rather than saying "I couldn't find anything"
- **Conversation memory**: Tracks the arc of the discussion — "We've established X, you're leaning toward Y, the open question is Z"
- **Clarifying questions**: Asks for context instead of assuming
- **Pushback**: Challenges assumptions, offers counterarguments
- **Framework suggestions**: "Have you considered thinking about this as..."

**Strategic Importance**:

This is the key to solo-founder value. A founder using Threa as their second brain — thinking through problems with @ariadne, extracting knowledge from their own reasoning — builds institutional memory before the institution exists. When employee #1 joins, the context is already there.

**Scope**: High priority for solo-founder use case. Simple implementation first (stream + auto-responding @ariadne), polish later.

---

## 6. Technical Architecture

### 6.1 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Runtime | Bun | Fast DX, modern JS runtime |
| Backend | Express.js | Proven, well-understood |
| Database | PostgreSQL + pgvector | Operational simplicity, vector support |
| Cache/Pub-Sub | Redis | Horizontal scaling for WebSockets |
| Job Queue | pg-boss | No external service, PostgreSQL-native |
| Real-time | Socket.IO + Redis adapter | Multi-server support |
| Auth | WorkOS Authkit | Enterprise SSO ready |
| AI | LangChain + Anthropic/OpenAI | Flexible agent framework |
| Frontend | React 19 + Vite | Modern, fast builds |
| Styling | Tailwind CSS | Utility-first, consistent |
| Editor | Tiptap (ProseMirror) | Rich text with extensions |

### 6.2 Service Layer Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                    EXPRESS SERVER                            │
├─────────────────────────────────────────────────────────────┤
│  Routes (auth, streams, search, invitations)                │
├─────────────────────────────────────────────────────────────┤
│  Services (stateless, injected pool)                        │
│  ├── AuthService (WorkOS integration)                       │
│  ├── StreamService (streams, events, membership)            │
│  ├── UserService (user management, profiles)                │
│  ├── WorkspaceService (workspaces, invitations)             │
│  ├── SearchService (hybrid search)                          │
│  └── AIUsageService (cost tracking)                         │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure                                              │
│  ├── Database Pool (pg, max 20 connections)                 │
│  ├── Redis (pub/sub clients)                                │
│  ├── Job Queue (pg-boss)                                    │
│  ├── Outbox Listener (event publishing)                     │
│  └── AI Workers (embedding, classification, respond)        │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 Graceful Shutdown

```
SIGTERM/SIGINT received
         ↓
Pre-shutdown: Stop Socket.IO, workers
         ↓
Close HTTP server (no new connections)
         ↓
Stop outbox listener
         ↓
Close database pool
         ↓
Disconnect Redis clients
         ↓
Exit process
         ↓
(Timeout: Force exit after 30 seconds)
```

---

## 7. Data Model

### 7.1 Core Tables

```
┌─────────────────────────────────────────────────────────────┐
│                    CORE DATA MODEL                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  workspaces ←──────────────────────────────────────────┐    │
│      │                                                  │    │
│      ├── users ←── workspace_members ──→ workspace_profiles │
│      │                                                  │    │
│      ├── streams ←── stream_members ───────────────────┘    │
│      │      │                                               │
│      │      └── stream_events ←── text_messages             │
│      │              │                                       │
│      │              └── shared_refs (crossposts)            │
│      │                                                      │
│      ├── knowledge (extracted documentation)                │
│      │                                                      │
│      ├── ai_personas (Ariadne configuration)                │
│      │                                                      │
│      └── ai_usage (cost tracking)                           │
│                                                              │
│  outbox (transactional event queue)                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Stream Events (Polymorphic)

Events use a polymorphic content pattern:

```
stream_events
├── event_type: 'message' | 'shared' | 'member_joined' | ...
├── content_type: 'text_message' | 'shared_ref' | 'poll' | 'file'
├── content_id: FK to content table
├── actor_id: User (nullable if agent)
├── agent_id: AI persona (mutually exclusive with actor)
└── payload: JSONB for event-specific data
```

**Constraint**: Either `actor_id` or `agent_id` must be set (never both, never neither)

### 7.3 Mentions System

Stored as JSONB in `text_messages.mentions`:

```json
[
  { "type": "user", "id": "usr_123", "label": "alice" },
  { "type": "channel", "id": "str_456", "label": "engineering", "slug": "engineering" },
  { "type": "crosspost", "id": "str_789", "label": "security", "slug": "security" }
]
```

### 7.4 Vector Storage

Dual-table strategy for provider flexibility:

```sql
-- Development (Ollama, 768 dimensions)
CREATE TABLE embeddings_768 (
  text_message_id TEXT PRIMARY KEY,
  embedding vector(768) NOT NULL,
  model TEXT DEFAULT 'nomic-embed-text'
);

-- Production (OpenAI, 1536 dimensions)
CREATE TABLE embeddings_1536 (
  text_message_id TEXT PRIMARY KEY,
  embedding vector(1536) NOT NULL,
  model TEXT DEFAULT 'text-embedding-3-small'
);

-- IVFFlat index for approximate nearest neighbor
CREATE INDEX idx_embeddings_vector
  ON embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

---

## 8. Real-Time Infrastructure

### 8.1 Event Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 REAL-TIME EVENT FLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  HTTP POST (user action)                                     │
│         ↓                                                    │
│  StreamService (within transaction)                          │
│  ├── INSERT stream_events                                    │
│  ├── INSERT outbox                                           │
│  └── NOTIFY outbox_event                                     │
│         ↓                                                    │
│  PostgreSQL NOTIFY (instant signal)                          │
│         ↓                                                    │
│  OutboxListener                                              │
│  ├── Debounce (50ms window, 200ms max)                      │
│  ├── Batch query (100 events)                               │
│  ├── Publish to Redis                                        │
│  └── Mark processed                                          │
│         ↓                                                    │
│  Redis Pub/Sub                                               │
│  └── Channel: event:{event_type}                            │
│         ↓                                                    │
│  Socket.IO Server                                            │
│  ├── Route to rooms                                          │
│  └── Broadcast to clients                                    │
│         ↓                                                    │
│  Browser (React hooks)                                       │
│  └── Update UI state                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Room Naming Convention

```typescript
const room = {
  // Per-stream: events, edits, typing
  stream: (wsId, streamId) => `ws:${wsId}:stream:${streamId}`,

  // Workspace-wide: sidebar badges, new streams
  workspace: (wsId) => `ws:${wsId}:workspace`,

  // User-specific: mentions, DMs, read sync
  user: (wsId, userId) => `ws:${wsId}:user:${userId}`,
}
```

### 8.3 Latency Characteristics

| Step | Latency | Notes |
|------|---------|-------|
| DB insert → NOTIFY | <1ms | Same transaction |
| NOTIFY → Redis | 0-50ms | Debounced |
| Redis → Socket.IO | <10ms | In-process |
| Socket.IO → Browser | 10-100ms | Network |
| **Total** | **20-200ms** | Under normal conditions |

### 8.4 Horizontal Scaling

```
┌──────────────┐          ┌──────────────┐
│ Server 1     │          │ Server 2     │
│ ├─Socket.IO  │          │ ├─Socket.IO  │
│ └─Outbox     │          │ └─Outbox     │
└──────┬───────┘          └──────┬───────┘
       │                         │
       └────────────┬────────────┘
                    │
                ┌───▼───┐
                │ Redis │ (adapter syncs rooms)
                └───────┘
```

---

## 9. Frontend Architecture

### 9.1 Component Hierarchy

```
App
├── AuthProvider (session management)
├── ThemeProvider (dark/light mode)
└── LayoutSystem (main orchestrator)
    ├── Sidebar (stream list, navigation)
    ├── CommandPalette (Cmd+P / Cmd+Shift+F)
    ├── PaneSystem (multi-pane tabs)
    │   └── StreamInterface
    │       ├── ChatHeader
    │       ├── EventList (messages)
    │       │   └── MessageItem
    │       │       └── MessageContent
    │       └── ChatInput
    │           └── RichTextEditor (Tiptap)
    └── Modals (create channel, settings, etc.)
```

### 9.2 State Management

**No global state manager** - uses React Context + hooks:

| Context | Purpose |
|---------|---------|
| AuthContext | Session, user, logout |
| ThemeContext | Light/dark/system theme |
| useBootstrap | Workspace data, streams, users |
| usePaneManager | Tab/pane state with URL sync |
| useStream | Per-stream events, real-time |
| useWorkspaceSocket | Workspace-level events |

### 9.3 URL-Driven Pane State

```
?p=s:general,s:thread_123|a:activity

Format:
- Panes separated by |
- Tabs within pane by ,
- s: = stream (by slug or ID)
- a: = activity view
- First tab in each pane is active
```

**Benefits**:
- Shareable URLs with exact view state
- Browser back/forward works
- Bookmarkable workspace views

### 9.4 Rich Text Editor

**Framework**: Tiptap (ProseMirror wrapper)

**Extensions**:
- StarterKit (bold, italic, lists, blockquotes, code)
- CodeBlockLowlight (syntax highlighting)
- Markdown (import/export)
- Link (URL insertion)
- Custom Mention (three types)

**Mention Types**:
- `@user` - User mentions with autocomplete
- `#channel` - Channel references
- `#+channel` - Crosspost to channel

---

## 10. Cost Economics & Unit Economics

### 10.1 AI Cost Structure

**Model Costs** (per 1M tokens, in cents):

| Model | Input | Output | Use Case |
|-------|-------|--------|----------|
| text-embedding-3-small | $2 | - | Embeddings |
| Claude Sonnet 4 | $300 | $1,500 | Ariadne responses |
| Claude Haiku 3.5 | $25 | $125 | Classification fallback |
| granite4:350m (local) | $0 | $0 | Classification primary |
| nomic-embed-text (local) | $0 | $0 | Dev embeddings |

### 10.2 Cost Projections

**At 1,000 active users/month, $10/user pricing**:

| Metric | Value |
|--------|-------|
| Revenue | $10,000/month |
| AI costs (estimated) | $55-105/month |
| AI as % of revenue | 0.5-1% |

**At scale with aggressive AI usage**:

| Metric | Value |
|--------|-------|
| 50,000 questions/month | ~$790/month AI spend |
| At $10/user | ~8% of revenue |

### 10.3 Budget Controls

- Default budget: $100/month per workspace (10,000 cents)
- Workers check budget before executing
- Graceful degradation at limits
- Per-workspace tracking with daily/monthly rollups

### 10.4 Cost Optimization Strategies

1. **Local-first models**: Ollama for classification/dev embeddings
2. **API fallback**: Only when local uncertain or unavailable
3. **Batch processing**: Embeddings batched up to 50
4. **Structural pre-filtering**: Skip obviously non-valuable content
5. **Two-tier classification**: Free SLM → Paid API only when needed

---

## 11. Competitive Landscape

### 11.1 Direct Competitors

| Product | Strengths | Weaknesses vs Threa |
|---------|-----------|---------------------|
| **Slack** | Market leader, integrations | Single-channel forcing, bolt-on AI |
| **Discord** | Communities, voice | Gaming-focused, chaotic threads |
| **Microsoft Teams** | Enterprise, Office integration | Complex, enterprise-focused |
| **Notion** | Docs + chat | Weak real-time, document-centric |
| **Twist** | Async-first | No AI, limited adoption |

### 11.2 Threa's Differentiated Position

```
                    ┌─────────────────────────────────────┐
                    │       Enterprise Focus              │
                    │                                     │
         Slack ◄────┤                           Teams     │
                    │                              ▲      │
                    │                              │      │
    Simple ◄────────┼──────────────────────────────┼──────► Complex
                    │                              │      │
                    │      Threa ◄─────────────────┘      │
                    │        ▲                            │
                    │        │                            │
                    │   Discord                           │
                    │                                     │
                    │       Startup Focus                 │
                    └─────────────────────────────────────┘
```

### 11.3 Defensibility Analysis

| Innovation | Defensibility | Time to Copy |
|------------|---------------|--------------|
| Multi-channel graph model | HIGH - architectural | 12-18 months |
| Knowledge emergence | MEDIUM - philosophical | 6-12 months |
| AI-as-deflection | LOW - feature | 3-6 months |
| Hybrid search | LOW - commodity | 1-3 months |

---

## 12. Research Implications

### 12.1 For AI/ML Researchers

**Interesting Patterns**:

1. **Two-tier classification**: Using local SLMs as first-pass filters before API calls
   - Reduces costs 90%+ while maintaining quality
   - Applicable to many classification tasks

2. **Hybrid retrieval**: 60/40 semantic/keyword blend outperforms either alone
   - Combines meaning understanding with exact matching
   - Tunable ratio based on domain

3. **Conservative AI design**: Explicit invocation vs. proactive interruption
   - Better user experience metrics (hypothesis)
   - Reduces "AI fatigue"

4. **Knowledge emergence**: Extracting structured knowledge from conversations
   - Context window of ±20 messages
   - AI structures, human reviews
   - Natural feedback loop

### 12.2 For Product Researchers

**Hypotheses Being Tested**:

1. "Multi-channel conversations reduce cross-posting pain"
   - Metric: % conversations with 2+ channels
   - Validation: User feedback surveys

2. "@ariadne reduces repeat questions"
   - Metric: Deflection rate (AI answered / total questions)
   - Metric: Helpfulness ratings

3. "Manual knowledge extraction with AI assistance is valuable"
   - Metric: Knowledge reuse rate
   - Metric: Time to first reuse

### 12.3 For Market Researchers

**Market Dynamics**:

1. **Slack fatigue**: Large companies spending $20-30/user, questioning value
2. **AI expectations**: Users expect AI features, but hate bad AI
3. **Async shift**: Remote work driving async-first communication
4. **Knowledge management**: Growing recognition that chat ≠ knowledge

**Threa's Bet**: The next generation of workspace tools will have:
- Graph-based information architecture (not channel silos)
- AI as infrastructure (not feature)
- Knowledge as emergent property (not separate system)

---

## Appendix: Technical Specifications

### A.1 API Endpoints

```
Authentication:
GET  /api/auth/login        → Redirect to WorkOS
GET  /api/auth/callback     → OAuth callback
POST /api/auth/logout       → Destroy session
GET  /api/auth/me           → Current user

Workspace:
GET  /api/workspace/default/bootstrap → Initial data load

Streams:
GET    /api/workspace/:ws/streams              → List streams
POST   /api/workspace/:ws/streams              → Create stream
GET    /api/workspace/:ws/streams/:id          → Get stream
PATCH  /api/workspace/:ws/streams/:id          → Update stream
DELETE /api/workspace/:ws/streams/:id          → Archive stream
GET    /api/workspace/:ws/streams/:id/events   → Get events
POST   /api/workspace/:ws/streams/:id/events   → Create event
POST   /api/workspace/:ws/streams/:id/join     → Join stream
POST   /api/workspace/:ws/streams/:id/leave    → Leave stream

Search:
GET  /api/workspace/:ws/search?q=...          → Hybrid search

Invitations:
POST /api/workspace/:ws/invitations           → Create invitation
GET  /api/invitation/:token                   → Get invitation
POST /api/invitation/:token/accept            → Accept invitation
```

### A.2 WebSocket Events

```
Client → Server:
- join(roomName)            → Join Socket.IO room
- leave(roomName)           → Leave Socket.IO room
- reply(streamId, content)  → Send message
- typing(streamId)          → Typing indicator

Server → Client:
- connected                 → Connection confirmed
- authenticated             → Auth confirmed
- event                     → New stream event
- event:edited              → Message edited
- event:deleted             → Message deleted
- notification              → Workspace notification
- notification:new          → User notification
- readCursor:updated        → Multi-device sync
- stream:created            → New stream
- stream:member:added       → Added to stream
- stream:member:removed     → Removed from stream
```

### A.3 Environment Variables

```bash
# Required
WORKOS_API_KEY=...
WORKOS_CLIENT_ID=...
WORKOS_COOKIE_PASSWORD=...

# Optional (with defaults)
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://threa:threa@localhost:5433/threa
REDIS_URL=redis://localhost:6380
LOG_LEVEL=info
EMBEDDING_PROVIDER=ollama  # or 'openai'
```

### A.4 Database Migrations

| Migration | Description |
|-----------|-------------|
| 001-007 | Legacy (pre-stream model) |
| 008 | Unified streams model |
| 009 | Pinned streams |
| 010 | Invitations |
| 011 | Workspace profiles |
| 012 | AI features (usage, knowledge, personas) |
| 013 | Flexible embedding dimensions |
| 014 | Dual embedding tables (provider-aware) |
| 015 | Agent events (AI can post messages) |

### A.5 Key Files Reference

| File | Purpose | Lines |
|------|---------|-------|
| `src/server/index.ts` | Server entry point | 250 |
| `src/server/services/stream-service.ts` | Core data model | 1,800 |
| `src/server/services/search-service.ts` | Hybrid search | 490 |
| `src/server/ai/ariadne/agent.ts` | LangChain agent | 200 |
| `src/server/workers/` | AI job processing | 700 |
| `src/frontend/components/chat/RichTextEditor.tsx` | Tiptap editor | 900 |
| `src/frontend/hooks/useStream.ts` | Stream WebSocket | 600 |
| `src/frontend/components/layout/LayoutSystem.tsx` | Main UI orchestrator | 680 |

---

*Document generated for AI research purposes. For the latest implementation details, refer to the source code.*
