# Memo Evolution System Design

## Overview

The memo evolution system handles how memos are created, reinforced, updated, and eventually archived. It treats memos as **living memories** that strengthen with repeated exposure and weaken with time/contradiction.

## Core Principles

1. **Recency Bias** - Recent information weighs more than old
2. **Reinforcement Strengthens** - Repeated similar messages boost confidence
3. **Thread Awareness** - Threads are living conversations; memos should track their evolution
4. **Isolation** - This module is complex and will iterate; keep it cleanly separated

## Embedding Strategy

Different embeddings serve different purposes:

| Comparison Type | Source | Target | Purpose |
|-----------------|--------|--------|---------|
| **Dedup detection** | New event embedding | Anchor event embeddings | Find similar memos (apples to apples) |
| **Retrieval** | User query embedding | Memo embedding (summary+topics) | Answer questions semantically |
| **LLM verification** | New event content | Memo summary | Confirm same topic for borderline cases |

Key insight: Deduplication compares **event-to-event** embeddings (consistent), while retrieval uses **query-to-summary** (semantic matching).

## Thread & Message Watching

Threads in Threa are streams with `branchedFromEventId` pointing to the parent message.

**Watch strategy:**
1. When memo created from message X, watch for new streams where `branchedFromEventId = X`
2. When thread stream is created, subscribe to it for new events
3. New events in subscribed threads trigger re-evaluation

```
Message X (anchor event)
    │
    └── Thread created (branchedFromEventId = X)
            │
            ├── Reply 1 → evaluate: reinforce or new memo?
            ├── Reply 2 → evaluate: reinforce or new memo?
            └── Reply 3 → evaluate: reinforce or new memo?
```

## Data Model Changes

### New: `memo_reinforcements` table
```sql
CREATE TABLE memo_reinforcements (
  id TEXT PRIMARY KEY,
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES stream_events(id),

  -- Reinforcement metadata
  reinforcement_type TEXT NOT NULL, -- 'original' | 'merge' | 'thread_update'
  similarity_score REAL,            -- How similar was this to existing content
  llm_verified BOOLEAN DEFAULT FALSE,

  -- Recency tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  weight REAL DEFAULT 1.0,          -- Can decay over time

  UNIQUE(memo_id, event_id)
);
```

### New: `memo_thread_subscriptions` table
```sql
CREATE TABLE memo_thread_subscriptions (
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,

  -- Tracking
  last_evaluated_event_id TEXT,     -- Last event we processed
  last_evaluated_at TIMESTAMPTZ,

  PRIMARY KEY (memo_id, stream_id)
);
```

### Memo table additions
```sql
ALTER TABLE memos ADD COLUMN reinforcement_count INTEGER DEFAULT 1;
ALTER TABLE memos ADD COLUMN last_reinforced_at TIMESTAMPTZ;
ALTER TABLE memos ADD COLUMN decay_rate REAL DEFAULT 0.1; -- Per-month decay
```

## MemoEvolutionService

Located at: `src/server/services/memo-evolution-service.ts`

### Public API

```typescript
interface MemoEvolutionService {
  // Core evolution operations
  evaluateForEvolution(workspaceId: string, content: string, eventId: string): Promise<EvolutionDecision>
  reinforceMemo(memoId: string, eventId: string, similarity: number): Promise<void>

  // Thread watching
  subscribeToThread(memoId: string, streamId: string): Promise<void>
  processThreadUpdate(streamId: string, newEventId: string): Promise<void>

  // LLM verification
  verifySemanticEquivalence(newContent: string, existingSummary: string): Promise<LLMVerification>

  // Decay and maintenance
  applyRecencyDecay(): Promise<void>  // Run periodically
  calculateEffectiveStrength(memoId: string): Promise<number>
}

interface EvolutionDecision {
  action: 'create_new' | 'reinforce' | 'supersede' | 'skip'
  targetMemoId?: string
  confidence: number
  reasoning: string
  llmVerified: boolean
}

interface LLMVerification {
  isSameTopic: boolean
  relationship: 'identical' | 'same_topic' | 'related' | 'different'
  explanation: string
}
```

## Evolution Flow

```
New Message Arrives (has embedding in embeddings_768)
        │
        ▼
┌─────────────────────────────────────┐
│ Find Similar Anchor Events          │◄── Compare event-to-event embeddings
│ via Vector Search (threshold 0.65)  │    (apples to apples)
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│ Group by Memo                       │◄── anchor_event_ids → memo_id
│ (one anchor match = memo candidate) │
└───────────────┬─────────────────────┘
                │
         ┌──────┴──────┐
         │             │
         ▼             ▼
   No matches     Has matches
         │             │
         ▼             ▼
   CREATE_NEW    ┌─────────────────┐
                 │ Best similarity │
                 │ per memo        │
                 └────────┬────────┘
                          │
             ┌────────────┼────────────┐
             │            │            │
             ▼            ▼            ▼
         >0.85        0.65-0.85      <0.65
             │            │            │
             ▼            ▼            ▼
       REINFORCE    LLM Verify    CREATE_NEW
         or SKIP         │
                         ▼
                  ┌─────────────┐
                  │Same topic?  │◄── Compare new content vs memo summary
                  └──────┬──────┘
                         │
                  ┌──────┴──────┐
                  ▼             ▼
                YES            NO
                  │             │
                  ▼             ▼
             REINFORCE     CREATE_NEW
```

**SQL for finding similar anchor events:**
```sql
SELECT m.id as memo_id, e.id as event_id,
       1 - (emb.embedding <=> $new_embedding) as similarity
FROM memos m
CROSS JOIN UNNEST(m.anchor_event_ids) as anchor_id
INNER JOIN stream_events e ON e.id = anchor_id
INNER JOIN embeddings_768 emb ON emb.event_id = e.id
WHERE m.workspace_id = $workspace_id
  AND m.archived_at IS NULL
  AND 1 - (emb.embedding <=> $new_embedding) > 0.65
ORDER BY similarity DESC
LIMIT 10
```

## Recency-Weighted Strength

Effective memo strength is calculated as:

```typescript
function calculateEffectiveStrength(memo: Memo): number {
  const baseConfidence = memo.confidence

  // Sum reinforcement weights with recency decay
  const reinforcementBoost = memo.reinforcements.reduce((sum, r) => {
    const ageMonths = monthsSince(r.created_at)
    const decayedWeight = r.weight * Math.exp(-memo.decay_rate * ageMonths)
    return sum + decayedWeight * 0.05 // Each reinforcement adds up to 5%
  }, 0)

  // Recent activity bonus
  const daysSinceReinforced = daysSince(memo.last_reinforced_at)
  const recencyBonus = daysSinceReinforced < 7 ? 0.1 :
                       daysSinceReinforced < 30 ? 0.05 : 0

  return Math.min(1.0, baseConfidence + reinforcementBoost + recencyBonus)
}
```

## Thread Watching

When a memo is created from a thread:
1. Subscribe to that thread
2. When new messages arrive in thread, re-evaluate
3. Options:
   - Add as reinforcement (same topic continues)
   - Update summary (topic evolved)
   - Create new memo (conversation shifted topics)

```typescript
async function processThreadUpdate(streamId: string, newEventId: string) {
  // Find memos subscribed to this thread
  const subscriptions = await getThreadSubscriptions(streamId)

  for (const sub of subscriptions) {
    const memo = await getMemo(sub.memo_id)
    const newMessage = await getMessage(newEventId)

    // Check if new message relates to memo topic
    const verification = await verifySemanticEquivalence(
      newMessage.content,
      memo.summary
    )

    if (verification.isSameTopic) {
      // Reinforce the memo
      await reinforceMemo(memo.id, newEventId, verification.similarity)

      // Maybe update summary if content evolved
      if (verification.relationship === 'same_topic' && newMessage.hasSubstantialContent) {
        await maybeUpdateSummary(memo.id, newMessage)
      }
    } else {
      // Topic shifted - might need new memo
      await queueForMemoEvaluation(newEventId)
    }

    // Update subscription tracking
    await updateSubscription(sub, newEventId)
  }
}
```

## LLM Verification Prompt

```typescript
const EQUIVALENCE_PROMPT = `Compare these two pieces of content and determine if they're about the same topic.

EXISTING MEMO SUMMARY:
{existingSummary}

NEW MESSAGE:
{newContent}

Respond with JSON:
{
  "same_topic": boolean,
  "relationship": "identical" | "same_topic" | "related" | "different",
  "explanation": "brief reasoning"
}

Guidelines:
- "identical": Essentially the same information
- "same_topic": About the same subject, may add details
- "related": Connected but distinct aspects
- "different": Unrelated topics`
```

## Migration Path

1. **Phase 1**: Add `memo_reinforcements` table, start tracking
2. **Phase 2**: Add LLM verification for borderline cases
3. **Phase 3**: Add thread subscriptions and watching
4. **Phase 4**: Implement recency decay (background job)

## File Structure

```
src/server/services/
├── memo-evolution/
│   ├── index.ts                 # Main service export
│   ├── evolution-service.ts     # Core evolution logic
│   ├── similarity-checker.ts    # Embedding + LLM verification
│   ├── reinforcement-tracker.ts # Track reinforcements + decay
│   ├── thread-watcher.ts        # Thread subscription handling
│   └── types.ts                 # Shared types
```

## Open Questions

1. **Decay rate tuning** - How fast should old reinforcements decay?
2. **Thread depth limit** - How far back in a thread should we look?
3. **Summary update triggers** - When should we regenerate summaries?
4. **Clustering** - Future: group related memos into clusters?
