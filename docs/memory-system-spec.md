# Threa Memory System: Technical Specification

> Evolved knowledge architecture inspired by General Agentic Memory (GAM)

**Document Version**: 1.0  
**Last Updated**: November 2025  
**Status**: Draft  
**Depends On**: Technical & Product Overview v1.0

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Architecture](#3-architecture)
4. [Data Model](#4-data-model)
5. [Processing Pipeline](#5-processing-pipeline)
6. [Ariadne: Iterative Researcher](#6-ariadne-iterative-researcher)
7. [User-Facing Features](#7-user-facing-features)
8. [Evolution & Learning](#8-evolution--learning)
9. [Cost Management](#9-cost-management)
10. [Implementation Phases](#10-implementation-phases)
11. [API Reference](#11-api-reference)
12. [Migration Strategy](#12-migration-strategy)

---

## 1. Overview

### 1.1 Problem Statement

The current knowledge system follows an **Ahead-of-Time (AOT)** paradigm: valuable messages are identified, extracted into structured knowledge entries, and those entries become the answer source. This approach has fundamental limitations:

1. **Information loss**: Extraction compresses context; nuance is lost
2. **Static structure**: Pre-computed answers can't adapt to novel questions  
3. **Staleness**: Extracted knowledge doesn't update when source conversations evolve
4. **Single consumer**: Knowledge entries serve Ariadne but aren't directly useful to humans

### 1.2 Proposed Solution

Adopt a **Just-in-Time (JIT)** paradigm inspired by the GAM research paper:

- **Keep complete history** in a searchable page store
- **Create lightweight memos** that index into valuable conversations (not extract from them)
- **Synthesize at query time** using iterative retrieval and reflection
- **Expose the memory layer** to both Ariadne and human users

### 1.3 Key Insight

> "Search is made as the core of memory, while memorization is conducted to enable effective search."

Memos don't contain answers—they help find where answers live. Ariadne (and users) retrieve actual conversations and synthesize on demand.

### 1.4 Success Metrics

| Metric | Current Target | Evolved Target |
|--------|----------------|----------------|
| Question deflection rate | 80% | 85% (better retrieval) |
| Time to answer | <5 minutes | <30 seconds (cached memos) |
| Knowledge reuse | 50 entries/100 users | 200+ memos/100 users (auto-generated) |
| User self-service | N/A | 40% questions answered via browse (no AI) |

---

## 2. Design Principles

### 2.1 Core Principles

**1. Pointers over content**

Memos point to source conversations rather than duplicating content. This ensures:
- No staleness (source is always current)
- No information loss (full context available)
- Single source of truth

**2. Lazy enrichment**

Don't pre-compute everything. Wait for signals that content is valuable:
- Social proof (reactions, replies)
- Retrieval success (Ariadne found it useful)
- Explicit user action (save as knowledge)

**3. Graceful degradation**

The system works at every enrichment level:
- No enrichment: basic keyword search still works
- Basic embedding: semantic search works
- Contextual header: high-precision retrieval
- Memo exists: instant navigation

**4. Dual consumption**

The memory layer serves both AI and humans. Ariadne uses it for retrieval; users browse it directly.

### 2.2 Philosophical Alignment

This design reinforces Threa's core philosophy:

> "Make answers effortless, not questions burdensome."

Users can browse knowledge directly without invoking AI. Questions are still welcome—browsing is an alternative path, not a gate.

---

## 3. Architecture

### 3.1 Three-Layer Memory System

```
┌─────────────────────────────────────────────────────────────┐
│                    THREA MEMORY SYSTEM                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  LAYER 3: SYNTHESIS (query-time)                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Ariadne Researcher                                  │   │
│  │ - Iterative plan → search → reflect loop           │   │
│  │ - Synthesizes from retrieved conversations          │   │
│  │ - Cites sources with confidence scores             │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↑                                 │
│                           │ retrieves                       │
│                           ↓                                 │
│  LAYER 2: MEMO INDEX (lightweight pointers)                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Memos                                               │   │
│  │ - Short summaries pointing to conversations         │   │
│  │ - Topic clusters, semantic groupings               │   │
│  │ - Expert signals (who knows what)                  │   │
│  │ - Question patterns (what gets asked)              │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↑                                 │
│                           │ indexes                         │
│                           ↓                                 │
│  LAYER 1: PAGE STORE (complete history)                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Messages + Contextual Headers                       │   │
│  │ - All messages with full conversation context       │   │
│  │ - Contextual embeddings (message + surrounding)     │   │
│  │ - Full-text search indices (tsvector)              │   │
│  │ - Hybrid search: 60% semantic + 40% keyword        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow Overview

```
Message Created
       ↓
┌──────────────────┐
│ Structural Filter │ ←── Free, code-based
└────────┬─────────┘
         │ passes
         ↓
┌──────────────────┐
│ Basic Embedding  │ ←── $0.004/msg, batched
└────────┬─────────┘
         │
         ↓
    [Wait for signals]
         │
    ┌────┴────┬──────────┬──────────────┐
    ↓         ↓          ↓              ↓
 Reaction   Reply    Referenced    Ariadne
 received   added    elsewhere     retrieved
    │         │          │              │
    └────┬────┴──────────┴──────────────┘
         ↓
┌──────────────────┐
│ Contextual       │ ←── $0.02/msg, queued
│ Enrichment       │
└────────┬─────────┘
         │
         ↓
┌──────────────────┐
│ Memo Creation    │ ←── Metadata only, ~free
│ (if valuable)    │
└──────────────────┘
```

### 3.3 Component Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                      SERVICES                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MemoryService (new)                                        │
│  ├── createMemo(anchorEventIds, summary)                   │
│  ├── searchMemos(query, filters)                           │
│  ├── getMemosByTopic(topic)                                │
│  ├── getRelatedConversations(eventId)                      │
│  ├── recordRetrieval(memoId, helpful)                      │
│  └── evolve() // background evolution job                  │
│                                                             │
│  EnrichmentService (new)                                    │
│  ├── generateContextualHeader(eventId)                     │
│  ├── enrichMessage(eventId)                                │
│  ├── shouldEnrich(event, signals) → boolean                │
│  └── batchEnrich(eventIds)                                 │
│                                                             │
│  SearchService (enhanced)                                   │
│  ├── hybridSearch(query, filters)        // existing       │
│  ├── searchWithMemos(query) → {memos, messages}  // new    │
│  └── getContextWindow(eventId, range)    // new            │
│                                                             │
│  AriadneService (enhanced)                                  │
│  ├── respond(question, streamContext)    // existing       │
│  ├── iterativeResearch(question)         // new            │
│  └── planInformationNeeds(question)      // new            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Data Model

### 4.1 New Tables

#### 4.1.1 Memos (replaces `knowledge` table)

```sql
CREATE TABLE memos (
  id TEXT PRIMARY KEY DEFAULT generate_ulid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- What this memo is about
  summary TEXT NOT NULL,              -- "How to deploy to production"
  topics TEXT[] DEFAULT '{}',         -- ["deployment", "CI", "production"]
  
  -- Pointers to source (NOT extracted content)
  anchor_event_ids TEXT[] NOT NULL,   -- Key messages
  context_stream_id TEXT REFERENCES streams(id),
  context_start_event_id TEXT,        -- Conversation window start
  context_end_event_id TEXT,          -- Conversation window end
  
  -- Participants (for expert routing)
  participant_ids TEXT[] DEFAULT '{}',
  primary_answerer_id TEXT REFERENCES users(id),
  
  -- Retrieval metadata
  confidence REAL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  retrieval_count INTEGER DEFAULT 0,
  last_retrieved_at TIMESTAMPTZ,
  helpfulness_score REAL DEFAULT 0,   -- Accumulated from feedback
  
  -- Provenance
  source TEXT NOT NULL CHECK (source IN ('user', 'system', 'ariadne')),
  created_by TEXT REFERENCES users(id),  -- NULL if system/ariadne
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Visibility (inherits from source stream)
  visibility TEXT NOT NULL DEFAULT 'workspace' 
    CHECK (visibility IN ('workspace', 'channel', 'private')),
  visible_to_stream_ids TEXT[] DEFAULT '{}',  -- If channel/private scoped
  
  -- Soft delete
  archived_at TIMESTAMPTZ,
  
  -- Embedding for semantic search over memos
  embedding vector(1536)
);

-- Indexes
CREATE INDEX idx_memos_workspace ON memos(workspace_id) WHERE archived_at IS NULL;
CREATE INDEX idx_memos_topics ON memos USING gin(topics) WHERE archived_at IS NULL;
CREATE INDEX idx_memos_confidence ON memos(workspace_id, confidence DESC) WHERE archived_at IS NULL;
CREATE INDEX idx_memos_embedding ON memos USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_memos_anchor_events ON memos USING gin(anchor_event_ids);
```

#### 4.1.2 Contextual Headers

```sql
-- Add to existing text_messages table
ALTER TABLE text_messages ADD COLUMN contextual_header TEXT;
ALTER TABLE text_messages ADD COLUMN header_generated_at TIMESTAMPTZ;
ALTER TABLE text_messages ADD COLUMN enrichment_tier INTEGER DEFAULT 0;
  -- 0: not processed
  -- 1: basic embedding only
  -- 2: contextual header generated

-- Track why we enriched (for debugging/tuning)
ALTER TABLE text_messages ADD COLUMN enrichment_signals JSONB DEFAULT '{}';
  -- {"reactions": 3, "replies": 2, "retrieved": true}
```

#### 4.1.3 Retrieval Log (for evolution)

```sql
CREATE TABLE retrieval_log (
  id TEXT PRIMARY KEY DEFAULT generate_ulid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- The query
  query TEXT NOT NULL,
  query_embedding vector(1536),
  requester_type TEXT NOT NULL CHECK (requester_type IN ('ariadne', 'user', 'system')),
  requester_id TEXT,  -- user_id or persona_id
  
  -- What was retrieved
  retrieved_memo_ids TEXT[] DEFAULT '{}',
  retrieved_event_ids TEXT[] DEFAULT '{}',
  retrieval_scores JSONB DEFAULT '{}',  -- {memo_id: score, ...}
  
  -- Synthesis (if Ariadne)
  response_event_id TEXT REFERENCES stream_events(id),
  iteration_count INTEGER DEFAULT 1,
  
  -- Outcome
  user_feedback TEXT CHECK (user_feedback IN ('positive', 'negative', 'neutral')),
  feedback_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for evolution queries
CREATE INDEX idx_retrieval_log_workspace ON retrieval_log(workspace_id, created_at DESC);
CREATE INDEX idx_retrieval_log_memos ON retrieval_log USING gin(retrieved_memo_ids);
CREATE INDEX idx_retrieval_log_feedback ON retrieval_log(workspace_id, user_feedback) 
  WHERE user_feedback IS NOT NULL;
```

#### 4.1.4 Expert Signals

```sql
CREATE TABLE expertise_signals (
  id TEXT PRIMARY KEY DEFAULT generate_ulid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  topic TEXT NOT NULL,
  
  -- Signal sources
  questions_answered INTEGER DEFAULT 0,
  answers_cited_by_ariadne INTEGER DEFAULT 0,
  positive_reactions_received INTEGER DEFAULT 0,
  answers_marked_helpful INTEGER DEFAULT 0,
  
  -- Computed score (updated by evolution job)
  expertise_score REAL DEFAULT 0,
  
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id, user_id, topic)
);

CREATE INDEX idx_expertise_workspace_topic ON expertise_signals(workspace_id, topic, expertise_score DESC);
```

### 4.2 Schema Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY DATA MODEL                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  workspaces                                                 │
│      │                                                      │
│      ├── memos                                              │
│      │     │                                                │
│      │     ├── anchor_event_ids[] ──→ stream_events        │
│      │     ├── context_stream_id ───→ streams              │
│      │     └── primary_answerer_id → users                 │
│      │                                                      │
│      ├── retrieval_log                                      │
│      │     │                                                │
│      │     ├── retrieved_memo_ids[] → memos                │
│      │     ├── retrieved_event_ids[] → stream_events       │
│      │     └── response_event_id ───→ stream_events        │
│      │                                                      │
│      ├── expertise_signals                                  │
│      │     └── user_id ─────────────→ users                │
│      │                                                      │
│      └── streams                                            │
│            └── stream_events                                │
│                  └── text_messages (+ contextual_header)   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Processing Pipeline

### 5.1 Message Ingestion

```typescript
// In StreamService.createEvent()

async createEvent(streamId: string, content: CreateEventInput): Promise<StreamEvent> {
  return this.pool.transaction(async (tx) => {
    // Existing: create event and message
    const event = await this.insertEvent(tx, streamId, content);
    
    // New: queue for memory processing
    await this.queueMemoryProcessing(tx, event);
    
    return event;
  });
}

private async queueMemoryProcessing(tx: Transaction, event: StreamEvent) {
  // Structural pre-filter (synchronous, free)
  const dominated = this.structuralFilter(event);
  
  if (!dominated.dominated) {
    // Queue for basic embedding
    await this.boss.send('memory.embed', {
      eventId: event.id,
      priority: 'normal'
    });
  }
}

private structuralFilter(event: StreamEvent): { pass: boolean; score: number } {
  let score = 0;
  const content = event.content;
  
  // Skip trivial messages
  if (content.length < 20) return { pass: false, score: 0 };
  if (/^(thanks|ok|lol|👍|🎉)+$/i.test(content)) return { pass: false, score: 0 };
  
  // Score valuable signals
  if (content.length > 200) score += 1;
  if (/```/.test(content)) score += 2;  // Code block
  if (/^[\d\-\*]/.test(content)) score += 1;  // List
  if (/https?:\/\//.test(content)) score += 1;  // Link
  if (/\?/.test(content)) score += 1;  // Question
  
  return { pass: score >= 1, score };
}
```

### 5.2 Tiered Enrichment

```typescript
// Worker: memory.embed
class EmbeddingWorker {
  async process(job: Job<{ eventId: string }>) {
    const event = await this.getEvent(job.data.eventId);
    if (!event) return;
    
    // Basic embedding (Tier 1)
    const embedding = await this.embedder.embed(event.content);
    await this.storeEmbedding(event.id, embedding);
    
    // Mark as Tier 1
    await this.updateEnrichmentTier(event.id, 1);
  }
}

// Worker: memory.enrich (triggered by signals)
class EnrichmentWorker {
  async process(job: Job<{ eventId: string; signals: EnrichmentSignals }>) {
    const event = await this.getEvent(job.data.eventId);
    if (!event || event.enrichmentTier >= 2) return;
    
    // Check budget
    if (!await this.budgetService.canEnrich(event.workspaceId)) {
      return; // Graceful skip
    }
    
    // Generate contextual header (Tier 2)
    const header = await this.generateContextualHeader(event);
    
    // Re-embed with context
    const enrichedContent = `${header}\n\n${event.content}`;
    const embedding = await this.embedder.embed(enrichedContent);
    
    // Update
    await this.pool.query(`
      UPDATE text_messages 
      SET contextual_header = $1,
          header_generated_at = NOW(),
          enrichment_tier = 2,
          enrichment_signals = $2
      WHERE id = $3
    `, [header, job.data.signals, event.id]);
    
    await this.updateEmbedding(event.id, embedding);
  }
  
  private async generateContextualHeader(event: StreamEvent): Promise<string> {
    // Get surrounding context
    const context = await this.getContextWindow(event, { before: 5, after: 2 });
    
    const prompt = `
      Generate a brief contextual header for this message that captures:
      - The channel/stream it's in
      - What the conversation is about
      - Who is participating and their apparent roles
      - Any relevant temporal context
      
      Keep it under 100 words. Be factual, not interpretive.
      
      Conversation context:
      ${context.map(e => `${e.author}: ${e.content}`).join('\n')}
      
      Target message:
      ${event.author}: ${event.content}
    `;
    
    return this.llm.complete(prompt, { model: 'haiku', maxTokens: 150 });
  }
}
```

### 5.3 Signal-Based Enrichment Triggers

```typescript
// In StreamService - when reactions are added
async addReaction(eventId: string, userId: string, emoji: string) {
  await this.pool.query(/* insert reaction */);
  
  // Check if this triggers enrichment
  const reactionCount = await this.getReactionCount(eventId);
  if (reactionCount >= 2) {
    await this.queueEnrichmentIfNeeded(eventId, { reactions: reactionCount });
  }
}

// In StreamService - when replies are added
async createEvent(streamId: string, content: CreateEventInput) {
  const event = await /* create event */;
  
  // If this is a reply, check parent
  if (content.replyToEventId) {
    const replyCount = await this.getReplyCount(content.replyToEventId);
    if (replyCount >= 2) {
      await this.queueEnrichmentIfNeeded(content.replyToEventId, { replies: replyCount });
    }
  }
}

// In AriadneService - when message is retrieved
async recordRetrieval(eventIds: string[], helpful: boolean) {
  for (const eventId of eventIds) {
    await this.queueEnrichmentIfNeeded(eventId, { retrieved: true, helpful });
  }
}

private async queueEnrichmentIfNeeded(eventId: string, signals: EnrichmentSignals) {
  const event = await this.getEvent(eventId);
  if (event.enrichmentTier >= 2) return; // Already enriched
  
  // Merge with existing signals
  const existingSignals = event.enrichmentSignals || {};
  const mergedSignals = { ...existingSignals, ...signals };
  
  // Queue enrichment
  await this.boss.send('memory.enrich', {
    eventId,
    signals: mergedSignals
  });
}
```

### 5.4 Memo Creation

```typescript
class MemoService {
  // User-triggered memo creation
  async createFromUserAction(
    userId: string,
    anchorEventId: string,
    summary?: string
  ): Promise<Memo> {
    const event = await this.getEvent(anchorEventId);
    const context = await this.getContextWindow(event, { before: 10, after: 5 });
    
    // Generate summary if not provided
    const memoSummary = summary || await this.generateSummary(event, context);
    
    // Extract topics
    const topics = await this.extractTopics(event, context);
    
    // Identify primary answerer (if Q&A pattern)
    const answerer = this.identifyAnswerer(context);
    
    return this.pool.query(`
      INSERT INTO memos (
        workspace_id, summary, topics,
        anchor_event_ids, context_stream_id,
        context_start_event_id, context_end_event_id,
        participant_ids, primary_answerer_id,
        confidence, source, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'user', $11)
      RETURNING *
    `, [
      event.workspaceId,
      memoSummary,
      topics,
      [anchorEventId],
      event.streamId,
      context[0].id,
      context[context.length - 1].id,
      [...new Set(context.map(e => e.actorId))],
      answerer?.id,
      0.9,  // High confidence for user-created
      userId
    ]);
  }
  
  // System-triggered memo creation (from successful Ariadne answers)
  async createFromAriadneSuccess(
    query: string,
    citedEventIds: string[],
    responseEventId: string
  ): Promise<Memo> {
    if (citedEventIds.length === 0) return null;
    
    const primaryEvent = await this.getEvent(citedEventIds[0]);
    const context = await this.getContextWindow(primaryEvent, { before: 5, after: 5 });
    
    // Use the question as the summary
    const summary = query;
    const topics = await this.extractTopics(primaryEvent, context);
    
    return this.pool.query(`
      INSERT INTO memos (
        workspace_id, summary, topics,
        anchor_event_ids, context_stream_id,
        context_start_event_id, context_end_event_id,
        participant_ids,
        confidence, source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ariadne')
      RETURNING *
    `, [
      primaryEvent.workspaceId,
      summary,
      topics,
      citedEventIds,
      primaryEvent.streamId,
      context[0].id,
      context[context.length - 1].id,
      [...new Set(context.map(e => e.actorId))],
      0.6  // Moderate confidence for auto-created
    ]);
  }
}
```

---

## 6. Ariadne: Iterative Researcher

### 6.1 Enhanced Agent Architecture

```typescript
interface AriadneConfig {
  maxIterations: number;      // Default: 3
  confidenceThreshold: number; // Default: 0.8
  maxRetrievedMemos: number;  // Default: 5
  maxRetrievedEvents: number; // Default: 10
}

class AriadneResearcher {
  private config: AriadneConfig = {
    maxIterations: 3,
    confidenceThreshold: 0.8,
    maxRetrievedMemos: 5,
    maxRetrievedEvents: 10
  };
  
  async respond(question: string, streamContext: StreamContext): Promise<AriadneResponse> {
    // Step 1: Quick memo lookup (might short-circuit)
    const quickResult = await this.quickMemoLookup(question);
    if (quickResult.confidence > 0.9) {
      return this.synthesizeFromMemos(question, quickResult.memos);
    }
    
    // Step 2: Full iterative research
    return this.iterativeResearch(question, streamContext);
  }
  
  private async iterativeResearch(
    question: string,
    streamContext: StreamContext
  ): Promise<AriadneResponse> {
    let iteration = 0;
    let gatheredContext: GatheredContext = {
      memos: [],
      events: [],
      confidence: 0
    };
    
    while (iteration < this.config.maxIterations) {
      iteration++;
      
      // PLAN: What information do we need?
      const plan = await this.planInformationNeeds(question, gatheredContext);
      
      if (plan.sufficient) {
        break; // We have enough
      }
      
      // SEARCH: Execute search plan
      const searchResults = await this.executeSearchPlan(plan);
      
      // INTEGRATE: Merge new results
      gatheredContext = this.integrateResults(gatheredContext, searchResults);
      
      // REFLECT: Assess confidence
      const reflection = await this.reflect(question, gatheredContext);
      gatheredContext.confidence = reflection.confidence;
      
      if (reflection.confidence >= this.config.confidenceThreshold) {
        break;
      }
    }
    
    // Log retrieval for evolution
    await this.logRetrieval(question, gatheredContext, iteration);
    
    // Synthesize final answer
    return this.synthesize(question, gatheredContext);
  }
  
  private async planInformationNeeds(
    question: string,
    currentContext: GatheredContext
  ): Promise<SearchPlan> {
    const prompt = `
      Question: ${question}
      
      Information gathered so far:
      ${this.formatGatheredContext(currentContext)}
      
      What additional information is needed to fully answer this question?
      If the current information is sufficient, say "SUFFICIENT".
      Otherwise, provide search queries to find missing information.
      
      Output JSON:
      {
        "sufficient": boolean,
        "missing": ["what's still needed"],
        "searches": [
          {"type": "memo", "query": "..."},
          {"type": "message", "query": "...", "filters": {...}}
        ]
      }
    `;
    
    return this.llm.complete(prompt, { 
      model: 'sonnet',
      responseFormat: 'json'
    });
  }
  
  private async executeSearchPlan(plan: SearchPlan): Promise<SearchResults> {
    const results: SearchResults = { memos: [], events: [] };
    
    for (const search of plan.searches) {
      if (search.type === 'memo') {
        const memos = await this.memoryService.searchMemos(search.query);
        results.memos.push(...memos);
      } else if (search.type === 'message') {
        const events = await this.searchService.hybridSearch(search.query, search.filters);
        results.events.push(...events);
      }
    }
    
    return results;
  }
  
  private async reflect(
    question: string,
    context: GatheredContext
  ): Promise<Reflection> {
    const prompt = `
      Question: ${question}
      
      Gathered information:
      ${this.formatGatheredContext(context)}
      
      Assess:
      1. How confident are you (0-1) that this information can answer the question?
      2. What's missing, if anything?
      3. What refined searches might help?
      
      Output JSON:
      {
        "confidence": 0.X,
        "assessment": "...",
        "missing": ["..."],
        "refinedQueries": ["..."]
      }
    `;
    
    return this.llm.complete(prompt, {
      model: 'sonnet',
      responseFormat: 'json'
    });
  }
  
  private async synthesize(
    question: string,
    context: GatheredContext
  ): Promise<AriadneResponse> {
    // Fetch full content for cited events
    const eventContents = await this.fetchEventContents(context.events);
    
    const prompt = `
      Answer this question based on the workspace conversations below.
      Cite specific messages using [1], [2] etc.
      If you're not confident, say so.
      
      Question: ${question}
      
      Relevant conversations:
      ${eventContents.map((e, i) => `[${i + 1}] ${e.author} in #${e.channel}: ${e.content}`).join('\n\n')}
    `;
    
    const answer = await this.llm.complete(prompt, { model: 'sonnet' });
    
    return {
      content: answer,
      citations: context.events.map(e => e.id),
      confidence: context.confidence,
      iterations: context.iterations,
      memoHits: context.memos.map(m => m.id)
    };
  }
}
```

### 6.2 Updated Tool Definitions

```typescript
const ariadneTools = [
  // Existing tools (enhanced)
  {
    name: 'search_messages',
    description: 'Search past conversations. Returns messages with context.',
    parameters: {
      query: { type: 'string', description: 'Search query' },
      filters: {
        from: { type: 'string', description: 'Filter by author username' },
        in: { type: 'string', description: 'Filter by channel slug' },
        before: { type: 'string', description: 'Before date (YYYY-MM-DD)' },
        after: { type: 'string', description: 'After date (YYYY-MM-DD)' },
        hasCode: { type: 'boolean', description: 'Must contain code' }
      }
    }
  },
  
  // New tools
  {
    name: 'search_memos',
    description: 'Search the knowledge index for documented topics and Q&A patterns.',
    parameters: {
      query: { type: 'string', description: 'What are you looking for?' },
      topics: { type: 'array', items: { type: 'string' }, description: 'Filter by topic tags' }
    }
  },
  {
    name: 'get_conversation_context',
    description: 'Get the full conversation around a specific message.',
    parameters: {
      eventId: { type: 'string', description: 'The message ID' },
      beforeCount: { type: 'number', description: 'Messages before (default 10)' },
      afterCount: { type: 'number', description: 'Messages after (default 5)' }
    }
  },
  {
    name: 'find_expert',
    description: 'Find who in the workspace knows about a topic.',
    parameters: {
      topic: { type: 'string', description: 'The topic to find expertise in' }
    }
  },
  {
    name: 'plan_research',
    description: 'Break down a complex question into sub-queries.',
    parameters: {
      question: { type: 'string', description: 'The complex question' }
    }
  }
];
```

### 6.3 Confidence-Gated Iteration

```typescript
class AriadneService {
  async respond(question: string, context: StreamContext): Promise<void> {
    // Classify question complexity (free, local SLM)
    const complexity = await this.classifyComplexity(question);
    
    if (complexity === 'simple') {
      // Single-shot for simple questions
      const result = await this.singleShotAnswer(question, context);
      await this.postResponse(result, context);
      return;
    }
    
    // Iterative for complex questions
    const result = await this.researcher.iterativeResearch(question, context);
    await this.postResponse(result, context);
    
    // If successful, create memo for future
    if (result.confidence > 0.7 && result.citations.length > 0) {
      await this.memoService.createFromAriadneSuccess(
        question,
        result.citations,
        result.responseEventId
      );
    }
  }
  
  private async classifyComplexity(question: string): Promise<'simple' | 'complex'> {
    // Quick heuristics first
    if (question.split(' ').length < 8) return 'simple';
    if (!/\b(and|or|compare|vs|difference|how did|why did|what were)\b/i.test(question)) {
      return 'simple';
    }
    
    // SLM classification for edge cases
    return this.slm.classify(question, ['simple', 'complex']);
  }
}
```

---

## 7. User-Facing Features

### 7.1 Related Conversations Panel

Shows contextually relevant discussions in the sidebar when viewing a thread.

```typescript
// API: GET /api/workspace/:ws/streams/:stream/events/:event/related
interface RelatedConversationsResponse {
  memos: Array<{
    id: string;
    summary: string;
    relevanceScore: number;
    anchorEvent: {
      id: string;
      content: string;
      author: User;
      stream: Stream;
      createdAt: string;
    };
  }>;
  recentDiscussions: Array<{
    streamId: string;
    streamName: string;
    previewContent: string;
    participants: User[];
    relevanceScore: number;
  }>;
}

// Backend
class RelatedService {
  async getRelatedConversations(eventId: string, limit = 5): Promise<RelatedConversationsResponse> {
    const event = await this.getEvent(eventId);
    
    // Get embedding for current context
    const contextEmbedding = await this.getContextEmbedding(event);
    
    // Search memos
    const memos = await this.pool.query(`
      SELECT m.*, 
             1 - (m.embedding <=> $1) as relevance_score
      FROM memos m
      WHERE m.workspace_id = $2
        AND m.archived_at IS NULL
        AND m.id NOT IN (
          SELECT id FROM memos WHERE $3 = ANY(anchor_event_ids)
        )
      ORDER BY relevance_score DESC
      LIMIT $4
    `, [contextEmbedding, event.workspaceId, eventId, limit]);
    
    // Get recent discussions in related topics
    const topics = await this.extractTopics(event);
    const recentDiscussions = await this.getRecentDiscussionsByTopic(
      event.workspaceId,
      topics,
      limit
    );
    
    return { memos, recentDiscussions };
  }
}
```

**Frontend Component:**

```tsx
// RelatedConversationsPanel.tsx
function RelatedConversationsPanel({ eventId }: { eventId: string }) {
  const { data, isLoading } = useRelatedConversations(eventId);
  
  if (isLoading || !data?.memos.length) return null;
  
  return (
    <div className="border-l border-gray-200 p-4 w-72">
      <h3 className="text-sm font-medium text-gray-500 mb-3">
        Related discussions
      </h3>
      
      <div className="space-y-3">
        {data.memos.map(memo => (
          <button
            key={memo.id}
            onClick={() => navigateToEvent(memo.anchorEvent.id)}
            className="block w-full text-left p-2 rounded hover:bg-gray-50"
          >
            <div className="text-sm font-medium text-gray-900 line-clamp-2">
              {memo.summary}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              #{memo.anchorEvent.stream.slug} · {formatRelativeTime(memo.anchorEvent.createdAt)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

### 7.2 Knowledge Browser

A dedicated view for browsing institutional knowledge.

```typescript
// API: GET /api/workspace/:ws/knowledge
interface KnowledgeBrowserResponse {
  frequentlyReferenced: Memo[];
  recentValuable: Memo[];
  byTopic: Record<string, Memo[]>;
  coverageGaps: Array<{
    query: string;
    askCount: number;
    lastAsked: string;
  }>;
  topExperts: Array<{
    user: User;
    topics: string[];
    score: number;
  }>;
}

// API: GET /api/workspace/:ws/knowledge/topics
interface TopicsResponse {
  topics: Array<{
    name: string;
    memoCount: number;
    recentActivity: string;
  }>;
}
```

**Frontend Component:**

```tsx
// KnowledgeBrowser.tsx
function KnowledgeBrowser() {
  const { data } = useKnowledge();
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  
  return (
    <div className="flex h-full">
      {/* Sidebar: Topics */}
      <div className="w-64 border-r p-4">
        <SearchInput 
          placeholder="Search knowledge..."
          onSearch={handleSearch}
        />
        
        <nav className="mt-4 space-y-1">
          <TopicLink 
            active={!selectedTopic}
            onClick={() => setSelectedTopic(null)}
          >
            All Knowledge
          </TopicLink>
          
          {data?.byTopic && Object.keys(data.byTopic).map(topic => (
            <TopicLink
              key={topic}
              active={selectedTopic === topic}
              onClick={() => setSelectedTopic(topic)}
            >
              {topic}
              <span className="text-gray-400 ml-2">
                {data.byTopic[topic].length}
              </span>
            </TopicLink>
          ))}
        </nav>
        
        {data?.coverageGaps.length > 0 && (
          <div className="mt-6">
            <h4 className="text-xs font-medium text-amber-600 uppercase">
              Coverage Gaps
            </h4>
            <div className="mt-2 space-y-2">
              {data.coverageGaps.map(gap => (
                <div key={gap.query} className="text-sm text-gray-600">
                  "{gap.query}"
                  <span className="text-gray-400 ml-1">
                    ({gap.askCount}x)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Main: Memo list */}
      <div className="flex-1 p-6">
        <MemoList 
          memos={selectedTopic ? data?.byTopic[selectedTopic] : data?.frequentlyReferenced}
          onMemoClick={handleMemoClick}
        />
      </div>
    </div>
  );
}
```

### 7.3 "Before You Ask" Suggestions

Shows relevant existing knowledge as user types a question.

```typescript
// API: POST /api/workspace/:ws/knowledge/suggest
interface SuggestRequest {
  partialQuery: string;
  streamId: string;
}

interface SuggestResponse {
  suggestions: Array<{
    memo: Memo;
    relevance: number;
    preview: string;
  }>;
}

// Backend - debounced, cached
class SuggestionService {
  private cache = new LRUCache<string, SuggestResponse>({ max: 1000, ttl: 60000 });
  
  async suggest(query: string, workspaceId: string): Promise<SuggestResponse> {
    // Skip short queries
    if (query.length < 10) return { suggestions: [] };
    
    // Check cache
    const cacheKey = `${workspaceId}:${query.toLowerCase().trim()}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    
    // Quick embedding lookup
    const queryEmbedding = await this.embedder.embed(query);
    
    const memos = await this.pool.query(`
      SELECT m.*, 
             1 - (m.embedding <=> $1) as relevance
      FROM memos m
      WHERE m.workspace_id = $2
        AND m.archived_at IS NULL
        AND m.confidence > 0.5
        AND 1 - (m.embedding <=> $1) > 0.7
      ORDER BY relevance DESC
      LIMIT 3
    `, [queryEmbedding, workspaceId]);
    
    const result = {
      suggestions: memos.rows.map(m => ({
        memo: m,
        relevance: m.relevance,
        preview: m.summary
      }))
    };
    
    this.cache.set(cacheKey, result);
    return result;
  }
}
```

**Frontend Integration:**

```tsx
// ChatInput.tsx (enhanced)
function ChatInput({ streamId }: { streamId: string }) {
  const [content, setContent] = useState('');
  const debouncedContent = useDebounce(content, 300);
  
  const { data: suggestions } = useSuggestions(debouncedContent, streamId, {
    enabled: content.includes('?') && content.length > 15
  });
  
  return (
    <div className="relative">
      {suggestions?.suggestions.length > 0 && (
        <div className="absolute bottom-full mb-2 w-full bg-white border rounded-lg shadow-lg p-3">
          <div className="text-xs text-gray-500 mb-2">
            Might be helpful:
          </div>
          {suggestions.suggestions.map(s => (
            <button
              key={s.memo.id}
              onClick={() => navigateToMemo(s.memo)}
              className="block w-full text-left p-2 rounded hover:bg-gray-50"
            >
              <div className="text-sm text-gray-900">
                {s.memo.summary}
              </div>
              <div className="text-xs text-gray-500">
                Click to view discussion
              </div>
            </button>
          ))}
        </div>
      )}
      
      <RichTextEditor
        value={content}
        onChange={setContent}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
```

### 7.4 Expert Discovery

Surface who knows what based on accumulated signals.

```typescript
// API: GET /api/workspace/:ws/experts
interface ExpertsResponse {
  byTopic: Record<string, Array<{
    user: User;
    score: number;
    recentContributions: number;
  }>>;
}

// API: GET /api/workspace/:ws/experts/for-topic/:topic
interface TopicExpertsResponse {
  experts: Array<{
    user: User;
    score: number;
    sampleAnswers: Array<{
      eventId: string;
      preview: string;
      helpful: boolean;
    }>;
  }>;
}
```

---

## 8. Evolution & Learning

### 8.1 Confidence Evolution

```typescript
// Scheduled job: runs nightly
class EvolutionJob {
  async evolve(workspaceId: string) {
    await this.boostRetrievedMemos(workspaceId);
    await this.decayUnusedMemos(workspaceId);
    await this.updateExpertiseScores(workspaceId);
    await this.detectCoverageGaps(workspaceId);
    await this.pruneStaleData(workspaceId);
  }
  
  private async boostRetrievedMemos(workspaceId: string) {
    // Boost memos that were retrieved and led to positive feedback
    await this.pool.query(`
      UPDATE memos m
      SET confidence = LEAST(confidence + 0.05, 1.0),
          helpfulness_score = helpfulness_score + 1,
          updated_at = NOW()
      FROM retrieval_log r
      WHERE m.workspace_id = $1
        AND m.id = ANY(r.retrieved_memo_ids)
        AND r.user_feedback = 'positive'
        AND r.created_at > NOW() - INTERVAL '24 hours'
    `, [workspaceId]);
    
    // Decay memos with negative feedback
    await this.pool.query(`
      UPDATE memos m
      SET confidence = GREATEST(confidence - 0.1, 0.1),
          helpfulness_score = helpfulness_score - 1,
          updated_at = NOW()
      FROM retrieval_log r
      WHERE m.workspace_id = $1
        AND m.id = ANY(r.retrieved_memo_ids)
        AND r.user_feedback = 'negative'
        AND r.created_at > NOW() - INTERVAL '24 hours'
    `, [workspaceId]);
  }
  
  private async decayUnusedMemos(workspaceId: string) {
    // Slowly decay confidence of never-retrieved memos
    await this.pool.query(`
      UPDATE memos
      SET confidence = GREATEST(confidence - 0.01, 0.1),
          updated_at = NOW()
      WHERE workspace_id = $1
        AND (last_retrieved_at IS NULL OR last_retrieved_at < NOW() - INTERVAL '90 days')
        AND confidence > 0.1
        AND source = 'system'  -- Don't decay user-created
    `, [workspaceId]);
  }
  
  private async updateExpertiseScores(workspaceId: string) {
    // Recalculate expertise scores from signals
    await this.pool.query(`
      UPDATE expertise_signals
      SET expertise_score = (
        questions_answered * 1.0 +
        answers_cited_by_ariadne * 3.0 +
        positive_reactions_received * 0.5 +
        answers_marked_helpful * 5.0
      ) / GREATEST(
        EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400 / 30,  -- Decay over months
        1
      ),
      updated_at = NOW()
      WHERE workspace_id = $1
    `, [workspaceId]);
  }
  
  private async detectCoverageGaps(workspaceId: string) {
    // Find queries with low confidence or no results
    const gaps = await this.pool.query(`
      SELECT 
        query,
        COUNT(*) as ask_count,
        MAX(created_at) as last_asked
      FROM retrieval_log
      WHERE workspace_id = $1
        AND (
          array_length(retrieved_memo_ids, 1) IS NULL 
          OR array_length(retrieved_memo_ids, 1) = 0
        )
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY query
      HAVING COUNT(*) >= 2
      ORDER BY ask_count DESC
      LIMIT 20
    `, [workspaceId]);
    
    // Store for admin visibility
    await this.storeCoverageGaps(workspaceId, gaps.rows);
  }
  
  private async pruneStaleData(workspaceId: string) {
    // Archive very low confidence system memos
    await this.pool.query(`
      UPDATE memos
      SET archived_at = NOW()
      WHERE workspace_id = $1
        AND source = 'system'
        AND confidence < 0.2
        AND last_retrieved_at < NOW() - INTERVAL '180 days'
    `, [workspaceId]);
    
    // Clean old retrieval logs (keep 90 days)
    await this.pool.query(`
      DELETE FROM retrieval_log
      WHERE workspace_id = $1
        AND created_at < NOW() - INTERVAL '90 days'
    `, [workspaceId]);
  }
}
```

### 8.2 Auto-Memo from Successful Answers

```typescript
// In AriadneService, after successful response
async onSuccessfulResponse(
  question: string,
  citations: string[],
  responseEventId: string,
  feedback?: 'positive' | 'negative'
) {
  // Only create memo for positive or high-confidence responses
  if (feedback === 'negative') return;
  if (citations.length === 0) return;
  
  // Check if similar memo already exists
  const existing = await this.findSimilarMemo(question);
  if (existing && existing.relevance > 0.9) {
    // Boost existing memo instead
    await this.boostMemo(existing.id);
    return;
  }
  
  // Create new memo
  await this.memoService.createFromAriadneSuccess(question, citations, responseEventId);
}
```

### 8.3 Expertise Signal Accumulation

```typescript
// In StreamService, when events are created
async onEventCreated(event: StreamEvent) {
  // Check if this looks like an answer to a question
  if (!event.replyToEventId) return;
  
  const parent = await this.getEvent(event.replyToEventId);
  if (!this.looksLikeQuestion(parent.content)) return;
  
  // Extract topics from the thread
  const topics = await this.extractTopics([parent, event]);
  
  // Record expertise signal
  for (const topic of topics) {
    await this.pool.query(`
      INSERT INTO expertise_signals (workspace_id, user_id, topic, questions_answered)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (workspace_id, user_id, topic)
      DO UPDATE SET 
        questions_answered = expertise_signals.questions_answered + 1,
        updated_at = NOW()
    `, [event.workspaceId, event.actorId, topic]);
  }
}

// In AriadneService, when citing a message
async onMessageCited(eventId: string, topic: string) {
  const event = await this.getEvent(eventId);
  
  await this.pool.query(`
    INSERT INTO expertise_signals (workspace_id, user_id, topic, answers_cited_by_ariadne)
    VALUES ($1, $2, $3, 1)
    ON CONFLICT (workspace_id, user_id, topic)
    DO UPDATE SET 
      answers_cited_by_ariadne = expertise_signals.answers_cited_by_ariadne + 1,
      updated_at = NOW()
  `, [event.workspaceId, event.actorId, topic]);
}
```

---

## 9. Cost Management

### 9.1 Budget Tracking

```typescript
interface WorkspaceMemoryBudget {
  workspaceId: string;
  
  // Monthly limits
  monthlyEmbeddingLimit: number;      // Default: 10,000
  monthlyEnrichmentLimit: number;     // Default: 500
  monthlyAriadneQueryLimit: number;   // Default: 1,000
  monthlyIterationLimit: number;      // Default: 300
  
  // Current usage (reset monthly)
  embeddingsUsed: number;
  enrichmentsUsed: number;
  ariadneQueriesUsed: number;
  iterationsUsed: number;
  
  // Cost tracking
  currentMonthCostCents: number;
  budgetLimitCents: number;           // Default: 10000 ($100)
}

class BudgetService {
  async canEmbed(workspaceId: string): Promise<boolean> {
    const budget = await this.getBudget(workspaceId);
    return budget.embeddingsUsed < budget.monthlyEmbeddingLimit;
  }
  
  async canEnrich(workspaceId: string): Promise<boolean> {
    const budget = await this.getBudget(workspaceId);
    if (budget.enrichmentsUsed >= budget.monthlyEnrichmentLimit) return false;
    if (budget.currentMonthCostCents >= budget.budgetLimitCents) return false;
    return true;
  }
  
  async canIterate(workspaceId: string): Promise<boolean> {
    const budget = await this.getBudget(workspaceId);
    return budget.iterationsUsed < budget.monthlyIterationLimit;
  }
  
  async recordUsage(workspaceId: string, type: UsageType, costCents: number) {
    await this.pool.query(`
      UPDATE workspace_memory_budgets
      SET ${type}_used = ${type}_used + 1,
          current_month_cost_cents = current_month_cost_cents + $1
      WHERE workspace_id = $2
    `, [costCents, workspaceId]);
  }
}
```

### 9.2 Adaptive Enrichment Thresholds

```typescript
class AdaptiveEnrichmentService {
  async shouldEnrich(event: StreamEvent, signals: EnrichmentSignals): Promise<boolean> {
    const budget = await this.budgetService.getBudget(event.workspaceId);
    
    // Calculate remaining budget ratio
    const daysLeft = this.daysRemainingInMonth();
    const remainingBudgetRatio = (budget.monthlyEnrichmentLimit - budget.enrichmentsUsed) / 
                                  (budget.monthlyEnrichmentLimit * (daysLeft / 30));
    
    // Adjust thresholds based on budget
    let reactionThreshold = 2;
    let replyThreshold = 3;
    
    if (remainingBudgetRatio < 0.5) {
      // Budget tight - raise thresholds
      reactionThreshold = 4;
      replyThreshold = 5;
    } else if (remainingBudgetRatio > 1.5) {
      // Budget loose - lower thresholds
      reactionThreshold = 1;
      replyThreshold = 2;
    }
    
    return (signals.reactions || 0) >= reactionThreshold ||
           (signals.replies || 0) >= replyThreshold ||
           signals.retrieved === true;
  }
}
```

### 9.3 Cost Projections

| Operation | Unit Cost | 50-person workspace/month |
|-----------|-----------|---------------------------|
| Basic embeddings | $0.004 | 3,000 msgs × $0.004 = $12 |
| Contextual headers | $0.025 | 150 msgs × $0.025 = $3.75 |
| Ariadne single-shot | $0.02 | 400 queries × $0.02 = $8 |
| Ariadne iterative | $0.06 | 100 queries × $0.06 = $6 |
| **Total** | | **~$30/month** |

At $500/month revenue (50 users × $10), this is **6% of revenue** on AI costs.

---

## 10. Implementation Phases

### Phase 1: Enhanced Page Store (Week 1-2)

**Goal**: Better embeddings without changing user experience.

- [ ] Add `contextual_header` column to `text_messages`
- [ ] Implement `EnrichmentService` with header generation
- [ ] Add signal-based enrichment triggers (reactions, replies)
- [ ] Create `memory.enrich` worker
- [ ] Backfill high-value messages (reactions > 2)

**Validation**: Search result quality improves (measure click-through on search results)

### Phase 2: Memo System (Week 3-4)

**Goal**: Lightweight pointers to valuable conversations.

- [ ] Create `memos` table
- [ ] Implement `MemoService` with create/search/update
- [ ] Add "Save as knowledge" button to message actions
- [ ] Migrate existing `knowledge` entries to memos
- [ ] Update Ariadne to search memos first

**Validation**: Ariadne response time improves for repeat questions

### Phase 3: Iterative Researcher (Week 5-6)

**Goal**: Better answers for complex questions.

- [ ] Implement `AriadneResearcher` with plan/search/reflect loop
- [ ] Add complexity classification (simple vs complex)
- [ ] Create `retrieval_log` table
- [ ] Implement confidence-gated iteration
- [ ] Auto-create memos from successful answers

**Validation**: Answer quality improves on multi-hop questions (manual evaluation)

### Phase 4: User-Facing Features (Week 7-8)

**Goal**: Expose memory layer to humans.

- [ ] Related Conversations panel
- [ ] Knowledge Browser view
- [ ] "Before you ask" suggestions
- [ ] Expert Discovery

**Validation**: % of questions answered via browse (no AI invocation)

### Phase 5: Evolution Loop (Week 9-10)

**Goal**: System improves over time.

- [ ] Implement nightly evolution job
- [ ] Confidence boost/decay
- [ ] Expertise signal accumulation
- [ ] Coverage gap detection
- [ ] Admin dashboard for gaps/experts

**Validation**: Memo confidence distribution improves over 30 days

---

## 11. API Reference

### 11.1 Memory APIs

```
# Memos
GET    /api/workspace/:ws/memos                    # List memos
POST   /api/workspace/:ws/memos                    # Create memo
GET    /api/workspace/:ws/memos/:id                # Get memo
PATCH  /api/workspace/:ws/memos/:id                # Update memo
DELETE /api/workspace/:ws/memos/:id                # Archive memo

# Knowledge Browser
GET    /api/workspace/:ws/knowledge                # Knowledge overview
GET    /api/workspace/:ws/knowledge/topics         # List topics
GET    /api/workspace/:ws/knowledge/gaps           # Coverage gaps
GET    /api/workspace/:ws/knowledge/suggest        # Before-you-ask suggestions

# Experts
GET    /api/workspace/:ws/experts                  # All experts by topic
GET    /api/workspace/:ws/experts/topic/:topic     # Experts for topic

# Related
GET    /api/workspace/:ws/streams/:s/events/:e/related  # Related conversations
```

### 11.2 WebSocket Events

```typescript
// New events for real-time updates
interface MemoryEvents {
  'memo:created': { memo: Memo };
  'memo:updated': { memoId: string; changes: Partial<Memo> };
  'memo:archived': { memoId: string };
  'suggestion:available': { suggestions: Suggestion[] };  // For before-you-ask
}
```

---

## 12. Migration Strategy

### 12.1 Knowledge Table Migration

```sql
-- Migrate existing knowledge entries to memos
INSERT INTO memos (
  workspace_id,
  summary,
  topics,
  anchor_event_ids,
  context_stream_id,
  confidence,
  source,
  created_by,
  created_at
)
SELECT 
  k.workspace_id,
  k.title as summary,
  k.tags as topics,
  ARRAY[k.anchor_event_id] as anchor_event_ids,
  k.stream_id as context_stream_id,
  0.8 as confidence,  -- Existing knowledge is high-value
  'user' as source,
  k.created_by,
  k.created_at
FROM knowledge k
WHERE k.archived_at IS NULL;

-- Keep knowledge table for rollback, drop after 30 days
ALTER TABLE knowledge RENAME TO knowledge_deprecated;
```

### 12.2 Embedding Backfill

```typescript
// Background job to enrich high-value historical messages
async backfillEnrichment(workspaceId: string) {
  // Find messages with reactions but no contextual header
  const candidates = await this.pool.query(`
    SELECT tm.id
    FROM text_messages tm
    JOIN stream_events se ON se.content_id = tm.id
    WHERE se.workspace_id = $1
      AND tm.contextual_header IS NULL
      AND (
        -- Has reactions
        EXISTS (
          SELECT 1 FROM reactions r WHERE r.event_id = se.id
        )
        -- Or has replies
        OR EXISTS (
          SELECT 1 FROM stream_events child 
          WHERE child.reply_to_event_id = se.id
        )
      )
    ORDER BY se.created_at DESC
    LIMIT 1000
  `, [workspaceId]);
  
  // Queue for enrichment in batches
  for (const batch of chunk(candidates.rows, 50)) {
    await this.boss.send('memory.backfill-enrich', {
      eventIds: batch.map(c => c.id)
    });
  }
}
```

### 12.3 Feature Flags

```typescript
const memoryFeatureFlags = {
  // Rollout phases
  'memory.contextual-headers': false,      // Phase 1
  'memory.memos': false,                   // Phase 2
  'memory.iterative-researcher': false,    // Phase 3
  'memory.user-features': false,           // Phase 4
  'memory.evolution': false,               // Phase 5
  
  // Gradual rollout
  'memory.before-you-ask': false,          // Most visible, last to enable
};
```

---

## Appendix A: Prompt Templates

### A.1 Contextual Header Generation

```
Generate a brief contextual header for this message. Include:
- The channel and what it's typically used for
- What this conversation is about
- Who is participating and their apparent expertise
- Relevant temporal context (if discussing events, timelines)

Keep it under 100 words. Be factual, not interpretive.

Channel: #{{channel_name}}
{{#if channel_description}}
Channel purpose: {{channel_description}}
{{/if}}

Conversation ({{message_count}} messages):
{{#each messages}}
{{this.author}}: {{this.content}}
{{/each}}

Target message to contextualize:
{{target.author}}: {{target.content}}
```

### A.2 Memo Summary Generation

```
Create a concise summary (1-2 sentences) of what someone would learn from this conversation.
Write it as a question-answer or topic description that would help someone find this later.

Examples:
- "How to deploy to production using the CI pipeline"
- "Why we chose PostgreSQL over MongoDB for the main database"
- "Troubleshooting guide for authentication errors"

Conversation:
{{#each messages}}
{{this.author}}: {{this.content}}
{{/each}}
```

### A.3 Research Planning

```
Question: {{question}}

Information gathered so far:
{{#if gathered_context}}
{{#each gathered_context}}
- {{this.summary}} (confidence: {{this.confidence}})
{{/each}}
{{else}}
(none yet)
{{/if}}

Determine what additional information is needed to fully answer this question.

Output JSON:
{
  "sufficient": boolean,
  "reasoning": "why sufficient or not",
  "missing": ["specific information still needed"],
  "searches": [
    {"type": "memo", "query": "search query for memos"},
    {"type": "message", "query": "search query for messages", "filters": {"in": "#channel"}}
  ]
}
```

---

## Appendix B: Metrics & Monitoring

### B.1 Key Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Memo retrieval hit rate | >60% | <40% |
| Avg iterations per query | <1.5 | >2.5 |
| Before-you-ask click rate | >20% | <10% |
| Enrichment budget utilization | 70-90% | >95% or <50% |
| Nightly evolution job duration | <5min | >15min |

### B.2 Dashboard Queries

```sql
-- Memo effectiveness
SELECT 
  date_trunc('day', created_at) as day,
  COUNT(*) as queries,
  AVG(array_length(retrieved_memo_ids, 1)) as avg_memos_retrieved,
  COUNT(*) FILTER (WHERE user_feedback = 'positive') as positive,
  COUNT(*) FILTER (WHERE user_feedback = 'negative') as negative
FROM retrieval_log
WHERE workspace_id = $1
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;

-- Enrichment funnel
SELECT
  COUNT(*) FILTER (WHERE enrichment_tier >= 1) as embedded,
  COUNT(*) FILTER (WHERE enrichment_tier >= 2) as enriched,
  COUNT(*) as total
FROM text_messages tm
JOIN stream_events se ON se.content_id = tm.id
WHERE se.workspace_id = $1
  AND se.created_at > NOW() - INTERVAL '30 days';
```

---

*End of specification*
