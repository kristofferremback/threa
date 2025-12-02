# Plan: GAM-Inspired Auto-Memo Creation System

## Overview

Automatically create memos (lightweight knowledge pointers) from messages that signal usefulness based on content classification, not just engagement metrics.

## Current State

- **Enrichment**: Working in eager mode - all messages get contextual headers
- **Classification**: `classification-worker.ts` has content signal patterns (announcements, explanations, decisions) but only classifies threads with 5+ messages
- **Memos**: `memo-service.ts` creates memos from:
  - User action ("Save as knowledge")
  - Ariadne success (when citations are helpful)
- **Job Queue**: `memory.create-memo` queue already defined but unused

## Requirements

From user:
- Auto-create memos from threads or **singular messages** that signal usefulness
- Score on **multiple criteria beyond engagement** (announcements may be important without reactions)
- Individual messages within threads may be important, not just whole threads
- **Knowledge revision** when new information overlaps existing (supersede/merge)
- Based on GAM (General Agentic Memory) paper

## Implementation Plan

### 1. Create Memo-Worthiness Scoring Service

**File**: `src/server/services/memo-scoring-service.ts`

Expand the classification worker's content signals into a comprehensive "memo-worthiness" score:

```typescript
interface MemoWorthinessScore {
  score: number           // 0-100
  shouldCreateMemo: boolean
  reasons: string[]
  suggestedSummary?: string
  suggestedTopics?: string[]
}

interface ScoringCriteria {
  // Content type signals (from classification-worker patterns)
  isAnnouncement: number     // +25 - company canon
  isExplanation: number      // +20 - teaching moment
  isDecision: number         // +20 - institutional knowledge

  // Structural signals
  hasCodeBlock: number       // +10 - technical knowledge
  hasListItems: number       // +10 - structured info
  hasLinks: number           // +5  - references
  substantialLength: number  // +10 - thorough content

  // Contextual signals
  isFirstInThread: number    // +5  - topic introduction
  hasMentions: number        // +5  - directed communication

  // Engagement signals (lower weight - not required)
  reactionCount: number      // +2 per reaction (max +10)
  replyCount: number         // +3 per reply (max +15)

  // Negative signals
  isShortReply: number       // -15 - "thanks", "ok", etc.
  isQuestion: number         // -5  - questions aren't knowledge (unless answered)
}
```

**Thresholds**:
- Score >= 40: Create memo automatically
- Score >= 30 with isAnnouncement: Create memo (announcements are canon)
- Score >= 50 with engagement: High-confidence memo

### 2. Create Memo Worker

**File**: `src/server/workers/memo-worker.ts`

Process `memory.create-memo` jobs:

```typescript
class MemoWorker {
  async processJob(job: CreateMemoJobData) {
    const { workspaceId, eventId, textMessageId, source } = job.data

    // 1. Get message with context
    const message = await this.getMessageWithContext(eventId)

    // 2. Calculate memo-worthiness
    const worthiness = await this.scoringService.score(message)

    if (!worthiness.shouldCreateMemo) {
      logger.debug({ eventId, score: worthiness.score }, "Message not memo-worthy")
      return
    }

    // 3. Check for semantic overlap with existing memos
    const overlap = await this.findOverlappingMemos(workspaceId, message.content)

    if (overlap.found) {
      // Either merge or supersede based on recency and confidence
      await this.handleOverlap(overlap, message, worthiness)
      return
    }

    // 4. Create new memo
    await this.memoService.createMemo({
      workspaceId,
      anchorEventIds: [eventId],
      streamId: message.streamId,
      source: source || 'system',
      summary: worthiness.suggestedSummary,
      topics: worthiness.suggestedTopics,
      confidence: this.calculateConfidence(worthiness.score),
    })
  }
}
```

### 3. Add Knowledge Revision System

**File**: `src/server/services/memo-revision-service.ts`

Handle knowledge overlap/supersession:

```typescript
interface OverlapResult {
  found: boolean
  overlappingMemos: Array<{
    memo: Memo
    similarity: number
    isMoreRecent: boolean
    confidenceDiff: number
  }>
  recommendedAction: 'create_new' | 'merge' | 'supersede' | 'skip'
}

class MemoRevisionService {
  async findOverlappingMemos(workspaceId: string, content: string): Promise<OverlapResult> {
    // Generate embedding for new content
    const embedding = await generateEmbedding(content)

    // Find semantically similar memos (similarity > 0.8)
    const similar = await this.pool.query(`
      SELECT m.*, 1 - (emb.embedding <=> $1::vector) as similarity
      FROM memos m
      INNER JOIN memo_embeddings emb ON emb.memo_id = m.id
      WHERE m.workspace_id = $2
        AND m.archived_at IS NULL
        AND 1 - (emb.embedding <=> $1::vector) > 0.8
      ORDER BY similarity DESC
      LIMIT 3
    `, [JSON.stringify(embedding.embedding), workspaceId])

    if (similar.rows.length === 0) {
      return { found: false, overlappingMemos: [], recommendedAction: 'create_new' }
    }

    // Determine action based on overlap characteristics
    const action = this.determineAction(similar.rows, content)
    return { found: true, overlappingMemos: similar.rows, recommendedAction: action }
  }

  private determineAction(overlaps: MemoRow[], newContent: string): string {
    const mostSimilar = overlaps[0]

    // Very high similarity (>0.95) - likely duplicate or update
    if (mostSimilar.similarity > 0.95) {
      // If new content is more recent, supersede
      // If old memo has higher confidence, skip
      return mostSimilar.confidence > 0.7 ? 'skip' : 'supersede'
    }

    // High similarity (0.85-0.95) - related but distinct
    if (mostSimilar.similarity > 0.85) {
      return 'merge'  // Add as additional anchor to existing memo
    }

    // Moderate similarity (0.8-0.85) - create new but link
    return 'create_new'
  }

  async supersedeMemo(oldMemoId: string, newMemo: CreateMemoParams): Promise<Memo> {
    // Archive old memo with supersession note
    await this.pool.query(`
      UPDATE memos
      SET archived_at = NOW(),
          metadata = COALESCE(metadata, '{}') || '{"superseded_reason": "newer_content"}'::jsonb
      WHERE id = $1
    `, [oldMemoId])

    // Create new memo
    return this.memoService.createMemo(newMemo)
  }

  async mergeMemos(existingMemoId: string, newEventId: string): Promise<void> {
    // Add new event as additional anchor
    await this.pool.query(`
      UPDATE memos
      SET anchor_event_ids = array_append(anchor_event_ids, $1),
          updated_at = NOW(),
          confidence = LEAST(confidence + 0.05, 1.0)
      WHERE id = $2
    `, [newEventId, existingMemoId])
  }
}
```

### 4. Integrate with Enrichment Pipeline

**File**: `src/server/workers/enrichment-worker.ts` (modify)

After enrichment completes, check if message is memo-worthy:

```typescript
// In processJob(), after successful enrichment:
if (success) {
  // Queue memo evaluation
  await queueMemoEvaluation({
    workspaceId,
    eventId,
    textMessageId,
    source: 'enrichment',
  })
}
```

### 5. Add Individual Message Classification

**File**: `src/server/workers/classification-worker.ts` (modify)

Extend classification to evaluate individual messages, not just threads:

```typescript
// New function: maybeQueueMemoEvaluation
export async function maybeQueueMemoEvaluation(params: {
  workspaceId: string
  eventId: string
  textMessageId: string
  content: string
  signals: ContentSignals
}): Promise<string | null> {
  const score = calculateMemoWorthiness(params.signals)

  // Lower threshold than classification - we want to catch more
  if (score < 30) {
    return null
  }

  return await boss.send<CreateMemoJobData>(
    "memory.create-memo",
    {
      workspaceId: params.workspaceId,
      anchorEventIds: [params.eventId],
      streamId: params.streamId,
      source: 'system',
    },
    {
      priority: JobPriority.BACKGROUND,
      retryLimit: 2,
      // Dedupe by event ID
      singletonKey: `memo-eval-${params.eventId}`,
      singletonSeconds: 3600,
    }
  )
}
```

### 6. Backfill Script for Existing Messages

**File**: `scripts/backfill-memos.ts`

Queue memo evaluation for existing enriched messages:

```typescript
async function backfillMemos(workspaceId: string, options: { limit?: number }) {
  // Find enriched messages without memos
  const candidates = await pool.query(`
    SELECT tm.id as text_message_id, e.id as event_id, tm.content
    FROM text_messages tm
    INNER JOIN stream_events e ON e.content_id = tm.id
    INNER JOIN streams s ON e.stream_id = s.id
    LEFT JOIN memos m ON e.id = ANY(m.anchor_event_ids)
    WHERE s.workspace_id = $1
      AND tm.enrichment_tier >= 2
      AND m.id IS NULL
      AND e.deleted_at IS NULL
    ORDER BY e.created_at DESC
    LIMIT $2
  `, [workspaceId, options.limit ?? 500])

  let queued = 0
  for (const row of candidates.rows) {
    await queueMemoEvaluation({
      workspaceId,
      eventId: row.event_id,
      textMessageId: row.text_message_id,
    })
    queued++
  }

  console.log(`Queued ${queued} messages for memo evaluation`)
}
```

## Files to Create/Modify

### New Files:
1. `src/server/services/memo-scoring-service.ts` - Memo worthiness scoring
2. `src/server/services/memo-revision-service.ts` - Overlap detection and revision
3. `src/server/workers/memo-worker.ts` - Process memo creation jobs
4. `scripts/backfill-memos.ts` - Backfill existing messages

### Modified Files:
1. `src/server/workers/enrichment-worker.ts` - Queue memo evaluation after enrichment
2. `src/server/workers/classification-worker.ts` - Add memo scoring criteria
3. `src/server/workers/index.ts` - Start memo worker, export new functions
4. `src/server/lib/job-queue.ts` - Already has `CreateMemoJobData` type

## Implementation Order

1. **MemoScoringService** - Core scoring logic using existing content patterns
2. **MemoRevisionService** - Overlap detection (simple first, can enhance later)
3. **MemoWorker** - Process jobs and create memos
4. **Integration** - Hook into enrichment pipeline
5. **Backfill** - Script to evaluate existing messages
6. **Test & Tune** - Adjust thresholds based on results

## Expected Outcomes

- Announcements automatically become memos (even without engagement)
- Explanations and decisions become searchable knowledge
- Duplicate/updated information supersedes old memos
- Knowledge base grows automatically from valuable conversations
